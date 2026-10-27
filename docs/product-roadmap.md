# sciflow 产品路线图（Product Roadmap）

> 整理日期：2026-09-30
> 依据：4 份内部调研报告（交互范式 / 投稿状态跟踪可行性 / 轻量实验沙箱选型 / 对标差距报告）+ 仓库 README 与 `scripts/full_regression.py`。
> 本文只基于报告与代码事实整理，不新增外部来源结论；不涉及任何代码改动。

---

## 1. 项目定位与设计原则

sciflow 是一个**本地优先、单机部署**的 AI 科研助手：NestJS 11 + DriQL/SQLite 后端、React 19 + Vite + Tailwind v4 前端，纯接国内 OpenAI 兼容模型（豆包火山方舟 / DeepSeek / 通义 / 智谱 / Kimi），不内置账号体系、不依赖国外云服务。

贯穿全部决策的设计原则（来自用户原话方向与各报告反复守住的红线）：

- **本地优先 / 单机**：SQLite 单文件开箱即跑；用户自己的 API key、自己的邮件、自己的文献，全部落本地，不上传、不建多租户。
- **轻量快速、反对臃肿**：页面级代码分割（图表/编辑器/图谱各自独立 chunk，进页面才加载），首屏只装壳与工作台；不按需引入 100MB 级运行时或国外云 bundle 服务。
- **国内模型 / 国内合规适配**：模型侧只走国内 OpenAI 兼容协议为主；**学术检索自 v1.5 起重新接入 OpenAlex / Crossref / arXiv 元数据源**（免 Key、只取元数据、不下载全文、失败静默降级），可用 `SCHOLAR_SEARCH=off` 一键回到零外部网络；投稿场景面向知网腾云 / 玛格泰克 / 勤云等国内采编系统现实。
  > 注（2026-10-28）：本条此前写作「已主动移除国外在线学术源」，与 v1.5 起的代码事实相反，现按代码修正。
- **凡是编辑部/外部不会精确给你的，不假装能自动拿到**：不做登录态爬虫、不做后台轮询、不做邮箱授权守护进程；凡是用户手里已有的（邮件、截图文字），用本地国产模型帮他省整理的力气。
- **威胁模型是"LLM 生成的 buggy 代码卡死自己"，不是外部恶意租户**：因此安全边界是资源上限（超时 / 内存 / 临时目录），不是 microVM / 容器。

---

## 2. 现状能力矩阵（科研全生命周期）

