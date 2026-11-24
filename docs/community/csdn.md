# 从 0 到 1 做一个本地优先的 AI 科研工作台：架构、踩坑与压测

这篇不是产品介绍，是一次工程复盘。

SciFlow 的目标很具体：把文献、研究循环、写作评审、投稿材料放进同一个本地工作台。一个 SQLite 文件，自己的模型接口，不需要托管账号。听起来像又一个“All-in-one”，做起来才发现，真正难的是让一条长链路在真实模型、真实沙箱、真实重启下都不散架。

下面按数据层、模型层、研究循环、知识检索、质量门、投稿交付六段拆，中间夹着踩过的坑。代码都在 <https://github.com/badhope/sciflow>。

## 一、先定数据边界：一个文件要装下什么

项目是 pnpm monorepo：

- `apps/server`：NestJS，REST、Agent 编排、研究循环、质量门、投稿包。
- `apps/web`：React + Vite，驾驶舱、知识库、写作评审、投稿页。
- `apps/desktop`：Electron，本地启动服务并生成远程控制二维码。
- `packages/db`：Drizzle + better-sqlite3 + sqlite-vec。
- `packages/retrieval`：ANN + FTS5 混合检索。
- `packages/ai`：OpenAI 兼容 transport、结构化输出、工具调用、mock gateway。

核心对象不是“聊天消息”，而是科研对象：

`project → program → cycle → question → hypothesis → protocol → run → claim → evidence`

这条链决定了一个结论能不能落到真实执行。`claim` 不是模型随口写的一句话，它必须能回到某次 `run` 的 stdout 和证据行。没有证据，前端会把引用打成红牌。

数据库只有 `sciflow.db` 一个主文件（WAL 模式下还有 `-wal` / `-shm`）。备份不是“导出某个项目”，而是整库粒度：

```bash
node scripts/backup-db.mjs
DATABASE_PATH=/path/to/sciflow.db node scripts/backup-db.mjs --keep 7
```

恢复时把备份文件放回 `DATABASE_PATH`，同时删掉同目录的 `-wal` / `-shm`。这条运维规则写在 `docs/OPERATIONS.zh-CN.md`，因为只换主文件、留下旧 WAL，SQLite 会给你一个看起来正常、实际状态错乱的库。

## 二、模型层：不要相信“结构化输出”这四个字

最早我们直接让模型返回 JSON，schema 写得很清楚。真实网关第一次跑，专家门禁返回了：

```json
{"批准": true, "把握程度": "高（约 0.99）", "理由": ["样本量未写", "未说明训练测试比例"]}
```

字段名是中文，confidence 是散文，`理由` 是数组，而 schema 要的是 `approved / confidence / rationale`。更离谱的是，下一次它返回英文同义键 `reasons`、`issues`、`required_changes`。mock 测试全绿，真实模型一上来就 schema 失败。

现在的 `normalizeStructuredObject` 做语义归一：

- 中文/英文键别名：`批准→approved`、`把握/确信→confidence`、`reason(s)→rationale`；
- 字符串目标字段收到数组时，合并成换行字符串；
- 0–100 schema 下 `0.99` 放大为 99；
- 无数字的“高/中/低”映射 90/50/20，其余保留让 schema 报错，不硬猜。

还有一个更重要的变化：`completeStructured` 在主模型重试耗尽后，会按 `AI_MODEL_FALLBACK` 切备选模型。以前主模型连续空响应三次，整轮直接 `blocked agent_error`；现在会降级，成功以 `caller:fallback` 留痕。真实试跑里，专家门禁就是切到 `glm-5.3` 后批准的。

这不是“模型更聪明”，是传输层不再把一次空响应当成世界末日。

## 三、研究循环：状态机比提示词长

研究循环用 LangGraph，节点大致是：

`literature → plan(PI) → gate → execute → evaluate(Critic) → decide → revise?`

几个工程约束：

1. **协议必须写清可执行参数。** 样本量、训练/测试比例、X 维度、异方差函数、树数量、随机种子、bootstrap 方案。写不清，专家门禁驳回。
2. **驳回后自动重写，最多两版。** 驳回理由作为下一版设计输入，不是原样重试。
3. **审批用 interrupt 挂起，checkpoint 落同一个 SQLite。** 人批准后用 `Command({resume})` 续跑。
4. **启动恢复扫非终态 cycle。** 有 checkpoint 自动续，无 checkpoint 标 blocked；`awaiting_approval` 永不自动跑。
5. **看门狗只释放锁，不自动重跑。** 60 分钟无心跳标 blocked，保留断点，等人 `/recover`。
6. **重放幂等。** `execute` 按 `cycle+protocol+iteration` 复用 run；`evaluate` 按 `cycle+protocol` 复用 claim 并整组重建证据。

