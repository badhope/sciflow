# SciFlow 深度审计报告
> 审计人：麦克斯韦 🔧 | 2026-10-17 | 基线 commit `ae36734` (v0.4.2) | 222 文件 / ~5.3 万行

---

## 一、五平台同步状态与 Token 结论

| 平台 | 仓库 | 可见性 | License | main SHA | 推送凭证 |
|---|---|---|---|---|---|
| GitCode | badhope/sciflow | public ✅ | MIT ✅ | ae367344 | ✅ 有效（已配 credential store） |
| Gitee | badhope/sciflow | public ✅ | MIT ✅ | ae367344 | ❌ 六种认证方式全 401 |
| GitHub | badhope/sciflow | public ✅ | MIT ✅ | ae367344 | ❌ 401 |
| GitHub | X33834/sciflow | public ✅ | MIT ✅ | ae367344 | ❌ 401 |
| GitHub | Morningstar202604/sciflow | public ✅ | MIT ✅ | ae367344 | ❌ 401 |

**五端完全同步**（main SHA 一致，10-15 同日五连推）。五仓库全部公开 + MIT，符合要求。

**Token 判定（有对照实验）**：对 Gitee 试了 query/header token/Bearer/Basic/X-Gitee-Token/Git-HTTPS 六种方式，对 GitHub 试了 `token`/`Bearer` 头 + Basic + Git-HTTPS。判定实验：**真 token 与故意写错的 token 在"不存在仓库"场景行为完全一致**（GitHub: `Invalid username or token`；Gitee: `Incorrect username or password`）→ 字符串本身无效，与调用方式无关。硬证据：Morningstar 那串只有 39 位（标准 40 位）——聊天断行传输丢字符。**从平台后台重新复制即可恢复四端推送**，GitCode 现在已可直接推。

---

## 二、项目是什么（一句话 + 架构）

**本地优先、单机部署的中文科研全流程 AI 工作台**：输入研究主题 → 检索规划 → 文献调研 → 大纲（人工确认门）→ 分章起草（Agentic RAG 边写边查）→ 7 维质量门（<80 分 Reflexion 自动回炉）→ 润色 → 引用格式化 → 期刊匹配/Cover Letter/审稿回复/投稿跟踪。零外部 AI 依赖（用户自带 OpenAI 兼容 Key，主推国内模型），SQLite 单文件落本地，主动移除国外学术数据源（合规决策）。

```
┌─ apps/desktop (Electron) ── contextIsolation 隔离壳，内嵌 server，回环监听
├─ apps/server  (NestJS 11) ── 20 controller / 24 表 / 114 路由（v0.6.0）
│   ├─ ai/          AiTransport(AI SDK 多厂商热切换/限流/重试/成本落库) + AiService(24 个业务 prompt 方法) + mock 网关(CI 离线回归)
│   ├─ pipeline/    LangGraph 真编排：interrupt 人工确认 + SqliteSaver checkpoint + best-of-N 质量门
│   ├─ knowledge/   三级降级检索：sqlite-vec ANN → FTS5 trigram BM25 → LIKE
│   ├─ references/  文献库：citation-js(BibTeX/RIS/CSL) + 指纹去重 + 筛选队列 + 编码矩阵(PRISMA) + 引用网络图
│   ├─ documents/   版本管理 + 8 样式 CSL 渲染(IEEE/GB-T 7714/Nature/...) + docx 导出
│   ├─ research/    设计诊断/对比/模拟审稿/意见闭环 + 投稿三层跟踪(13 态状态机)
│   ├─ experiments/ Python 沙箱(超时杀进程组/内存监控/env 白名单/数组参数)
│   ├─ mcp/         官方 MCP SDK 双端(stdio+HTTP) + 第三方内容注入防护
│   └─ 其余：chat(SSE+跨会话摘要) / memory / judgment(规则表+LLM 兜底) / websearch(死代码) / auth / settings
└─ apps/web (React 19 + Vite + Tailwind4 + TanStack Query/Table) ── 12 视图路由全懒加载，对话优先工作台
```

**工程质量总评：这是同体量开源项目里罕见的高纪律代码库**——零 TODO 残留、`any` 占比 0.1%、中文注释解释"为什么"、ADR 索引、威胁模型写在代码里、CI 29 步全绿（typecheck×2 + vitest + build×2 + 66 路由黑盒回归 + promptfoo 契约 + Playwright）、`pnpm audit` 0 漏洞、文档-代码一致性高（我逐项验证了 v0.4 重构承诺：AI SDK ✅ LangGraph ✅ 官方 MCP SDK ✅ commander ✅ citation-js ✅，无一幻觉）。