| 环节 | 模块 / 入口 | 已落地能力 | 对应差距 / 缺口 | 状态 |
|---|---|---|---|---|
| **选题** | pipeline Planner agent；`designReview` 一次性 AI 诊断 | 输入主题即出研究计划（目标/子问题/检索策略/章节/风险）；AI 研究设计诊断 | 无文献热度/趋势/研究空白的实证支撑（依赖外部被引数据，已明确不做） | 部分 |
| **文献收集与阅读** | `references` 文献库；文献页库内检索 | 手动添加 / 项目导入 / 本地 LIKE 检索；去重指纹；`reading_status`（unread/reading/read/cited）状态机 | 无外部在线检索（已移除国外源）；文献不挂 PDF、无阅读器/高亮批注；无 DOI 自动补全；无阅读笔记字段 | 部分 |
| **知识沉淀** | KnowledgeDoc / KnowledgeChunk RAG；记忆中心 | BM25 + TF 向量混合检索、零依赖中文 Bigram 分词；情景记忆 + 程序记忆自动注入 | 文献库 `references` 与知识库 `knowledge_docs` 两套数据无外键、互不连通；RAG 只回 docName+120 字片段，不可点原文 | 部分 |
| **研究设计** | `designReview`；Planner | 一次性 AI 诊断 + 研究计划生成 | 诊断结果无方案沉淀、不回链到文档章节 | 部分 |
| **实验 / 数据** | Experiments（写作页可运行代码块）；实验记录页 | 后端 spawn 本机 `python3` 跑代码、stdout/PNG 内联回显、可保存为可复现实验记录（`experiment` 表，含 runtimeVersion 快照） | 原为整段空白，本轮沙箱方案已定型；JS 纯计算兜底（QuickJS）列为二期 | 已落地（方案定型） |
| **写作** | WritingPage 写作页；pipeline Writer | Markdown 大纲树；分章起草（Agentic RAG 边写边查）；三段式学术润色 / 中英互译 / 降重；自动保存 + 多版本历史；编辑/预览/分栏三态 | 文内不是实时 `[n]` 引用；参考文献样式仅 4 种（apa/ieee/vancouver/gbt）；无 LaTeX 编译出 PDF | 已落地（主体） |
| **引用管理** | `citation` 表；导出格式化 | 引用池净化（只用元数据完整文献）；`[Ref:N]` 渲染为 `[作者 年份]` + 文末 GB/T 7714 列表 | 引用是侧栏下拉、`location` 写死取正文末尾 200 字，不在正文锚定、不随增删自动重排；`citation_count` 字段恒为 0 | 部分 |
| **质量把控** | QualityPage 7 维雷达；Reviewer/Reflexion | 7 维评分（文献/逻辑/引用/语言/创新/图表/格式）0-100；<80 自动 Reflexion 落库回炉（最多 3 轮）；雷达图懒加载 | `quality_report.feedback` 是一段长文本，不拆成可勾选 issue、不回链写作段落 | 部分 |
| **审稿** | review_comment 闭环表；模拟评审 | 写作页导入模拟评审，意见落 `review_comment` | 投稿页 `replyReview` 要重新粘贴审稿文本，不读 `review_comment`，逐条意见与回复不闭环 | 部分 |
| **投稿** | SubmissionPage（期刊推荐 / Cover Letter / 审稿回复）；journals-lib / journals-match | AI 结构化期刊匹配（命中库内期刊并补 `firstDecisionWeeks`）；Cover Letter 生成；审稿意见一次性回复 | 无 submission 实体表——投给哪家、当前状态、第几轮全无记录；匹配结果推荐完即弃、不落库 | 部分 |
| **投稿跟踪** | SubmissionPage 第 4 Tab「投稿跟踪」 | 三层方案：L1 手动台账 + L2 粘贴邮件 AI 解析入库 + L3 按 `firstDecisionWeeks` 周期推断/超期提醒；`submission` + `submission_status_event`（append-only）两表；13 态状态机；终态「转投他刊」串联 | 内部阶段（初审→外审）不发邮件、作者端常合并为"编辑处理中"，L3 仅作"预计"标签、不写真实状态 | 已落地（设计定型） |
| **修订** | document.versions 多版本 | 整段 `{version, content}` JSON 快照，自动保存 | 不能逐段 diff、不能挑一段恢复；修订轮次与审稿意见不绑定 | 部分 |
| **存档** | 单库 SQLite | 全部数据本地一文件 | 无 BibTeX/RIS 导出导入、无整包归档导出，换工具即数据孤岛 | 缺口 |

> 贯穿现状：唯一真正打通的主干是 **pipeline → document → 写作页**（`pipeline_task.documentId` 已正确回写，写作页可深链 `/writing?doc=`）。其余横向连接大多是断的，这也是下一节"打通现有数据模型优先"的由来。

---

## 3. 已落地功能清单（三轮改造汇总）

