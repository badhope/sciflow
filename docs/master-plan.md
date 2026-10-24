# SciFlow 开发主计划 v2（施工图版）
> v2.0 · 2026-10-17 · 基线 4ff8cde · 主仓 GitHub/badhope · 4 只读镜像自动同步
> **本文档是唯一开发计划真理源**。v1 是战略版，v2 扩展为施工图：每个工作项给出「现状 → 目标 → 分步实施（含文件落点）→ 验收标准 → 风险」。
> **给执行会话的话**：动手前先读 §2 的七视角清单和 §14 的需求追溯矩阵，确认你做的东西没有落入任何视角盲区；完成后在 §14 勾选。

---

## 0. 如何使用本文档

1. **每个工作项编号**（如 `B-3.2` 后端第 3 节第 2 项 / `F-2.1` 前端第 2 节第 1 项）。提交信息引用编号：`feat(B-3.2): RRF 融合排序`。
2. **步骤是强约束**：标了"Step 1/2/3"的必须按序执行；标了"可并行"的可拆 PR。
3. **验收标准是完成的定义**：没有跑验收 = 没做完。
4. 每完成一个里程碑，回写 §14 状态列，并同步 ARCHITECTURE.md。

---

## 1. 战略回顾（v1 结论保留）

- 不打文献图谱仗（OpenAlex 级数据壁垒）；不打本地隐私仗（无信息差）；**只打「AI 失效模式」仗**。
- 竞品矩阵、F1-F6 机会（引用体检/反同质化/实验设计/数据工作流/边界诚实化/科研社交图谱）详见 v1 §1 与本文 §9——已并入施工项。

---

## 2. 七视角防漏框架（每个工作项过一遍）

| 视角 | 自问 | 常见漏点 |
|---|---|---|
| V1 数据流 | 这条数据从哪产生、存哪、谁读、怎么删、如何备份？ | 孤儿行、备份不含新表、迁移漏列 |
| V2 用户旅程 | 新用户第一次碰到它是在哪个页面？空态/错误态长什么样？ | 功能完成但入口埋没、空态白屏 |
| V3 交付形态 | web/desktop/cli/mcp 四端都要能用到吗？桌面和 CLI 漏了 | CLI 没有对应命令、MCP 没暴露工具 |
| V4 质量 | 单测/黑盒回归/typecheck/lint 谁覆盖它？性能上限？ | 纯逻辑没单测、大输入没压测 |
| V5 安全 | 输入校验？注入面？密钥落库？外链防护？ | prompt 注入、SSRF、日志泄密 |
| V6 文档 | README/CONFIGURATION/ARCHITECTURE 哪里要同步？ | 功能上线文档滞后 |
| V7 商业 | 它对获客/留存/口碑哪个有贡献？可演示吗？ | 修了但没人知道（发 CHANGELOG/截图） |

> **使用规则**：§4-§8 每个工作项完成后，执行者必须在 PR 描述里附 V1-V7 勾选表。这就是"从整体/局部/多角度"的落地机制。

---

## 3. 全局架构与模块化（整体视角）

### 3.1 目标包结构（渐进迁移，禁止大爆炸）

```
packages/
  core/          # 纯类型+工具：types、json-guard、authors、fingerprint、csl（零依赖，全端可复用）
  db/            # schema.ts + database.ts + 迁移（仅 server/desktop 依赖）
  ai/            # transport + service + prompts + mock-gateway（依赖 core）
  retrieval/     # knowledge + embedding + 分块/融合/重排（依赖 db, ai）
  integrations/  # websearch providers + 未来学术源聚合（依赖 core）
apps/
  server/        # NestJS 壳：module/controller + 薄 service（逐步瘦身至路由+编排）
  web/           # React SPA（§5）
  desktop/       # Electron 壳（§6）
  cli/           # 独立 CLI 包（§7，从 apps/server/src/cli.ts 迁出）
```

**迁移步骤（适用所有包，一次性写清不再重复）**：
- Step 1 `pnpm --filter create` 建 packages/<name>，tsconfig references 指向 apps；
- Step 2 用 `git mv` 移动文件（保历史），**不改一行逻辑**；
- Step 3 老路径留 `export * from 'packages/...'` 兼容桶文件，全仓 import 不动；
- Step 4 tsc + vitest + 黑盒回归三绿后，删除一个桶文件=一次小 PR；
- Step 5 ARCHITECTURE.md §2.6 地图同步。
- **节奏：改哪个模块就迁哪个**，一次 PR 只迁一个包。

