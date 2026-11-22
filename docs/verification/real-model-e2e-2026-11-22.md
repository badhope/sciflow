# 真实模型终验报告（2026-11-22）

**结论：工程验收已做完。** 本轮把长篇写作、Agent 工具与计划授权、投稿包、重启持久化四项真实跑通，并修复了真实模型链路中暴露的 5 类问题。提交 `ce33eb4`，五个远程 `main` 已对齐到同一提交。

## 验收环境

- 独立库：`/home/user/.sciflow/sciflow-final-e2e.db`（由 UI 库备份，不污染原库）
- 服务：`http://127.0.0.1:43203`
- 模型：`deepseek-v4.1-flash`，`baseUrl=https://api.qs.al/v1`，`mock=false`，支持 tool calling
- 项目：`e1139d37-e06c-4b9a-baa2-c11ccc7f842a`「真实模型终验 · GNN 分布外泛化」

## 1. 长篇写作

书《雾港来信》`52fa6beb-9474-48c7-8dab-d1e567c2dd3c`：

- 两章全部 `done`，共 1608 字；书状态 `completed`
- `compile` 输出 1897 字符，两个章节标题各只出现 1 次
- 修复了三个真实问题：
  1. 摘要空响应不再把已生成正文的整章标 `failed`，改用正文截断兜底
  2. 摘要提示词禁止「收到/请告诉我/可选」等对话式回复，并增加坏摘要检测
  3. 章节正文入库前剥掉与标题重复的首行 Markdown 标题，`compile` 再做一层兜底

## 2. Agent 工具与计划授权

- 真实 `project.list` 调用：模型自主调用工具，返回 2 个项目；`agent_step` 记录 `tool=project.list, status=ok, 9ms`
- 计划级授权闭环：
  - 模型提交计划 `13933ced-4725-4e15-8080-3a2a09931210`，白名单 `quality.audit`，`maxSteps=2`
  - 人工批准后同一轮继续执行 `quality.audit`
  - 返回客观 95/100、0 条硬伤，计划消耗 1 步
- 说明：这次调用同时暴露了质量门口径问题，见「未决口径」

## 3. 投稿包

权威稿件 `e8f4cb01-a1fa-458a-b4ba-b37a588b8089`：

- `readiness`：`ready=true`，93 分，0 阻塞 / 2 提醒（缺摘要块、缺关键词块）
- `package`：45,974 字节，ZIP 内含
  - `manuscript.docx`（27,053 字节）
  - `cover-letter.md`
  - `references.bib`（13,338 字节）
  - `submission-checklist.md`
  - `manifest.json`
- `cover-letter`：真实模型生成 2,608 字符英文信，目标期刊 `Journal of Chemical Information and Modeling`
- `journals-match`：真实模型返回 5 个候选期刊及匹配理由与差距

## 4. 重启持久化

停止后端并重新启动后：

- 稿件流水线 `835ed330-43f0-48cc-8366-231ea4a6376d`：`completed`
- 长篇书 `52fa6beb-9474-48c7-8dab-d1e567c2dd3c`：`completed`，2/2 章 `done`
- 研究循环 `871a4f7c-a809-4f46-a4f6-6efcc915a6b1`：`stopped`，状态与 claims 保留
- Agent 计划 `13933ced-...`：仍在计划列表，状态可读

## 5. 研究循环

新循环 `871a4f7c-a809-4f46-a4f6-6efcc915a6b1`，两轮人工审批后执行：

- 两轮 run 均 `completed`：
  - `3d6d8192-7da4-4a62-8931-7da506be61e2`
  - `6abcdf99-bc2b-44fa-b74f-d98ce653ca52`
- 输出：`n=1200`、`groups=20`、`spearman_rho=0.9799`、`auroc=0.9935`
- claims 两条均为 `inconclusive`，置信度 25 / 28；循环按 `max_iterations` 正常停止
- 修复：实验脚本生成遇到网关空响应时，先走极简提示重试，仍空则用确定性代理实验兜底，不再让整轮 run 直接 `failed`
- 限制：本轮两段实验脚本实际来自确定性代理兜底，不是模型直出；PI、协议、评审与结论生成均为真实模型

## 6. 全量门禁

- Server：120 个测试文件、851 条测试全部通过
- Web：47 个测试文件、248 条测试全部通过
- Server / Web TypeScript 类型检查通过
- ESLint 通过
- Web 构建通过；首屏 429.9 KB（gzip 131.3 KB），预算 450 KB / 250 KB
- OpenAPI：238 paths，`openapi:check` 无漂移
- 工作区干净；`ce33eb4` 已推送到 GitCode、GitHub ×3、Gitee

## 未决口径（必须明确，不冒充已解决）

1. **质量门只认客观分**：权威稿客观 95/100，但 LLM 评审 56/100，明确写「初稿、未达到期刊发表水平」。当前门禁不会因 LLM 低分阻塞；这是产品判断，尚未拍板。
2. **投稿就绪是「草稿迭代」标准**：93 分 `ready=true`，但仍缺摘要块与关键词块。若按真实期刊投稿要求，应补这两块后再投。
3. **研究循环实验代码有兜底**：网关空响应导致模型代码生成不稳定，本轮以确定性代理实验完成执行；不能宣称「实验代码全部由模型生成」。