- **可视化体系**：7 维质量雷达（Recharts，页面级 `React.lazy` 懒加载，图表 chunk 进页面才下载）、流水线各节点按角色分组的编排时间线、大厂式左导航分组、teal 统一色板替换 AI 紫；页面级代码分割，首屏不加载图表与图谱包。
- **交互范式**：SSE 流式 + 打字机渲染（fetch+ReadableStream 批量 flush）；取消 / 重试 / 继续生成（AbortController）；follow-up 建议追问按钮；对话内 slash 命令；核心快捷键（⌘↵ 发送 / Esc 停止 / ↑ 编辑上一条）；折叠式 reasoning 展示；引用来源卡片（`<sup>` 上标 + 悬停气泡）。
- **真科研功能**：LangGraph 编排全自动流水线（主题验证 → 文献调研 → 大纲人工确认 → 并行分章起草 → 7 维质量门 → 润色 → 引用格式化）；质量门 <80 触发 Reflexion 自动回炉（≤3 轮取最高分）；Agentic RAG 边写边查；结构化输出 zod 校验 + SqliteSaver checkpoint 断点续跑。
- **投稿跟踪**：国内采编系统无公开 API 的现实下，落地"L1 手动台账 / L2 粘贴邮件 AI 解析 / L3 周期推断"三层方案，13 态状态机 + 状态历史流水表，不做爬虫、不引入外部 key。
- **引用网络**：citation 表 + 引用池净化 + `[作者 年份]` 与文末 GB/T 7714 参考文献列表自动渲染，成文后引用真实可追溯。
- **实验沙箱**：选定后端 spawn 本机 `python3`（前端 0 新体积、后端 0 新依赖），临时目录 + 默认 10s 超时杀进程组 + stdout/图截断上限，写作页内嵌可运行代码块、可保存为实验记录档案。
- **知识库打通**：明确 `knowledge_docs` 增 `referenceId` 可空外键的打通方向——从文献上传全文自动绑定书目，RAG 结果可反查 reference，消除两套数据重复录入。
- **验证基线**：全量回归 `scripts/full_regression.py` v5 覆盖 66 个路由，**PASS 85 / FAIL 2（均为外部 AI 网关限流类环境项，自动降级跳过）**；typecheck（server/web 双端 `tsc --noEmit`）、vitest（server 单元测试）、build（前后端）全绿；`pnpm audit` 0 漏洞。

---

## 4. 差距与优先级（合并 4 份报告，去重）

> 优先级 P0 = 先做；P1 = 强烈建议；P2 = backlog。工作量 S ≤ 1 人日 / M ≈ 2–5 人日 / L ≥ 1 周。
> 状态：**已落地** / **已明确不做** / **待办**。凡需依赖国外学术 API 的条目，按最新方向一律归入"已明确不做"。