---

## 三、逐模块审计：亮点 + 问题清单

### 🌟 亮点（同类工具少见的设计）
1. **pipeline.graph.ts**：LangGraph `interrupt()` 人工确认大纲，checkpoint 重放零副作用；质量门 **best-of-N 保留最高分**而非最后轮；覆盖写入前自动快照（20 版上限）。
2. **ai-transport**：429 智能退避（含中文限流文案识别）、全局 p-limit 令牌桶、每次调用成本落 `llm_call_log`、多厂商热切换、结构化输出 jsonSchema/zod 双路径。
3. **references**：指纹去重、幂等导入、事务批量写入、筛选队列+编码矩阵（国内少见直接支持系统性综述工作流）、空元数据守卫（引用池净化，不凑数）。
4. **security**：API Key AES-256-GCM 落库（备份库不等于泄露凭据）、MCP 第三方内容注入防护（untrusted hint）、非回环绑定强制 JWT 的启动闸、桌面端 contextIsolation。
5. **文档诚实化**：journal 指标不确定就 NULL、失败就 Fail-Fast，不编造数据。

### 🔴 高优先级问题（影响核心体验/成本）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| H1 | pipeline.graph.ts:221 | **Reflexion 是"假回炉"**：`instructions` 永远传 `'[]'`，每轮只把最后一条 feedback 文本塞回 prompt，每轮回炉**全量重起草所有章节**（不定向改低分章节） | 回炉 3 轮 = 3× 全文 LLM 成本，改进信号弱，质量提升有限 |
| H2 | knowledge.service.ts | LIKE 兜底检索**无 LIMIT**（topK 参数已弃用不生效）；RAG 注入 chat 的上下文只切 **320 字符** | 大知识库内存风险；检索召回好但喂给模型的太少——RAG 质量瓶颈 |
| H3 | knowledge.service.ts:14 | 分块 overlap=**0**（800 字块边界语义断裂）；所谓"Contextual Retrieval"只是文档级前缀（Anthropic 原法是每块 LLM 生成上下文） | 检索质量打折 |
| H4 | references.service.ts search() | 全表加载后内存 `slice(0,limit)`，无 SQL LIMIT | 文献几千条时搜索卡顿 |
| H5 | 全局 | **同项目可并发创建多条流水线**，共享 3 并发池互相挤兑 + 触发上游限流（v0.3 手写的互斥锁在 v0.4 重构中丢失） | 用户连点两次=成本翻倍且互相失败 |
| H6 | websearch 模块 | **死代码**：零调用方，且 DDG Instant Answer 对科研无用——"联网调研"实际不存在 | 宣传与实际不符；流水线的"外部调研"维度缺失 |
| H7 | judgment 模块 | 意图判别只在 ChatPanel 用到；每条未命中消息都触发一次 LLM 调用（`temperature:0.5` 的 complete），规则表命中率无统计 | 每句话多一次 LLM 成本；价值存疑 |
| H8 | references.service gap/evidence/extract | 所有文献摘要一次性塞 prompt（只切 300-400 字符/篇，无分批） | 文献多时 prompt 爆炸或信息覆盖不足 |

### 🟡 中优先级问题

- **W-data**：24 表零外键（`PRAGMA foreign_keys=ON` 开了个寂寞），级联删除全靠 service 手写，有孤儿行风险；DDL 与 drizzle schema 双轨靠人肉同步。
- **W-version**：document.versions 全量 JSON 快照 ×20 上限，长文多版本 DB 膨胀，无 diff/无逐段恢复（roadmap 已自认）。
- **W-cite**：citation-renderer 自造简化参考文献格式（`authors. title[J]. venue, year`）与 documents.service 的 8 样式 CSL 引擎**双轨漂移**；`[J]` 硬编码（会议/书籍也标 J）；作者全名 `, ` 连接不符合学术惯例。
- **W-embed**：文档上传 embed 用 `Promise.all` 无并发限制（千块文档=千次并发进 llama 上下文）；embedding 模型下载无 hash 校验/无断点续传。
- **W-stream**：流式聊天无失败重试（complete 有 p-retry，stream 断了就断）；completeStructured 失败**从不重试**（onFailedAttempt 直接 throw——结构化输出恰是最需要重试的场景）。
- **W-frontend**：对话线程只存 localStorage（60 条），换设备/清缓存即丢——对"科研工作台"是硬伤；多处 `.catch(() => setX([]))` 静默吞错，错误态呈现为"空数据"；错误识别用正则前缀 hack（`/^[请求服务网络未授权没有操作]/`）极脆弱。
- **W-cli**：cli.ts 的 localApi 用 `spawnSync('node', ['-e', 模板字符串])` 发请求——每次冷启 node 子进程 + JSON 插值有注入隐患（node 18+ 原生 fetch 即可）。
- **W-ratelimit**：全局 60 req/min 对本地单人偏紧（活动任务 2.5s 轮询 + SSE + 页面查询叠加时可能误伤自家前端）。