### 3.2 依赖规则（防劣化红线）

- packages/* 禁止互相 import（core 除外）；apps/* 禁止 import 其他 apps；
- packages 层禁止 import NestJS 装饰器（纯逻辑）；Nest 壳只做 DI 编排；
- 新增依赖必须走 §13.3 评审清单（license/体积/维护活跃度/开源优先）。

---

## 4. 后端施工图（apps/server → packages）

### B-1 数据层（packages/db）

**B-1.1 外键与级联（修 W4）**
- 现状：24 表零 FK，级联靠 service 手写（删项目时 references/chat_sessions 可能成孤儿）。
- 步骤：① `database.ts` 迁移函数 `fk_backfill()`：为 project_id 类列建 `idx_表_列` 索引 + 数据清洗（DELETE 孤儿行前先打印统计）；② SQLite 不支持 ADD CONSTRAINT → 用 `PRAGMA foreign_keys=OFF; 重建表` 的 12 步标准流程封装成 `rebuildTableWithFK()`；③ 先做 project/document/reference/experiment 四张高频表，其余下批；④ 级联策略统一 `ON DELETE CASCADE`（文献/文档）与 `ON DELETE SET NULL`（agent_step 留痕）。
- 验收：删 project 后孤儿行计数为 0 的断言脚本 + 全量回归绿。
- 风险：重建表丢触发器 → rebuild 函数内显式重建 FTS/vec 触发器（Step 2 必须包含）。

**B-1.2 版本快照瘦身（修 W5）**
- 现状：document.versions 存全量 JSON，上限 20 份，长文×多版本 DB 膨胀。
- 步骤：① 新表 `document_version(id, document_id, seq, content, commit_message, created_at)`，写入走事务；② 迁移：JSON versions 逐条搬入新表后删除 JSON 字段（ensureColumn 式兼容：读时两处合并）；③ pruning：保留最近 20 + 每 10 版抽 1 个里程碑快照；④ documents.service 读写改新表（`snapshotBeforeOverwrite` 同步改）。
- 验收：造 1MB 文档×50 次保存，DB 体积对比记录到 CHANGELOG；回归绿。

**B-1.3 备份一致性**
- 步骤：① `scripts/backup-db.mjs` 增量模式（sqlite online backup API + 按 mtime 复制 data/uploads）；② desktop 启动时若距上次备份 >24h 自动静默备份一份（保留 7 份轮转）。
- 验收：备份文件可在空环境恢复并通过 health + 文献列表非空断言。

### B-2 AI 层（packages/ai）

**B-2.1 模型分级路由完善**
- 现状：fast/strong 双档已在 transport 实现，但 pipeline 全用默认档。
- 步骤：① 梳理调用点分级表：translate/summarize/extractTopic=fast；draftSection/reviewPaper/polish=strong（`pipeline.graph.ts` 显式传 `model:'strong'`）；② `llm_call_log` 增加按档位聚合视图供成本页。
- 验收：跑一次流水线，llm_call_log 中 strong 调用集中在起草/评审/润色。

**B-2.2 成本预算器**
- 现状：只有 RPM 限流，无金额/Token 预算。
- 步骤：① `pipeline_config` 增 `budget_tokens_total`（0=不限）；② invokeGraph 前查 llm_call_log 当任务已耗 token，超预算→暂停任务并通知（复用 researchNotice 通道）；③ 设置页前端配预算。
- 验收：预算设 10k，跑流水线在 10k 处暂停且 UI 有明确提示。

**B-2.3 prompt 契约扩容**
- 步骤：① evals/promptfooconfig.yaml 从 4 case 扩到 10+（outline/quality/review/evidence/figures 全覆盖）；② GENERATE_FIGURES 的 GNN 硬编码示例改为领域无关模板（占位符由调用方注入领域词）——修审计 W 项。
- 验收：`pnpm eval:prompts` 本地全过。

### B-3 检索层（packages/retrieval）

**B-3.1 修 H2/H3（立即，M1）**
- H2 现状：`knowledge.service.ts likeSearch()` 无 LIMIT 全表加载。
  - Step1: SQL 改 `LIKE ? LIMIT _topK*3`（留重排余量）；Step2: FTS 分支同步 LIMIT；Step3: 黑盒回归加"千块文档检索"case。
- H3 现状：chat 注入只切 320 字符。
  - Step1: 注入长度提至 800（=CHUNK_SIZE）；Step2: 多命中时按分数预算总长 ≤4000 字符动态分配；Step3: 前端来源卡展示实际注入长度徽标。

**B-3.2 RRF 融合 + 重排（§9 F1 前置）**
- 现状：ANN/BM25 双路各自排序， ANN 优先。
- 步骤：① packages/retrieval/src/fusion.ts：`rrf(ranklists: T[][], k=60)` 纯函数+单测（空路/单路/并列）；② `knowledge.service.search()` 两路结果过 RRF 合并；③ app_setting `retrieval_rerank`（off|llm），on 时 fast 模型对 top20 重排（prompts.ts 加 RERANK 模板，输出 id 列表，解析失败回退 RRF 序）；④ 默认 off，流水线起草时强制 on（可演示点）。
- 验收：构造 20 条已知相关性 query 集，融合后 nDCG@5 ≥ 任一单路。

**B-3.3 分块与重叠（修 W36）**
- 步骤：① CHUNK_OVERLAP=120（~15%）进 splitter；② 旧库不重切（指纹跳过），提供「重建索引」按钮调 `reindexProject()`；③ 中文块边界优先在句号/换行断。
- 验收：重切后 BM25 命中边界主题的召回对比记录。

**B-3.4 嵌入批处理（修 W35）**
- 步骤：① embedChunks 用 p-limit(4) + 批量进度事件（SSE/日志）；② upload 返回 `{chunks, embedded, degraded}` 计数。

### B-4 流水线（apps/server/src/pipeline）

**B-4.1 并发互斥（修 H5，M1 第一刀）**
- 现状：同 project 可同时跑多条流水线，共享 p-limit(3) 互相踩踏。
- 步骤：① `pipeline.service.create()` 查 `status IN ('running','paused')` 同 project 任务→抛 409（前端提示"已有任务运行"）；② 用户级全局并发=1（单机单用户语义），跨 project 排队；③ 集成测试：并发 create 断言 409。
- 验收：黑盒回归新增并发 case；UI 文案清晰。

**B-4.2 Reflexion 定向回炉（修 H1）**
- 现状：`instructions` 永远 `[]`，feedback 只回传最后一条 note，每轮全量重起草。
- 步骤：① reviewPaper 输出的低分维度→映射章节（DIM_CN 已有映射，加 chapterHints 字段：让评审额外输出 `"weakest_section": "3.2"`）；② 回炉时只重起草 weakest_section（runDrafting 接 `onlySections` 参数）；③ instructions 数组真正累积：每轮 push `{"dimension":..., "note":...}`，起草 prompt 渲染为「修改指令」块；④ best-of-N 保留逻辑不变（整文评分仍全量 review）。
- 验收：合成 case——首轮 logic 35 分，回炉后该章重写且其余章节 content 不变（断言 diff）；总分曲线入库 reflexion_logs。
- 风险：局部改写破坏连贯 → 拼接时带前后各 1 章摘要作上下文。

**B-4.3 引用闭环（§9 F1 核心，M2）**
- 现状：citation-renderer 池锚定已有；无正文-参考文献锚定；无核验。
- 步骤：① 渲染时给每个引用点生成稳定锚 `^ref-N`（Markdown 脚注语法），参考文献列表转脚注定义——正文与列表自动对应；② 重排：插入/删除文献后按首现序重编号（已有逻辑）+ 脚注锚不变；③ 引用体检面板（新 controller `/api/documents/:id/citation-health`）：红牌=正文 [Ref:N] 无库内支撑；黄牌=库内高相关但正文未引（按 embedding 相似度>0.75）；④ 评审 prompt 加"引用与论证对应性"维度。
- 验收：演示文档三类牌齐备；写作页红牌点击跳转正文位置。

### B-5 文献层（packages/retrieval/references）

**B-5.1 修 H4（M1）**
- 现状：`references.service search()` 全表加载后 slice。
- 步骤：SQL 层 `WHERE title LIKE ? OR abstract LIKE ? LIMIT 50`（保留现有打分逻辑对这 50 条做）；作者解析等不变。
- 验收：1 万行假数据检索 <50ms（node --perf 记录）。

**B-5.2 学术源开源聚合（§9 F5，M2，全部可开关）**
- 步骤：① packages/integrations/src/sources/：`arxiv.ts`（arXiv API/镜像，检索+摘要+PDF 直链）、`crossref.ts`（DOI 元数据核验，仅元数据）、`pubmed.ts`（E-utilities，医学生物用户刚需）、`openalex.ts`（可选项，默认关）；② 统一接口 `AcademicSource { id, search(q), fetchByDoi/Id }`，结果映射 PaperHit 复用现有导入流；③ **每源独立开关**落 app_setting（`source_arxiv=on` 默认 arXiv/PubMed 开、CrossRef on、OpenAlex off）+ 文档页"数据来源"披露卡片（合规透明）；④ dedup 走既有 fingerprint。
- 验收：三源各搜一个真实主题返回可导入结果；关掉开关后完全不再请求（断言 fetch mock）。
- 合规说明：主动拉取公开 API ≠ 依赖国外云服务（用户主动触发、可关、无 SDK 依赖），CONFIGURATION.md 已更新口径。

**B-5.3 引用核验（F1 配套）**
- 步骤：① `citation-health` 加黄牌核验：有 DOI 的引用走 CrossRef `works/{doi}` 校验标题/年份一致性（结果缓存 webSearchCache 复用）；② 核验结果落 citations.verified 三态（0/1/2=核验不符）。

### B-6 集成层（packages/integrations）

**B-6.1 网搜 provider 补全**
- 已落地：五 provider + 配置 API + chat 兜底 ✅
- 步骤（收尾）：① 设置页前端表单（F-3.4）；② MCP 工具注册 `web_search`（mcp.service tools 表加一条，inputSchema {query}）；③ searxng 的 engines 过滤参数透传（`!general` 语法文档化）。

**B-6.2 Zotero 导入桥（开源生态，M3）**
- 现状：有 BibTeX/RIS 导入，无 Zotero 直连。
- 步骤：① Zotero 本地 API（http://127.0.0.1:23119/api/users/0/items，开源协议本地端点，零云依赖）；② 拉取 items→CSL JSON→现有 import 流；③ 增量同步：按 zotero 版本号游标。
- 验收：真实 Zotero 库 100 条导入，fingerprint 去重率打印。

### B-7 认证与安全
- B-7.1 步骤：① rate limit 按 AUTH_MODE 分级（jwt 模式 60/min，none 模式 240/min 放宽本地轮询）；② `uncaughtException` 改为记录+退出+desktop 层负责重启（修 W2，与 F-4.2 联动）。

---

## 5. 前端施工图（apps/web）★本轮重点补全★

### F-1 信息架构与导航

**F-1.1 导航重构**
- 现状：12 视图平铺侧栏 + ⌘K 面板雏形。
- 步骤：① 侧栏改三区：工作区（工作台/写作）、知识区（文献/知识库/记忆）、执行区（流水线/实验/投稿/质量）；② 视图注册表（App.tsx 已有）加 `group` 字段驱动分组渲染；③ 项目切换器升级：顶部项目名下拉带最近打开时间。
- 验收：三端（桌面 1440/笔电 1280/平板 768）截图对比无折叠重叠。

### F-2 可视化系统（用户点名重点）

**F-2.0 图表技术选型（先定规矩）**
- 决策：轻量统计图继续用自研 `components/charts.tsx`（SVG，可控体积）；**重量级交互图统一引入 `@xyflow/react`（MIT，DAG/流程图）与 `echarts-for-react` 按需 chunk（网络图/热力图/语义地图）**，两者都 lazy import（§5.5 懒加载清单）。
- 步骤：① charts.tsx 拆为 `charts/` 目录（每图一文件+story 样例）；② echarts 只引入用到的 renderers（bar/scatter/graph/heatmap）——bundle 上限 180KB gzip 写进 CI 检查。

**F-2.1 流水线 DAG 实时图**
- 步骤：① `PipelineDag.tsx`（@xyflow/react）：节点=步骤（topic-verify→…→polish），状态着色（pending 灰/running 蓝脉冲/done 绿/failed 红）；② 数据源：pipeline steps JSON（已落库）+ 2.5s 轮询合并；③ 节点点击侧抽屉显示该步 trace（agent-trace 已有数据）；④ 回炉循环画成回边（quality-gate→doc-create）。
- 验收：跑真实流水线，图与 steps 状态 100% 同步；节点点击 300ms 内开抽屉。

**F-2.2 知识库语义地图**
- 步骤：① 后端 `/api/knowledge/:projectId/map`：取全 chunks embedding → PCA-2D（纯 JS 60 行，不上 UAP 避免依赖）返回 [{x,y,docName,score}]；② `SemMap.tsx`（echarts scatter）：聚簇着色按文档、点选浮出 chunk 文本、与搜索联动（搜索命中点高亮呼吸动画）；③ 数据量大（>5k 块）下采样提示。
- 验收：5k 块项目渲染 <1s；点选→详情交互流畅。

**F-2.3 引用网络图增强**
- 现状：ForceGraph.tsx 有共引/dup 边。
- 步骤：① 社区着色（简单 label propagation 前端实现 ~80 行）；② 双击节点→打开该文献抽屉；③ 搜索框定位+聚焦邻域。

**F-2.4 成本仪表盘**
- 步骤：① `/api/settings/usage/summary`（按天/模型/档位聚合 llm_call_log，SQL 已有基础）；② `UsageStats.tsx` 升级：日堆叠柱（fast/strong）+ 预算线（B-2.2 数据）+ 单任务成本条形 Top10。
- 验收：跑 3 次流水线后仪表盘数字与 llm_call_log SUM 一致。

**F-2.5 质量雷达升级**：多版本叠加（本次 vs 上次评分同图）、维度历史折线（quality_reports 时序）。

**F-2.6 文献矩阵热力图**：编码字段×文献的覆盖度热力图（extraction_values 已有数据），空白格点击直接补录。

**F-2.7 流水线时间线**：甘特式步骤耗时条（steps 的 startedAt/endedAt），回炉轮次并列显示——成本可视化的另一面。

### F-3 交互系统

**F-3.1 ⌘K 命令面板全量注册**
- 步骤：① `commands/registry.ts`：动作注册表（跳视图/新建文档/跑流水线/搜索文献/切换主题/打开设置…），每项 {id, label, keywords, run}；② 现有面板改读注册表；③ 模糊匹配 fuse.js（MIT，8KB）。
- 验收：不摸鼠标完成"新建项目→导入 BibTeX→跑流水线"全流程。

**F-3.2 快捷键层**
- 步骤：① `hooks/useHotkeys.ts`（自写 30 行，window.addEventListener），冲突表：`g+w` 工作台、`g+l` 文献、`/` 聚焦搜索、`⌘K` 面板、`⌘Enter` 发送；② 设置页快捷键速查表。
- 验收：快捷键速查表与实现一一对应（测试遍历注册表）。

**F-3.3 拖拽与批量操作**
- 步骤：① 文献表 checkbox 批量选择→批量打标/移动/导出/删除（复用现有 API，前端聚合调用）；② 知识库上传区支持拖整个文件夹（webkitdirectory）；③ 大纲节点拖拽排序（writing 页 outline panel，HTML5 DnD 即可，不引库）。
- 验收：100 条文献框选 30 条批量打标 <2s。

**F-3.4 设置页网搜表单 + 全局空态**
- 步骤：① 设置页新增"联网搜索"卡：provider 下拉/SearXNG URL/各家 Key 输入（掩码回显）+「测试连接」按钮（POST /api/web/search?q=test）；② 抽 `EmptyState` 组件统一空态（图标+一句话+主 CTA），全 12 视图接入——修"功能完成但空态白屏"的 V2 盲区。

**F-3.5 流式体验细节**
- 步骤：① SSE 打字机加"停止"按钮显性化（已有 abort，UI 强化）；② 断流自动重试一次（保留已收文本，core.ts 已兜底 AbortError，加网络中断 retry）；③ 消息气泡操作条：复制/重试/引用此回答。

### F-4 页面级改造

| 页面 | 工作项 | 要点 |
|---|---|---|
| WritingPage | F-4.1 | 脚注式引用锚（B-4.3 配套）：点击红牌定位；写作侧栏 AI 助手（选中改写/扩写/降重，快捷键 ⌘J）；字数/引用数状态条 |
| LiteraturePage | F-4.2 | 数据源聚合表单（B-5.2）；Zotero 导入入口（B-6.2）；虚拟滚动（@tanstack/react-virtual，1 万行 60fps） |
| WorkspacePage | F-4.3 | 对话持久化到 server（新表 chat_message，修 H8）：会话列表/恢复/删除；localStorage 仅作未送达缓冲 |
| PipelinePage | F-4.4 | DAG 图接入（F-2.1）+ 并发 409 提示（B-4.1）+ 预算显示 |
| QualityPage | F-4.5 | 雷达升级（F-2.5）+ 引用体检面板（B-4.3） |
| KnowledgePage | F-4.6 | 语义地图（F-2.2）+ 重建索引按钮（B-3.3） |
| DashboardPage | F-4.7 | 项目总览聚合：成本卡+进度卡+最近活动（复用 F-2.4/2.7 数据） |
| SettingsPage | F-4.8 | 网搜卡（F-3.4）+ 快捷键速查 + 数据管理（备份/恢复入口接 B-1.3） |

### F-5 性能与体验基建（用户点名的优化策略落位）

- **F-5.1 懒加载清单**：路由级已有 ✅；补 echarts/xyflow/pdf 预览/ForceGraph/语义地图五个重组件 `React.lazy` + Suspense 骨架；**首屏 bundle 预算 250KB gzip 写进 CI**（size-limit action，超了红）。
- **F-5.2 骨架屏体系**：Skeleton 组件（ui.tsx 已有基础）覆盖所有 useQuery 加载态，禁 spinner 转圈（骨架更稳）。
- **F-5.3 请求去重与缓存**：React Query staleTime 分级（文献/知识库 60s，流水线状态 0s）；写操作统一 optimistic update + 失败回滚。
- **F-5.4 虚拟滚动**：LiteratureTable、KnowledgePage 列表、chat 消息流（>500 条）三处接 react-virtual。
- **F-5.5 主题**：暗色已有；补高对比模式（a11y）+ 跟随系统（prefers-color-scheme 三态切换）。
- **F-5.6 移动端/窄屏**：768px 断点抽屉导航（MobilePanel 已有雏形→全页面巡检）；表格横滚策略。
- **F-5.7 a11y 基线**：焦点管理（Modal trap）、aria-label 巡检（已有零星）、键盘可达（F-3.2 承载）。
- **F-5.8 i18n 基建**：文案抽 `locales/zh.ts` 单文件起步（不引 i18next，自写 t() 30 行），en 结构预留——README 双语已有，产品内文案统一收口。

---

## 6. 桌面端施工图（apps/desktop）

**F/D-6.1 自动更新器**（enterprise plan 遗留项）
- 步骤：① electron-updater 接 GitHub Releases（主仓发布产物）；② 未签名 win 包先用 NSIS+提示条；mac 公证后置（成本）；③ 设置页"检查更新"手动入口。
- 验收：发 v0.5.0 后旧版本检测到更新并可升。

**D-6.2 系统集成**
- 步骤：① 托盘图标（运行中流水线进度点）；② 文件关联（.bib/.ris 双击导入）；③ 原生通知（流水线完成/预算告警，接 B-2.2）；④ 崩溃恢复：主进程守门（B-7.1 的 uncaughtException 退出→desktop 拉起+错误页）。

**D-6.3 打包与体积**
- 步骤：① asar + electron-builder 目标 nsis/dmg/AppImage；② node-llama-cpp/better-sqlite3 原生模块 unpack + 平台产物矩阵（CI build matrix 已有，desktop target 补齐）；③ 产物体积记录进 CHANGELOG（基线 ~150MB，目标 <180MB 含模型说明）。

---

## 7. CLI 施工图（apps/cli 独立包）

- **C-7.1 从 server 迁出**（§3.1 步骤）+ **修 localApi spawnSync 怪胎**：`spawnSync('node',['-e',…])` 改原生 fetch（node ≥18 全局可用），顺带消灭字符串注入面（审计 W76）。
- **C-7.2 headless 全流程**：`sciflow run "主题" --auto --budget 50k --out ./paper/`——流水线无人值守（跳过 interrupt 用配置确认）+ 产物落盘（md+docx+引用列表）。步骤：复用 PipelineService（application context），interrupt 时读 `--approve-file`。
- **C-7.3 管道友好**：`sciflow search "..." --json | jq`——所有命令加 --json 机器输出；退出码语义化（0 成功/2 业务失败/3 配置缺失）。
- 验收：CI 里加 CLI 冒烟 job（mock 网关跑 run --auto）。

---

## 8. MCP 生态施工图

- **M-8.1 工具面补全**：现有工具表 + `web_search`（B-6.1）+ `citation_health`（B-4.3）+ `experiment_run`（experiments 执行，带超时/预算说明）。
- **M-8.2 资源暴露**：MCP resources 暴露 documents/references 列表（只读），让 Claude Desktop 直接引用。
- **M-8.3 安全**：external server guardrail 已有 ✅；补工具调用审计日志（agent_execution 复用）。

---

## 9. 数据与算法深度（差异化功能施工）

| 编号 | 功能 | 施工要点 | 验收 |
|---|---|---|---|
| F1 | 幻觉引用闭环 | B-4.3 + B-5.3 全链路 | 体检面板三类牌 + DOI 核验 |
| F2 | 反同质化引擎 | 大纲阶段强制生成 2 个「反共识大纲」变体供对比（prompt 注入对立检索词）；文献检索加"异见论文"加权（关键词 negate） | 每次规划产出 ≥2 变体且用户可一键换 |
| F3 | 实验设计助手 | `research/design` 新端点：输入研究问题→输出变量表/对照组/power analysis 提示（fast 模型+结构化）；结果存 research 设计表；前端写作页侧栏展示 | 案例主题产出完整设计稿 |
| F4 | 数据工作流 | experiments 沙箱接用户 CSV：上传→预览 schema→AI 生成分析代码（strong）→沙箱执行→图表回流正文（图表块语法 `![exp:id]`） | 内置示例数据集一键跑通 |
| F5 | 开源学术源聚合 | B-5.2 | 三源可开关 |
| F6 | 边界诚实化 | 所有 AI 生成块渲染时带淡色底纹+角标「AI 生成，需人工核验」（写作预览层 class，不进导出）；评审结论页固定免责声明 | 导出文件无标记、预览有标记 |

---

## 10. 质量工程

- **Q-10.1 测试分层**：packages/* 纯逻辑单测（fusion/authors/fingerprint/csl/secret-crypto 优先）；apps/server 集成（vitest + mock 网关）；full_regression.py 黑盒（66 路由基线）；e2e Playwright 冒烟（已有 2 spec→补流水线全流程 1 条）。
- **Q-10.2 测试写法步骤**（每个 packages 包通用）：`vitest.config.ts` 指向 src；CI 矩阵按包并行；覆盖率只对 packages/* 设门槛（行覆盖 ≥70%，防纯逻辑裸奔）。
- **Q-10.3 监控**：server pino 已有；补 `/api/health/deep`（db 往返+vec 扩展+ai 连通三探针），desktop 托盘菜单直接展示。

## 11. CI/CD 与发布

- 已落地：mirror.yml 四端同步 ✅。
- **CI-11.1 补齐**：① size-limit 前端预算 job（F-5.1）；② CLI 冒烟 job（C-7.3）；③ version bump 自动 CHANGELOG（changesets 或自写脚本，MIT 优先）。
- **CI-11.2 发布流**：tag → build 双平台桌面产物 + docker push（已有 compose）→ GitHub Release → mirror 同步 tag → mirror.yml 自动带 tag。

## 12. 文档体系（"写得好才有人看"）

- **D-12.1 CONFIGURATION.md** ✅已重写，随功能持续更新（V6 视角强制项）。
- **D-12.2 首页 README 重构**：10 秒动图（capture-screenshots.mjs 出 GIF）+ 三行价值主张（全流程闭环/自带预算/引用体检）+ Quick Start ≤5 步——对标 STORM README 的信息密度，不堆 badge。
- **D-12.3 教程系列**：`docs/tutorials/`——① 从 Zotero 到成稿 15 分钟；② 纯本地 Ollama 部署；③ 预算控制实战；④ 引用体检演示。每篇 ≤800 字+截图。
- **D-12.4 ARCHITECTURE.md**：模块化迁移后同步 §2.6 地图（3.1 步骤内置）。

## 13. 风险登记册

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| H1-H8 修复引入回归 | 中 | 高 | 每个 H 项独立 PR + 黑盒 161 项 + 分层测试（§10） |
| 模块化迁移断 import | 中 | 中 | 桶文件过渡（§3.1 Step 3-4），一次一包 |
| 学术源 API 限流/封禁 | 中 | 中 | 每源独立开关+本地缓存+礼貌 UA+文档声明 |
| LLM 成本失控 | 中 | 高 | 预算器+RPM+档位路由三层闸 |
| Electron 签名/公证 | 低 | 低 | 先未签名+文档，公证后置 |
| 上游 breaking（AI SDK/LangGraph） | 高 | 中 | lock 冻结+minimumReleaseAge+dependabot 跨 major 阻断（已有） |
| 四端镜像 token 泄露 | 低 | 高 | secrets 仅 CI 可见+force push 单向+令牌最小权限 |
| 前端 bundle 膨胀 | 中 | 中 | size-limit 红线（F-5.1） |

## 14. 需求追溯矩阵（v0.5.0 状态回写 2026-10-18）

> **M1/M2/M3 已完成并归档（tag v0.5.0）**：下表状态列保留作历史台账。续接开发从 HANDOFF.md §4 待办清单入手。（历史需求→落点，防遗忘台账）

| # | 需求（来源） | 状态 | 落点 |
|---|---|---|---|
| 1 | 五平台同步+推送 | ✅ GitCode 通；4 token 待换 | §0/§11 |
| 2 | 全部仓库 public + MIT | ✅ 已核验 | 报告 §一 |
| 3 | 深度审计+逐文件理解 | ✅ 报告+audit_notes | reports/ |
| 4 | 竞品调研+差距 | ✅ | §1/§9 |
| 5 | 商业定位"实在的" | ✅ 三判断 | §1 |
| 6 | 去掉"自带"（模型/Key 零内置） | ✅ 已提交 4ff8cde | B-2/B-3.4 |
| 7 | 仓库策略（2026-10-18 修订）：GitHub/badhope 唯一主仓；其余 4 端**手动**镜像（`git push <remote>`），不上自动化 CI/CD。mirror.yml 已移除，主仓 CI（ci.yml/dependabot）保留 | ✅ 定案 | §11 |
| 8 | 配置文档高质量非模板 | ✅ CONFIGURATION.md | §12.1 |
| 9 | 调研能力全部做进来 | 🔄 v1.0 落地 F2/F3（F1 引用体检 v0.6 已落地；F4 数据回流 backlog） | §9 F1-F6 |
| 10 | 模块化 | 📋 计划（渐进迁移法已写死） | §3.1 |
| 11 | 完整计划+优化策略+多端 | ✅ 本文档 v2 | 全文 |
| 12 | 开源最大化+闭源留口 | 📋 落地中（网搜✅/Zotero/学术源） | B-5.2/B-6.2 |
| 13 | 联网搜索自定义 provider | ✅ 五 provider | B-6.1 |
| 14 | **前端界面/可视化/图形/交互**（本轮点名） | 🔄 F-2.1~2.7 + F-3.1/3.2 已落地（F-3.3 批量操作 backlog） | §5 全节（F-2 可视化七件/F-3 交互五件/F-5 性能八项） |
| 15 | AI 失效模式差异化 | 📋 | §9 F1-F6 |
| 16 | 截图/预览更新 | ✅ 基线已有（v0.4.2） | D-12.2 GIF 化 |
| 17 | 桌面自动更新（enterprise plan 遗留） | 📋 | D-6.1 |
| 18 | 断点续跑/成本控制 | ✅ 基础已有；预算器 | B-2.2 |
| 19 | H1-H8 审计硬伤修复 | ✅ M1（v0.6） | B-3.1/B-4.1/B-4.2/B-5.1/F-4.3 |
| 20 | 文档体系（教程/README/架构同步） | 📋 | §12 |
| 21 | i18n / 暗色 / 移动端 / a11y | 📋 | F-5.5-5.8 |
| 22 | CLI headless / MCP 工具面 | ✅ v1.0（run --auto + MCP resources） | §7/§8 |

> **里程碑总表**：M1 正确性（B-3.1/4.1/4.2/5.1 + B-2.3）→ M2 检索与引用（B-3.2/3.3/4.3/5.2/5.3 + F-4.5）→ M3 模块化（§3.1 全部 + B-6.2 + C-7.1）→ M4 全端体验（§5 可视化交互 + §6 + §7.2）。每个里程碑结束：跑 §2 七视角自查 + 回写本矩阵。
>
> **v1.0.0（2026-10-24）回写**：F2 反共识大纲变体 + 研究深度 depth（对标 deep research 的 depth 语义）+ F3 实验设计助手 + F-2.7 步骤时间线 + F-3.1/3.2 命令面板注册表与快捷键速查 + M-8.2 MCP resources + Q-10.3 health/deep + C-7.1/7.2 CLI 原生 fetch 与 headless run 全部落地（契约见 ARCHITECTURE §2.14）；B-1.3 增量备份、F-3.3 批量操作、F4 数据回流仍为 backlog。

---
*执行原则：小步 PR、每步过 V1-V7、验收不跳过、文档同步不欠账。*