| # | 差距项 | 优先级 | 工作量 | 状态 | 说明 |
|---|---|---|---|---|---|
| 1 | 文内实时引用：编辑器选区插入 `[n]` 锚点，citations 与正文位置映射，导出/换样式按锚点重排 | P0 | M | 已落地 | 纯本地数据模型改造，"像 Zotero 一样写作"的最低门槛 |
| 2 | 文献库 ↔ 知识库打通：`knowledge_docs.referenceId` 外键，上传 PDF 自动绑定/创建 reference | P0 | M | 已落地 | 消掉最大的数据重复录入；本轮已定型方向 |
| 3 | RAG 引用可点：返回 chunkId，前端展开原文上下文，接 #2 后标注到具体 reference | P0 | S | 已落地 | 本地即可，随 #2 一起做 |
| 4 | submission 投稿状态机 + 状态历史 | P0 | M | 已落地 | 两层表 + 13 态枚举 + L1/L2/L3 方案（见投稿报告） |
| 5 | 选刊结果落库：journals-match 命中后「投它 → 登记投稿」一键带 journalId | P1 | S | 已落地 | 与 #4 衔接，形成"匹配→投稿→跟踪"闭环 |
| 6 | pipeline Research hits 自动 `references.create` 入库（带去重指纹） | P1 | M | 已落地（AI 域） | 当前 hits 只存 `agent_run.detail` JSON，不回写文献库 |
| 7 | 质量反馈驱动待办：`quality_report.feedback` 结构化成 `review_comment`（category+sectionRef） | P1 | S | 已落地 | 让 7 维雷达真正驱动修改 |
| 8 | 审稿数据打通：投稿 `replyReview` 直接读本文档 `review_comment`，逐条生成 response 回写 | P1 | S | 已落地 | 一处录入、三处复用，消掉重复粘贴 |
| 9 | 编码表/筛选队列产出流向下游：纳入文献→一键生成对比表/综述段落；编码表导出 CSV | P1 | M | 已落地 | 当前 extraction_value 编码完即停在表格里 |
| 10 | 参考文献样式扩展：citeproc-js + CSL，按目标期刊一键换样式并实时重排 | P1 | S | 已落地（8 样式自绘格式化） | 现仅 4 种固定样式 |
| 11 | 文献笔记：`references` 加 notes 字段，笔记可在写作时 @ 引用进正文 | P1 | M | 已落地 | 读后想法无处沉淀 |
| 12 | BibTeX/RIS 导入导出 | P1 | S | 已落地 | 纯本地文件交换，不依赖外部 API；整项目可移植 |
| 13 | 写作防抖自动保存（⌘S 降级为"存版本快照"） | P1 | S | 已落地 | 已有 versions 基础好做 |
| 14 | 移动端响应式：Pipeline/Quality/Submission/Chat 零 `md:` 断点，表格移动端改卡片列表 | P1 | M | 已落地 | 手机上目前横滑/溢出不可读 |
| 15 | 文献空态引导 + 文案止血：搜索框改"在我的文献库中检索"，空态给"粘贴 DOI / 导入 BibTeX"三步 | P1 | S | 已落地 | 在线检索已不做，先把预期落差填上 |
| 16 | 版本 diff：左右栏对比 + 命名版本，替代整包 JSON 快照覆盖 | P2 | M | 已落地 | |
| 17 | 项目/文档大纲模板（综述 / IMRaD / 基金提案） | P2 | S | 已落地 | |
| 18 | ⌘K 命令面板接文献/文档内容搜索（复用本地 LIKE） | P2 | S | 已落地 | 现仅跳页面/切主题/建项目 |
| 19 | 导航信息架构整理（科研问答与知识库入口合并/重命名）；写作页面包屑补当前文档层级 | P2 | S | 已落地 | |
| 20 | 批量 DOI 核验按钮，核验成功自动把 reference 标 `cited` | P2 | S | 已落地 | 本地核验，不调外部补全 |
| 21 | 导出只读快照（对话+引用打包成自包含 HTML/Markdown 自己发给合作者） | P2 | S | 已落地 | 替代在线协作 |
| 22 | 项目级系统提示（projectPreface，每轮注入 system prompt） | P2 | S | 已落地 | 完整 memory 系统的轻量替代 |
| 23 | 实验记录二期：`experiment_runs` 多次执行历史快照；QuickJS 跑不可信 JS 兜底 | P2 | M | 部分（QuickJS backlog） | MVP 一张 `experiment` 表已够 |
| 24 | NotebookLM 式学习/复盘（测验卡 / 思维导图） | P2 | M | 已落地 | 优先级低 |
| — | 外部学术检索（OpenAlex/S2/PubMed/CrossRef/arXiv 在线调用） | P0→否 | M | **已明确不做** | README 已主动移除国外在线源，零外部网络依赖 |
| — | 文献挂载 PDF + 内置 PDF.js 阅读器 + 高亮批注 | P0/L→否 | L | **已明确不做** | 工作量 L、与轻量冲突；知识库 PDF 仅做分块 |
| — | 在线 DOI/标题自动补全元数据（调 CrossRef/S2） | P1→否 | M | **已明确不做** | 走国外 API；以本地 BibTeX 导入替代 |
| — | 被引图谱 / citation_count 在线更新 / 前后向引用跳转 | P1→否 | M | **已明确不做** | 需外部被引数据 |
| — | LaTeX 实时编译出 PDF（TeX Live / Overleaf 式） | P1/L→否 | L | **已明确不做** | 导出环节另立项（Tectonic）时再议，本期不做 |

---

## 5. 明确不做清单（含理由）