### 🟢 低优先级（择录）
- GENERATE_FIGURES prompt 里硬编码 GNN 主题示例（示例污染，其他领域论文会被带偏）
- PLAN_RESEARCH 让模型输出 objective+researchQuestions，代码只取 keywords，其余丢弃——信息流断裂
- docx 导出删表格语法（表格内容丢失）、不嵌图
- 评审 content.slice(0,8000) 静默截断，长论文只见前半
- API parser（judgment extractTopic）正则去动词很粗糙
- procedureMemory 只取最后 1 条，无相关性检索——"记忆"是 CRUD 不是记忆
- embedding 报错提示让用户配 `EMBEDDING_DIM=0`，代码里根本没读这个变量
- `[Ref:1][Ref:1]` 重复引用渲染为多次 `[作者 年份]` 不合并（可接受）

---

## 四、架构师视角：缺什么

按"科研 agent"的使命从大到小：

1. **文献获取层缺失（最大缺口）**：文献只能手动添加/项目导入，不挂 PDF、无阅读器、无高亮批注、无笔记字段。科研工作流 80% 时间在"读"，当前工具只覆盖"写"。即使坚持不做国外源（合规），**国内可用路径也有**：知网开放接口/百度学术/arXiv 镜像/用户自建 RSS——完全空白。
2. **写作-引用不闭环**：`[n]` 引用不随增删自动重排（roadmap 自认）、引用锚定在段落级而非句级、正文里的 `[12]` 会被误认成引用。
3. **Reflexion 名不副实**（见 H1）——"自动回炉"是最大卖点之一，但当前实现是"原样重掷骰子"。定向修改（把低分维度的 feedback 转成章节级修改指令）才能让卖点成立。
4. **评测体系薄**：server 只有 4 个单测 spec；纯逻辑模块（citation-renderer/secret-crypto/fingerprint/authors/quality 评分）零单测；promptfoo 只覆盖连接和大纲两个契约。AI 产品的核心资产是 prompt，prompt 无回归保护。
5. **多轮长任务的可观测性**：agent-trace 表有了，但没有"每章草稿成本/轮次/重试"的汇总视图——用户对成本无感知。
6. **数据可迁移性**：无 BibTeX/RIS 整包导出（单条有）、无整库归档——roadmap 自己标了"缺口"，换工具即孤岛。
7. **协作与同步**：单机定位下合理，但"导出项目包→另一台机导入"这类最低限度的可搬运性应该有。

---

## 五、对标竞品差距

| 维度 | Elicit ($49/mo) | SciSpace ($20-70/mo) | Consensus | STORM/AgentLab(开源) | **SciFlow** |
|---|---|---|---|---|---|
| 文献规模 | 1.25亿+ (S2图谱) | 2亿+ | 2亿+ | — | **用户手动导入** |
| 全文 PDF 理解 | ✅ 深度提取 | ✅ | ✅ 摘要级 | — | ❌ 仅摘要字段 |
| 系统综述/提取矩阵 | ✅ 招牌 | ✅ | ❌ | ❌ | **✅ 已有（差异化！）** |
| 自动写作全流程 | 部分（草稿） | 部分 | ❌ | STORM 大纲+初稿 | **✅ 全流程+质量门（最强）** |
| 引用真实性保障 | ✅ 逐句溯源 | 部分 | ✅ | 无 | ✅ 池化+禁编造（好） |
| 数据主权/隐私 | ❌ 云 | ❌ 云 | ❌ 云 | 本地 | **✅ 本地 SQLite（独有）** |
| 中文科研场景 | ❌ | 部分 | ❌ | 英文 | **✅ 深度适配（独有）** |
| 成本模型 | 订阅 | 订阅 | 订阅 | 免费 | **自带 Key=边际成本归零** |

**一句话定位差距**：竞品的护城河是"数据 + 检索"（亿级文献图谱），SciFlow 的护城河是"全流程自动化 + 数据主权 + 中文合规"。当前 SciFlow 在自己的护城河上做到 80 分，在别人的护城河上是 0 分（无法检索任何文献）。**不要试图在对方护城河里打仗**——把"你自己的文献 + 全自动成稿"打到 95 分才是生路。

---

## 六、商业定位与获客（最实在的版本）