第 6 条是血泪。LangGraph 从 checkpoint 恢复会重放节点，如果 `evaluate` 直接 `createClaim`，重启一次就多一条结论、证据翻倍。后来我们写了一个回归用例，专门模拟同一个 checkpoint 重放两次，断言 claim 只有一条。

## 四、知识检索：单机也要有像样的召回

单机不等于只做 `LIKE`。知识库现在有两条召回：

- `sqlite-vec` 的 `vec0` 虚拟表做 ANN 语义召回；
- FTS5 做词面召回，触发器同步 chunk 增删改；
- 两路结果用 RRF 融合，k=60；
- 可选 LLM rerank（`retrieval_rerank=on`，默认 off，失败静默保 RRF 序）；
- 最后做 MMR 去冗余，压掉同一文档相邻块的霸榜。

这套东西不新，但放在一个 SQLite 文件里，维护成本低得多。1 万条文档的基准里，service 文档检索 P95 1.26 ms，全类型 3.90 ms，HTTP 4.44 ms。不是大规模集群的数字，但对个人工作台够用。

坑也有：`sqlite-vec` 扩展加载失败时必须显式降级到 FTS5/LIKE，不能假装向量检索还在；`SCIFLOW_NO_VEC=1` 是排障开关，不是“关掉就变快”的优化。

## 五、质量门：让规则决定过不过，模型分只做参考

写作质量评审有七个维度，每个维度由规则计分并带稳定指纹。模型可以给建议，但过不过由确定性门禁决定。这样同一篇稿子重复评审不会因为模型采样飘来飘去。

引用检查是另一条硬门：

- 正文每个 `[n]` 先指 citation 行，再指 reference；
- 幽灵锚点、孤儿条目、断号、重复 DOI 都会被点名；
- 文献库为空时直接禁止引用标记，不让模型“先写着，引用以后补”。

这条规则得罪过不少“先生成再补引用”的用法，但它避免的是更严重的学术风险。

## 六、投稿交付：最后一公里别掉链子

投稿页做三件事：就绪检查、期刊模板、投稿包 ZIP。就绪检查会把作者信息、摘要长度、图表引用、伦理声明、数据可用性逐项过一遍；投稿包是确定性打包，同一份材料重复导出内容一致。

这里没有“AI 帮你投稿”的魔法，只有把该填的坑位摆出来，缺什么红什么。

## 七、踩坑清单

1. **CI 安装 ffmpeg 被 apt 拖死。** 最终移除 `apt-get update`，测试优先用 `ffmpeg-static`，再回退系统二进制，都没有才跳过视频用例。CI 不该由 runner 的包缓存决定成败。
2. **真实模型空响应。** 结构化调用没有降级链时，三次空响应就 `blocked`。现在重试 + 模型降级，仍失败才 fail-closed。
3. **保存回答把内部标记写进文档。** `---FOLLOWUPS---` 曾原样落进正文，现在落稿前统一剥离。
4. **分享评论开关串台。** 新分享沿用上一个目标的 checkbox，现在按 `targetType + targetId` 命中后才恢复。
5. **飞书 Webhook 把 HTTP 200 当成功。** 飞书失败也常返回 200，错误藏在 JSON；现在解析 `code / StatusCode`，非 0 降级为站内失败。
6. **PWA 旧缓存。** 最终构建注入 `meta[name=sciflow-build]`，旧页面能和新构建区分，不再“看起来更新了其实还在跑旧壳”。

## 八、怎么跑

```bash
git clone https://github.com/badhope/sciflow.git
cd sciflow
pnpm install
cp apps/server/.env.example apps/server/.env   # AI_BASE_URL / AI_API_KEY / AI_MODEL
pnpm build && pnpm start
```

没有模型 Key 也能看完整链路：

```bash
AI_MOCK=1 DATABASE_PATH=/tmp/sciflow_demo.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js
node scripts/seed-demo.mjs
```

Docker 和 Windows 安装包在 `docs/deployment.zh-CN.md`、`docs/DESKTOP.zh-CN.md`。

## 九、边界

- 真实网关会间歇空响应；产品 fail-closed，不编结果。
- 移动端 PWA 只在桌面 Chromium 验证，没上真实 iOS / Android。
- `database.ts` 873 行、`pipeline.service.ts` 731 行、`WorkspacePage.tsx` 1519 行、`WritingPage.tsx` 1269 行，仍是技术债。
- 五个内容社区的发布状态以 `docs/COMMUNITY-LAUNCH-KIT.zh-CN.md` 为准，没发的平台不写成已上线。

1.19.18 的 CI 跑过 972 个 server 测试、277 个 web 测试，真实模型闭环连续两轮到 `synthesize`。这些数字不是终点，但至少能证明这条链路不是 PPT。