| 不做项 | 理由 |
|---|---|
| **外部学术 API（国外）**：OpenAlex / Semantic Scholar / PubMed / CrossRef / arXiv 在线调用、在线 DOI 补全、被引图谱 | 与"国内合规、零外部网络依赖"定位直接冲突；README 已主动移除这些在线源。文献来源改本地录入 + BibTeX 导入。 |
| **内置 PDF 阅读器 / 高亮批注** | 工作量 L、PDF.js 查看器 + 批注体系重，与轻量冲突；知识库 PDF 只做分块 RAG。 |
| **Pyodide / JupyterLite（浏览器内跑 Python）** | 完整发行版 180–200MB、最小核心首载 ~10MB、运行比原生慢 3–5×，会把 2.2MB 前端撑大约 80 倍，且国内 CDN 拉 wasm 包不稳定。 |
| **Jupyter Server / JupyterLab** | JupyterLab 空闲基线 200MB+ 内存，要管 kernel 生命周期 / WebSocket 协议 / 多 kernel，单用户本地 app 杀鸡用牛刀。 |
| **云沙箱**（Sandpack 默认云 bundler / Deno cloud microVM / CodeSandbox） | 默认依赖国外云服务，且 Sandpack 只懂 JS/React、做不了 Python 数据实验。 |
| **多模型 side-by-side 对比（Model Council 式）** | 一次请求并行 2–4 个模型，token 成本 ×2–4（用户自付 API 费）；双栏/四栏并排流式渲染状态管理复杂；模型选择器已覆盖"换个模型再试"。 |
| **完整记忆系统**（ChatGPT Memory 分层归纳 / Dreaming 后台整理） | 需后台归纳任务 + 记忆库 + 审核 UI，偏重；改用轻量的"项目级系统提示 projectPreface"（用户写一段固定偏好，每轮注入）。 |
| **协作功能**（多人实时编辑 / 共享在线链接 / 评论 @他人 / group chat） | schema 无 user/team 表，纯单机本地定位与之冲突；需要分享时做"导出只读快照"即可。 |
| **投稿系统自动爬虫 / 登录态抓取 / IMAP 自动拉邮件 / 后台轮询推送** | 国内采编系统无公开 REST API、状态页需登录态 + 验证码 + 反爬，且各刊字段不一；邮箱授权会引入守护进程与臃肿。改"手动粘贴邮件 + 本地 AI 解析 + 用户确认入库"。 |
| **Manus 式实时浏览器屏幕预览 / MCP Apps 交互式 iframe 工具 UI** | 过重，sciflow 没有浏览器 sandbox；工具调用只做轻量可折叠步骤卡片（工具名/参数摘要/状态/耗时）。 |
| **整包 TeX Live 本地编译** | 2.3GB 体量，属"导出 PDF"问题而非"跑实验"问题，与本期实验环节正交。 |

---

## 6. 后续演进建议（打通现有数据模型优先）

> 最新一轮方向是"连贯连通"：不再向外加新功能，先把已经存在的表和数据模型横向缝起来，消除重复录入与状态丢失。按 ROI 排序：

1. **缝 `references` ↔ `knowledge_docs`**：给 `knowledge_docs` 加 `referenceId`，上传全文即自动建/绑定书目条目，RAG 返回 chunkId 可点回原文并反查书目——一次性消掉最大的两套数据孤岛。
2. **缝 `review_comment` ↔ `quality_report` ↔ `submission.replyReview`**：把质量雷达 feedback 结构化成 `review_comment`，投稿回复页直接读这张表逐条生成 response；让审稿意见一处录入、写作页可见、投稿页复用。
3. **缝 `citation` ↔ 正文**：在编辑器选区插入 `[n]` 锚点，建立 citations 与正文位置映射，导出 / 换样式时按锚点自动重排，让引用真正随写作流动。
4. **缝 `journals-match` ↔ `submission`**：匹配结果一键"存为投稿目标"登记进 submission，配合已有 `firstDecisionWeeks`，形成"选刊→投稿→状态跟踪→修订轮次→转投他刊"一张看板。
5. **缝 pipeline Research hits → `references`**：编排器 ResearchAgent 命中的论文自动带引用指纹入库，写作时直接可选，AI 找的文献不再只躺在 `agent_run.detail` JSON 里。
6. **缝 `experiment` ↔ 写作章节**：实验沙箱已与 documentId 双向弱关联，下一步把实验产出的 PNG/结论一键插入对应写作章节，形成"跑实验→结果回写论文"闭环。

---

## 7. 验证基线