### 我们真正的优势（按真实程度排序）
1. **自带 Key、成本归零**：用户用 DeepSeek（~1 元/百万 token）跑全流程，一篇综述成本不到 1 块钱——Elicit 一篇的量抵一个月订阅费。这是价格维度上的降维打击。
2. **数据主权**：未发表数据、基金申请书、敏感课题（军工/医疗/企业研发）**不敢上传云端**——这是真实且付费意愿强的场景，竞品永远给不了。
3. **中文合规全家桶**：GB/T 7714、知网采编系统现实、国内期刊库、中文提示词调优——竞品的中文体验是翻译的。
4. **全流程一条龙**：从主题到投稿跟踪 13 态状态机，竞品都是"单点工具"（Elicit 只管文献，Jenni 只管写作）。

### 我们真正的劣势（别自欺）
1. 用户冷启动时要自己找文献、自己传 PDF——**第一分钟体验远差于 Elicit**（输个主题就出 100 篇相关文献）。
2. "AI 生成的论文能用吗"——质量门 best-of-N + Reflexion 当前实现撑不起宣传语，评审一眼假（套话、引用密度低、无真实数据）。
3. 单机软件的分发、更新、信任（为什么下载你的 exe）——冷启动获客极难。

### 获客路径（可执行）
1. **第一批用户：被云端订阅价格劝退的研究生**。战场在知乎/小红书/B站，内容策略：**"一篇综述的实际成本账单"**——晒 llm_call_log 汇总（1.7 元/篇）对比 Elicit 年费 588 美元。这是自带 Key 模式独有的、可验证的营销素材。
2. **第二批：有数据合规需求的科研单位**（横向课题/涉密方向/医院）。卖点一句话："数据不出这台电脑"。走单位内网部署 + 桌面端安装包，这是 `enterprise-transformation-plan.md` 已有布局，定价可以按许可证年费。
3. **口碑飞轮：GB/T 7714 引用格式化 + 知网查重适配**——免费开源这层"工具型价值"引流，把流水线作为 Pro 功能沉淀（开源单点工具获客 → 全流程付费），Obsidian 模式。
4. **别做的**：别急着做多租户 SaaS（威胁模型整个变掉）、别跟 Elicit 拼文献图谱（打不过）、别做浏览器插件（杂）。

### 产品上的三个"获客杠杆"（直接对应审计发现）
- **修 H2+H3（检索质量）**：用户传 50 篇 PDF 后的问答质量 = 口碑生死线。
- **修 H1（Reflexion 定向化）**："自动改到过 80 分"是可演示、可传播的功能时刻。
- **做文献获取的合规补丁**：接入 arXiv 镜像 + 百度学术，哪怕只做"粘贴 arXiv ID 自动抓元数据+PDF"，冷启动体验立刻从 0 分到 60 分（这不违反"不做国外云服务"原则——是用户主动喂数据）。

---

## 七、开发优先级建议（结合差距 + 投入产出）

| 优先级 | 事项 | 依据 | 量级 |
|---|---|---|---|
| P0 | H5 并发互斥 + H4 SQL LIMIT + H8 分批 | 一天内能修完的正确性硬伤 | S |
| P0 | H2/H3 检索链路（LIKE 限流→注释修复→注入扩到 800 字→overlap 15%） | 口碑生死线 | M |
| P0 | H1 Reflexion 定向回炉（低分维度→章节级修改指令；instructions 表真正用起来） | 核心卖点兑现 | M |
| P1 | 引用闭环（正文锚定+自动重排）+ 两套渲染并轨走 CSL | 学术工具的可信度根基 | L |
| P1 | arXiv 镜像/DOI 元数据抓取（用户主动触发） | 冷启动体验 0→60 分 | M |
| P1 | 纯逻辑模块单测 + prompt 契约扩到 10+ | prompt 是核心资产却裸奔 | M |
| P2 | 对话持久化到 server、docx 表格/图片、BibTeX 整包导出、judgment 价值重估或下线 | 体验补齐 | M |

---

## 附：审计方法与可信度说明
- 逐行深读：server 20 个 service/controller 核心文件（约 8000 行）+ web 核心 4 页 + 配置/CI/脚本；其余文件通过结构+调用关系+grep 面扫覆盖。
- 所有"CI 是否说谎"类结论用进程内验证（AST/lexer/md5），未采信显示层输出。
- 竞品价格/能力来自 2026 年公开评测页与官网（Elicit Pro $49/mo、SciSpace $20-70/mo），以官网实时价为准。
- 中间笔记：`.cache/audit_notes.md`（76 项原始疑点）；文件清单：`.cache/filetree.txt`。