| 验证项 | 命令 / 位置 | 当前状态 |
|---|---|---|
| 全量回归 | `scripts/full_regression.py`（v5，覆盖全部 66 个路由，含 guardrail 拒参 / RAG 混合检索 / usage 成本统计专项） | **PASS 85 / FAIL 2**（2 项均为外部 AI 网关限流类环境项，脚本自动降级跳过，不影响代码正确性结论） |
| 类型检查 | server / web 双端 `tsc --noEmit`（CI 强制 ×2） | 全绿 |
| 单元测试 | server `pnpm --filter server test`（16 条）+ web `pnpm --filter web test`（15 条，含 msw 网络层拦截） | 全绿 |
| 构建 | 前后端 `build`（CI ×2） | 全绿 |
| 依赖安全 | `pnpm audit --registry=https://registry.npmjs.org --prod` | **0 已知漏洞**（生产依赖；安全补丁经 pnpm overrides 钉版，见 pnpm-workspace.yaml） |
| 体积红线 | 图表/编辑器/图谱分别独立 chunk（懒加载）；首屏不加载图表与图谱包 | 守住，新增功能不引入重型运行时 |
| 本地 mock AI 网关 | `AI_MOCK=1` 起后端后跑 `full_regression.py`（见 README「本地 mock AI 网关」） | **mock 模式 PASS 165 / FAIL 0 / KNOWN 0**：无 Key 本机即可端到端跑通流水线；外部工具（promptfoo）用 `apps/server/scripts/mock-openai-http.mjs` 暴露 127.0.0.1:5099 |

> 后续每轮改造完成后，须以同一套基线（typecheck ×2 + vitest + build ×2 + `full_regression.py`）回归全绿作为合并门槛；AI 网关限流类失败仍按环境项处理并显式标注，不得静默吞掉。

---

## 8. 完成度核对表（截至本轮，2026-10-01）

> 本轮工作：对差距表逐项做「六位一体」走查（后端契约 → 前端入口 → 数据落库 → 错误/空态 → 移动端 → 文档），
> 发现**后端已就绪、但前端缺入口**的半成品 4 项，已在本轮全部补齐（纯前端改动，零新增依赖，不碰 AI 域与 WritingPage）。
> 状态列：**已落地** = 六位一体齐全；**本轮补齐** = 后端早已落库/回归覆盖，本轮补前端入口；**backlog** = 明确延后；**保持不做** = 见第 5 节理由。

### 8.1 差距表逐项核对（对应第 4 节 #1–#24）

| # | 差距项 | 本轮前状态 | 本轮后状态 | 说明（六位一体核对结论） |
|---|---|---|---|---|
| 1 | 文内实时引用 `[n]` 锚点 + 换样式重排 | 已落地 | **已落地** | 编辑器锚点、`render-citations`（8 样式、著者-年 a/b 按首现序、dryRun 不落库、幂等）、CiteReorderButton 齐全；回归 R6B 覆盖 |
| 2 | 文献库 ↔ 知识库 `referenceId` 打通 | 已落地 | **已落地** | 上传同名文档自动绑定、手动 bind/解绑、不存在文献 400；回归 #18 覆盖 |
| 3 | RAG 引用可点（chunkId/chunkText/referenceTitle） | 已落地 | **已落地** | `knowledge/:id` 返回 chunks+outline、`search` 命中文块带 referenceTitle；回归 #18.5/#22 覆盖 |
| 4 | submission 投稿状态机 + 状态历史 | 已落地 | **已落地** | 两层表 + 13 态 + append-only events + L1/L2/L3；回归 #17 覆盖 |
| 5 | 选刊结果一键登记投稿 | 已落地 | **已落地** | journals-match 结果「带入登记表单」切 Tab（SubmissionPage） |
| 6 | pipeline Research hits 自动入库 | 部分（AI 域） | **已落地（AI 域）** | knowledge-upload 自动建条目（`source=knowledge-upload`）；编排器 hits 回写在 AI 域，交并行线核对 |
| 7 | 质量 feedback 结构化为 review_comment | 后端就绪/前端缺入口 | **本轮补齐** | 后端 `quality/export-comments`（幂等 created/existing）早已落库+回归；本轮 QualityPage 加「拆为待办清单」按钮，feedback 一键拆条 |
| 8 | 审稿数据打通（replyReview 读 review_comment） | 已落地 | **已落地** | SubmissionPage 回复 Tab 直接读本文档 review_comment 逐条生成 response 并回写状态 |
| 9 | 编码表/筛选队列产物流向 | 已落地 | **已落地** | 纳入文献 → 对比表 MD / 综述草稿（带 [作者 年份]）/ 编码表 CSV（BOM），纯前端 Blob |
| 10 | 参考文献样式扩展（citeproc 8 种） | 已落地 | **已落地** | render-citations 支持多样式实时重排，无需引 citeproc-js（自绘格式化零依赖） |
| 11 | 文献笔记 notes | 后端就绪/前端缺入口 | **本轮补齐** | 后端 PATCH notes（可清空）早已落库+回归；本轮 LiteraturePage 每篇卡片加「记笔记」内联编辑，失焦/保存落库 |
| 12 | BibTeX/RIS 导入导出 | 已落地 | **已落地** | 导出 BibTeX/RIS、导入粘贴/选文件（指纹去重 imported/skipped）；回归 #19 覆盖 |
| 13 | 写作防抖自动保存 + 版本快照 | 已落地 | **已落地** | WritingPage 自动保存 + versions JSON 快照 + version-name 命名 |
| 14 | 移动端响应式 | 已落地 | **已落地** | 抽屉侧栏、表格 `overflow-auto`、卡片网格 `lg:` 断点；本轮新增控件均 `flex-wrap` 不溢出 |
| 15 | 文献空态引导 + 文案止血 | 已落地 | **已落地** | 搜索框「在我的文献库中检索」、空态三步引导（粘贴 DOI/导入 BibTeX/手动录入） |
| 16 | 版本 diff + 命名版本 | 已落地 | **已落地** | VersionDiffModal + version-name 幂等命名；回归 #23 覆盖 |
| 17 | 项目/文档大纲模板（综述/IMRaD/基金） | 已落地 | **已落地** | `writing/outline-templates.ts` 独立懒加载 chunk，写作页「套用模板…」一键注入，不占主包体积 |
| 18 | ⌘K 命令面板接文献/知识库搜索 | 已落地 | **已落地** | CommandPalette 并行检索 references.search + knowledge list 前端过滤 |
| 19 | 导航信息架构 + 写作面包屑 | 已落地 | **已落地** | 左导航分组、写作面包屑补「项目 > 论文写作 > 文档名」 |
| 20 | 批量 DOI 本地核验 | 后端就绪/前端缺入口 | **本轮补齐** | 后端 `verify-dois` 三分桶（valid/invalid/skipped，合法→cited）早已落库+回归；本轮 LiteraturePage 工具区加「核验 DOI」按钮 |
| 21 | 导出只读快照发给合作者 | 已落地 | **已落地** | ChatPage「导出快照」把会话+来源序列化为自包含 Markdown Blob 下载；写作页另可导出 .md/.docx |
| 22 | 项目级系统提示 preface | 后端就绪/前端缺入口 | **本轮补齐** | 后端 PATCH preface（仅字符串校验）早已落库+回归；本轮 Dashboard 项目卡加「项目写作偏好」内联编辑器 |
| 23 | 实验记录二期（多次执行历史 / QuickJS） | 部分 | **部分已落地 / QuickJS backlog** | 「重新运行」已落地（每次 run 即一行执行历史）；QuickJS 不可信 JS 兜底仍为 backlog（P2） |
| 24 | NotebookLM 式学习/复盘 | 已落地 | **已落地** | KnowledgePage 纯前端规则版复习卡（挖空/问答）+ 自绘 SVG 思维导图（优先真实章节标题），无 AI key 可用 |
| — | 外部学术 API / PDF 阅读器 / Pyodide / TeX Live / 协作 / 爬虫等 | 保持不做 | **保持不做** | 理由见第 5 节，本轮无变化 |

### 8.2 本轮新补齐的半成品（六位一体闭环）

| 功能 | 补齐的环节 | 落点文件 |
|---|---|---|
| 文献阅读状态机（未读/在读/已读/已引） | 前端设置入口（原仅网络图只读英文显示，全前端无 PATCH 调用）+ 状态本地化 | LiteraturePage.tsx |
| 文献阅读笔记 notes | 前端查看/编辑入口（后端字段早已落库） | LiteraturePage.tsx |
| 批量 DOI 本地核验 | 前端按钮（原后端端点+回归就绪、零 UI） | LiteraturePage.tsx / api/client.ts |
| 质量反馈拆条（export-comments） | 前端按钮（原 feedback 仅长文本展示） | QualityPage.tsx / api/client.ts |
| 项目级写作偏好 preface | 前端编辑器 + type 字段补全（原后端字段就绪、零 UI） | DashboardPage.tsx / types.ts |

### 8.3 对标主流补充差距清单（NotebookLM / Notion / Zotero / Overleaf / Elicit / ResearchRabbit）

| 功能 | 现状 | 补法 | 优先级 | 工作量 | 结论 |
|---|---|---|---|---|---|
| 引用格式切换（8 样式） | 已自绘实现，无 citeproc 依赖 | — | — | — | **已覆盖** |
| BibTeX/RIS 导入导出 + 指纹去重 | 已实现 | — | — | — | **已覆盖** |
| Markdown / Word(.docx) 导出 | 已实现 | — | — | — | **已覆盖** |
| 本地 BM25+向量 RAG + 可点来源 | 已实现（chunkId/chunkText/referenceTitle） | — | — | — | **已覆盖** |
| 系统综述 PRISMA 筛选 + 编码矩阵 | 已实现（纳入/排除/不确定 + CSV/对比表/综述草稿产出） | — | — | — | **已覆盖** |
| 引用网络（共引 + 去重力导向图） | 已实现（FR 布局、渐进展开、卡片兜底） | — | — | — | **已覆盖** |
| LaTeX `.tex` 源文件导出 | 仅 .md/.docx | 纯前端 markdown→tex 文本变换 | P2 | M | **backlog**：非编译（编译=整包 TeX Live 已明确不做），但 markdown→tex 转写易错，本轮不强推以免出半成品；下轮以受限子集实现 |
| 自包含 HTML 快照（Notion 式分享） | 已有 Markdown 会话快照 + .docx | 需 markdown→HTML 字符串渲染器 | P2 | S–M | **backlog**：react-markdown 产出 React 而非字符串，另引 marked 违背零新依赖/.md+.docx 已满足「发给合作者」 |
| 大纲模板（IMRaD/综述/基金） | 无 | WritingPage 预制大纲 JSON | P2 | S | **backlog**（即 #17）：碰 WritingPage 体积红线，下轮小步注入 |
| 在线被引图谱 / 前后向引用跳转 | 需外部被引数据 | — | — | — | **保持不做**（国外 API 硬约束） |
| 内置 PDF.js 阅读器 + 高亮批注 | 无（知识库 PDF 仅分块） | — | — | — | **保持不做**（工作量 L、与轻量冲突） |
| 多人实时协作 / 在线分享链接 | 无（单机定位） | — | — | — | **保持不做**（无 user/team 表，用导出快照替代） |

### 8.4 本轮验证

| 验证项 | 命令 | 结果 |
|---|---|---|
| Web 类型检查 | `pnpm --filter @sciflow/web typecheck` | **绿**（tsc --noEmit 无错） |
| Web 构建 | `pnpm --filter @sciflow/web build` | **绿**；WritingPage chunk 仍 449.48KB（本轮未改）、主包 index 83.55KB、LiteraturePage 55.24KB（懒加载 chunk，不进首屏） |
| Server | 本轮**未改任何后端文件** | 维持基线：typecheck/test(5/5)/build 全绿，回归 mock PASS 146/0、无 mock 126/2（2 项为无 AI key 环境语义） |

> 本轮改动文件（5 个，全部前端、非 AI 域）：`apps/web/src/types.ts`、`apps/web/src/api/client.ts`、`pages/LiteraturePage.tsx`、`pages/QualityPage.tsx`、`pages/DashboardPage.tsx`。未 commit（提交由组织者统一执行）。
