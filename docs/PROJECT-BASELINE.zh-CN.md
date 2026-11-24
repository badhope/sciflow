# SciFlow 项目基线（四模块）

> 基线锚点：版本 `v1.19.18`；`main` 包含产品提交 `b9e7a05`（2026-11-25 核验；本基线更新随后以文档提交落地）。
> 本文档是团队唯一的产品与工程基准信息源，固定为四个模块：**当前核心状态、已交付功能清单、待开发任务池、迭代规划路线图**。
> 文档随 `main` 演进：本文件合并后，基线锚点自动推进到合并提交；任何能力声明必须附可复核证据，禁止把计划写成已交付。

## 0. 变更纪律

| 规则 | 要求 |
| --- | --- |
| 单一事实源 | 能力、版本、测试数字只在本文件维护；路线图页只做索引，不另存一份口径 |
| 证据优先 | “已交付”必须能指向代码路径、测试、CI run、验收截图或发布资产之一 |
| 状态用词 | `已交付` / `开发中` / `待开发` / `阻塞` 四态；禁用“基本完成”“差不多” |
| 版本锚点 | 以根 `package.json` 与 `git describe --tags` 为准；当前 `1.19.18` / `v1.19.18` |
| 远端一致性 | 五个 Git 远端 `main` 必须同 commit；社区发布与代码镜像分开记录，不能混算 |

## 1. 当前核心状态

### 1.1 一句话定位

SciFlow 是**前沿 AI 原生、可审计、端到端自动化的科研助手**：用户只输入一个研究问题，系统自主完成多轮推理、路径自洽校验、文献证据、假设与协议、沙箱实验、评审回边、质量门禁与投稿包交付；数据落在一个 SQLite 文件，模型端点由用户配置。

### 1.2 发布与仓库状态

| 项 | 当前值 | 证据 |
| --- | --- | --- |
| 版本 | `1.19.18`（根/server/web/desktop 一致） | 四个 `package.json` |
| 代码 HEAD（本次验收） | `b9e7a05` | `git log -1`；后续文档提交不改变产品代码 |
| 标签 | `v1.19.18`（annotated `1277112` → `b9e7a05`） | `git show-ref --tags` |
| 五远端 `main` | 均包含 `b9e7a05` | `git ls-remote` × 5 |
| CI | run `45443174785` 三 job 全绿（`b9e7a05`） | GitHub Actions |
| 桌面安装包 | tag `v1.19.18` 触发 run `45457644913`，已成功；Release 资产 `SciFlow-Setup-x64.exe`、`SciFlow-Setup-1.19.18-x64.exe`、`latest.yml` | GitHub Actions |
| 发布正文 | `docs/RELEASE-NOTES.md`，禁用自动生成，避免重复拼接 | `.github/workflows/desktop-installer.yml` |

### 1.3 运行时与代码版图

```text
React Web UI ──HTTP/SSE──> NestJS API ──> 单个 SQLite（WAL）
      │                        │
      │                        ├─ LangGraph：pipeline（单次 DAG）
      │                        └─ LangGraph：research-cycle（多轮回边）
      └─ Electron 桌面壳（内置服务 + 自动更新管道）
```

| 层 | 位置 | 现状 |
| --- | --- | --- |
| 接口层 | `apps/server/src` | 38 个 controller，按 projects / documents / references / knowledge / pipeline / agent / research / submission / experiments / settings 等领域拆分 |
| Web | `apps/web/src` | React + Vite，hash router，SSE 进度流，PWA |
| 桌面 | `apps/desktop` | Electron 主进程、打包、自动更新 |
| 共享类型 | `packages/core` | 流水线步骤与 DTO 单一源 |
| 模型层 | `packages/ai` | OpenAI-compatible / Anthropic / Gemini 传输、提示词、mock 网关 |
| 数据层 | `packages/db` | Drizzle + SQLite，迁移账本 |
| 检索层 | `packages/retrieval` | FTS5 + sqlite-vec + RRF + MMR |

### 1.4 已实测的关键指标

| 指标 | 实测值 | 口径 |
| --- | --- | --- |
| server 单测 | 972 passed / 1 skipped（140 个测试文件） | 最新源码门禁 |
| web 单测 | 277 passed | 同上 |
| desktop 单测 | 5 passed | 同上 |
| API 回归 | 237 PASS / 0 FAIL | `scripts/full_regression.py`（全新库 + AI_MOCK=1） |
| 搜索 P95 | service 文档 1.26 ms；全类型 3.90 ms；HTTP 文档 4.44 ms | 1 万条数据 |
| 单次执行 token | 8,158 | 同窗口 `llm_call_log` 对账 |
| PWA | 168 条 precache / 8,706.62 KiB；旧缓存可被真实 update 清理 | 最终 build `2026-11-23T18:37:54.791Z` |
| 真实模型闭环 | 单问题 → PI → 专家门禁 → 沙箱 → Critic → `synthesize`，连续两轮 `supported`，22,199 / 16,681 tokens | cycle `230db717…`，证据见 `docs/verification/assets/research-cycle-real-model-2026-11-24.md` |
| 真实导出 | PDF 367,596 字节；分享 token 全链路含匿名评论/软删除/撤销 | F 轮浏览器验收 |

### 1.5 当前明确缺口与阻塞

| 级别 | 缺口 | 事实 | 处理 |
| --- | --- | --- | --- |
| P0 | 研究循环进程重启恢复 | 1.19.17 无 `OnModuleInit`；内存 `running` 锁重启后残留，执行中 cycle 可能永久停在非终态 | 本阶段已实现启动恢复 + 看门狗，见 §3.1 |
| P0 | 全自动链路压测 | 原 `full_regression.py` 只覆盖 API 行为，没有 cycle 并发/审批/预算/停滞压测 | 本阶段已新增 `scripts/research_cycle_stress.py`，见 §3.2 |
| P1 | 代码债务热点 | `packages/db/src/database.ts` 迁移仍偏命令式；`ResearchCycleService` / `PipelineService` 有长方法；`WorkspacePage.tsx` / `WritingPage.tsx` 体量大 | 进入重构队列，见 §3.3 |
| P1 | 向量知识库增量升级 | 已有 sqlite-vec ANN + FTS5 + RRF + MMR，不是空白；缺重排评估、嵌入版本化、维度迁移策略 | 增量升级，不重造 |
| P1 | 真实模型长链路稳定性 | 真实模型已能产出领域协议（与原问题重合度 0.73）并触发专家可执行驳回；但聚合网关会间歇性返回空响应/超时，单次结构化调用 3 次重试仍可能失败 | 已修 `pRetry` 被 `throw err` 短路的问题、强化 JSON 键约束；网关侧仍需备用模型/本地模型 |
| P2 | 飞书连接器真实凭据 | 自定义 Webhook / 应用模式均无真实凭据；报告已标 BLOCKED 并给接管路径 | 等用户提供凭据 |
| P2 | 五个内容社区上线 | 五个 **Git 远端**已对齐，但知乎/掘金/CSDN/博客园/B 站需要登录态或 API 凭据 | 不能冒充已发布；先备发布包 |
| P2 | 真实移动端 PWA | 只在桌面 Chromium 验证，未上真实 iOS/Android | 列入验收 |
| P3 | 版本号策略 | 当前 `1.19.x` 与用户偏好 `0.0.x` 不一致 | 需产品拍板，不在本文件擅自改号 |

## 2. 已交付功能清单

> 状态均为 `已交付`。每条只列用户可感知能力，不列内部实现细节；括号内是主要证据。

### 2.1 项目与工作台

- 项目创建/归档/删除、项目级设置、研究 Brief 维护（`projects`、`research-brief`）。
- 科研驾驶舱：项目进度、活动流、待办、质量趋势、用量概览（`dashboard`、`DashboardController`）。
- 全局搜索：文档/文献/知识库/会话等类型检索，1 万条 P95 已实测（`search`）。
- 统一导航与页面壳，亮/暗双主题；页面级上下文条（项目/研究计划）减少来回跳转。

### 2.2 文献与证据

- OpenAlex / Crossref / arXiv 检索与 DOI 补全（`references.service.ts`；DTO 枚举三源）。
- 文献入库、元数据编辑、BibTeX/RIS 导入导出、引用图。
- 单篇精读（三遍法提示词）、多文献横向对比、研究缺口发现。
- Zotero 作为用户自带文献库 API 保留；数据仍落本地 SQLite。
- 引用回跳与段落级锚点；证据库与 claim/evidence 关联。

### 2.3 知识库与检索

- 多格式摄入：PDF、Word、Markdown、文本、网页、EPUB；内联 `text` 上传已修复不被 `.pdf` 扩展名劫持。
- 解析与分块、来源追踪、知识库问答（带来源编号）。
- 检索融合：FTS5 trigram + sqlite-vec（`FLOAT[384]`）+ RRF + MMR + 跨 chunk passage 扩展。
- 嵌入后端：本地 GGUF / 远程 OpenAI-compatible `/embeddings`；失败降级纯全文，不阻塞主流程。
- 向量能力缺失时前端显式展示降级状态，不静默劣化。

### 2.4 研究设计与自主循环

- 研究计划对象：program → cycle → question → hypothesis → protocol → run → claim → evidence。
- 研究计划四道门与确定性 `research.plan_audit`；REST、写作页、文档质量门共用同一审计。
- LangGraph 多轮回边：`plan(PI) → gate → execute → evaluate(Critic) → decide → 修订回边 / synthesize / end`。
- 两种审批：`human`（interrupt 挂起，等人批）与 `ai`（独立专家审批，失败 fail-closed）。
- `L3+` 自动批准协议；`maxIterations` 1–10；`maxTokens` 预算；`STAGNATION_LIMIT=2`。
- 失败修复：PI 失败压缩提示重试一次；实验脚本失败回灌 stderr 修复一次；文献检索失败降级为空。
- 实验沙箱：Python 标准库 + numpy/pandas/scipy/statsmodels，超时/内存/输出截断/env 白名单；无 `print()` 视为失败。
- **本阶段新增**：启动恢复（有 checkpoint 自动续跑，无 checkpoint 标 blocked）、cycle 级心跳看门狗、手动断点恢复 API、研究循环健康/指标。
- **本阶段新增**：mock 网关覆盖 PI / 专家 / Critic / 实验者四角色，全自动链路不再只是概念演示。

### 2.5 写作与评审

- 长篇写作：大纲、分章起草、续写、重写、学术润色、翻译。
- 文档版本、段落级检查点、撤销/恢复。
- 引用体检：无文献池禁用引用；引用锚点回跳；残留引用红牌。
- 段落级审稿锚点与修改计划队列；作者可逐段处理审稿意见。
- 写作页与研究计划审计联动，避免“计划没审就开写”。

### 2.6 质量门禁

- 七维评审：文献、逻辑、引用、语言、新颖性、图表、格式。
- 项目级质量标准；未设置时回退全局标准。
- 确定性客观检查器（重复段落、引用、格式等硬伤）与 LLM 评审分离。
- 质量报告落库、趋势可视化、发布前质量门。

### 2.7 实验与验证工作台

- 实验/Web/浏览器三类验证合并为验证工作台，减少重复页面。
- Python 实验执行与运行记录（stdout/stderr/runtime/代码快照）。
- 浏览器验证能力（Playwright）与截图证据；远程控制页。
- 失败现场保留：失败 run 也落库，修复轮覆盖最终结果。

### 2.8 投稿与交付

- 投稿就绪检查（结构化清单 + 纯函数判定）。
- 期刊匹配、Cover Letter、投稿邮件解析、审稿回复信。
- 投稿包 ZIP：正文、图表、附件、模板、Cover Letter、元数据。
- 导出：PDF / DOCX / PPT / Excel；公开只读分享、匿名评论、软删除、撤销链接。
- PWA 离线重连壳；桌面安装包与自动更新。

### 2.9 Agent 与协作

- Agent 工具层、内置学术 MCP、外部 MCP 接入、Skills 按需加载。
- 计划级授权、工具预算、Agent 指标、运行轨迹。
- 会话服务端化、置顶/归档/搜索、分支对话、回答版本、附件与多模态输入。
- 后台任务/子智能体会话执行器、定时任务调度器、通知与重试。
- 分享会话只读评论；跨项目会话 guard。

### 2.10 运维与发布

- SQLite WAL + busy timeout；迁移账本替代 `ensureColumn`。
- `/health`、`/health/deep`、`/metrics`；本阶段新增研究循环 active / awaiting / blocked 指标。
- GitHub Actions：Types / Unit / Build、E2E + prompt evals、Full mock regression、桌面安装包。
- 五 Git 远端同步；Release 正文单一源 `docs/RELEASE-NOTES.md`。
- OpenAPI 268 paths；chunk budget；lint / typecheck / build 全门禁。

## 3. 待开发任务池

> 排序原则：先补“会让长跑任务丢结果”的可靠性缺口，再做能力升级，最后做品牌与发布。每项必须有验收口径，避免“做过了”但无法证明。

### 3.1 P0 研究循环可靠性（本阶段主攻）

| ID | 任务 | 验收口径 | 状态 |
| --- | --- | --- | --- |
| R-01 | 启动恢复：扫描非终态 cycle，有 checkpoint 自动续跑 | 单测覆盖 resumed / blocked / awaiting 三分支；真实重启后 cycle 能继续 | **已验收**：单测 + 真实重启 PASS |
| R-02 | 无 checkpoint 的执行中 cycle 标 blocked，保留已有结论 | 不伪造续跑；前端可一键重试 | 已实现 |
| R-03 | cycle 级心跳看门狗 | 超阈值无心跳 → blocked、释放 `running`、轨迹收尾；`awaiting_approval` 永不误杀 | 已实现，单测覆盖 |
| R-04 | 手动断点恢复 API + UI | `POST /research-cycles/:id/recover`；blocked 面板出现“从断点恢复” | 已实现 |
| R-05 | 预算门禁前移 | 计划阶段已超预算时，不进入实验执行 | 已实现，图测试覆盖 |
| R-06 | 真实进程重启集成验证 | 人工审批挂起 → kill 服务 → 重启 → 仍 awaiting → resume 完成 | **已验收**：`scripts/research_cycle_restart_test.py` 五节点矩阵全 PASS |
| R-07 | 自动执行中重启验证 | 在 execute 中途 kill → 重启自动续跑；需可控慢速 mock | **已验收**：PASS；`runs=1`，execute 重放不重复落库 |
| R-07b | 计划/评审/修订节点重启 | plan / evaluate / revise 中途 kill；重启后 claim/证据/run 不重复 | **已验收**：五节点矩阵 PASS；评审节点重建证据后 `evidence=2`，修订节点 `claims=2/runs=2` |
| R-08 | 幂等与并发启动 | 同一 program 并发 start 只允许一个；重复 start 不产生双 cycle | **已验收**：8 并发 → 1×201 / 7×400，最终 cycles=1、active=0 |
| R-09 | AI 专家驳回后的自动修订 | 驳回理由进入 PI 提示词，最多重写 2 版协议；连续驳回才终止 | **已实现**：图测试覆盖首次驳回后二次批准、连续驳回终止 |

### 3.2 P0 全自动链路压测

| ID | 任务 | 验收口径 | 状态 |
| --- | --- | --- | --- |
| S-01 | 专项压测脚本 | `scripts/research_cycle_stress.py`，覆盖并发、人工放行/驳回、专家驳回、预算、停滞 | 已实现，11/11 PASS；最新构建 25/25 PASS |
| S-02 | 失败修复路径压测 | 实验脚本首轮 SyntaxError → 第二轮修复成功；连续失败 → blocked/failed | **已验收**：API 级真实进程 PASS；attempt1 fail → attempt2 ok，claims=1/runs=1 |
| S-03 | 长稳压测 | N=20/50 顺序或低并发，1 小时无卡死、无锁泄漏、无 DB busy | **已验收**：20 并发自动 + 5 边界，25/25 PASS，结束 active=0/blocked=0 |
| S-04 | 重启压测矩阵 | 分别在 plan/gate/execute/evaluate/revise 五个节点 kill，验证恢复或 blocked | **已验收**：5/5 PASS（gate 由人工审批挂起场景覆盖） |

### 3.3 P1 代码规范化重构

| ID | 热点 | 问题 | 动作 |
| --- | --- | --- | --- |
| C-01 | `packages/db/src/database.ts` | imperative schema/migration 逻辑集中，难审计 | 拆迁移模块 + 单一 registry；保持幂等 |
| C-02 | `ResearchCycleService` | 启动/恢复/看门狗/执行投影混在一个长服务 | 拆 `ResearchCycleRecoveryService` / `ResearchCycleRunner` / 状态投影 |
| C-03 | `PipelineService` | 长方法、步骤分支多 | 按步骤抽命令对象；保持 SSE 契约不变 |
| C-04 | `WorkspacePage.tsx` / `WritingPage.tsx` | 页面体量大，数据与视图耦合 | 拆容器/视图/hooks；先加测试再拆 |
| C-05 | mock 与真实提示词契约 | 容易“mock 过了、真实不过” | 每次新增 mock 规则必须对应真实 prompt 匹配特征与契约测试 |
| C-06 | 死代码/无效分支 | AI 生成代码常见冗余 | 静态扫描 + 覆盖率 + 逐文件审计；禁止无证据大重写 |

> 重构原则：低耦合高内聚、函数/模块化优先、行为不变、测试先行；不做“为了好看”的全量重写。

### 3.4 P1 高价值能力补全

| ID | 能力 | 现状 | 下一步 |
| --- | --- | --- | --- |
| K-01 | 向量知识库 | sqlite-vec 384 维 + FTS5 + RRF + MMR 已有 | 增加 reranker 评估、嵌入模型版本化、维度迁移策略、金标集 |
| K-02 | 全场景提示词体系 | PI/实验者/Critic/专家已覆盖主链 | 建分支矩阵：跑题、专家驳回、实验失败、预算、停滞、文献空 |
| K-03 | OpenCode 生态吸收 | 已有工具/技能/MCP/审批骨架 | 只复用成熟底层：工具注册、权限、会话、LSP/诊断；不做无关功能 |
| K-04 | 证据链可审计 | claim/evidence/run 已落库 | 增加 evidence 覆盖率与“无证据结论”硬门 |
| K-05 | 项目级质量门 | 七维评审已有 | 增加自动修复建议与质量趋势回归 |

### 3.5 P1 交付与品牌

| ID | 任务 | 验收口径 |
| --- | --- | --- |
| D-01 | README 功能矩阵 | 用 `docs/screenshots/` 现有 24 张图，覆盖 dashboard/pipeline/programs/knowledge/quality/writing/submission/settings |
| D-02 | 全链路过渡动画与空态 | 页面切换、加载、错误、空态、恢复提示统一；不牺牲性能 |
| D-03 | 操作指引体系 | 首次使用引导、关键动作解释、危险操作二次确认 |
| D-04 | 异常场景友好提示 | blocked/断点丢失/模型未配置/向量降级均给下一步动作 |
| D-05 | 移动端 PWA 验收 | 真实 iOS/Android 至少各一台，离线壳与重连可用 |

### 3.6 P2 发布与外部依赖

| ID | 任务 | 阻塞/口径 |
| --- | --- | --- |
| P-01 | 飞书连接器真实链路 | 缺 Webhook/App 凭据；不能用假成功 |
| P-02 | 五个内容社区上线 | 缺登录态/API 凭据；先出发布包（标题/摘要/封面/链接），不冒充已发布 |
| P-03 | 版本号策略 | `1.19.x` vs `0.0.x` 需拍板；统一后一次改齐四个 package |
| P-04 | 桌面签名/公证 | Windows 安装包已出；签名与 SmartScreen 体验待补 |

## 4. 迭代规划路线图

> 不承诺具体日期，只承诺**退出条件**。每个里程碑完成时必须更新本文件 §1/§2，并附证据链接。

### M0 基线对齐（当前）

**目标**：四模块文档落盘、五远端同 commit、1.19.18 证据可复核。

**退出条件**：
- 本文件合并到 `main`，五个远端同步；
- `docs/README` 与根 README 链到本文件；
- 1.19.18 指标表与验收报告数字一致。

### M1 研究循环可靠性（进行中）

**目标**：长跑任务不丢、不卡死、可恢复、可观测。

**退出条件**：
- R-01 ~ R-05 全部有单测；
- R-06 真实重启集成证据（日志 + cycle 状态截图/JSON）；
- S-01 压测 25/25 PASS，S-03 长稳 20+ 轮无锁泄漏；
- `/health/deep` 与 `/metrics` 能看到 active / awaiting / blocked。

### M2 代码与提示词规范化

**目标**：去掉 AI 生成代码的结构性债务，提示词覆盖所有分支。

**退出条件**：
- C-01 ~ C-04 完成，行为不变，单测与回归全绿；
- 新增分支提示词均有契约测试；
- 静态扫描无新增死分支/重复模块；复杂度热点下降有前后对比。

### M3 能力纵深与开源融合

**目标**：向量知识库与证据链升级；吸收 OpenCode 等成熟工程能力，但只服务科研主链。

**退出条件**：
- K-01 金标集与 reranker 评估有基线/提升数字；
- K-04 无证据结论被硬门拦截；
- 引入的第三方能力均有“科研链路绑定点”说明，无边缘功能堆砌。

### M4 成品交付与品牌

**目标**：可直接部署、可演示、可发布。

**退出条件**：
- 全量门禁 + 压力测试 + 真实模型/本地模型双跑通过；
- README 功能矩阵与演示截图齐备；
- 五 Git 远端 Release 同步；五个内容社区发布包就绪（有凭据才执行发布）；
- 桌面安装包可安装、可升级；移动端 PWA 验收完成。

## 5. 证据索引

- 验收报告：`docs/ACCEPTANCE-REPORT.zh-CN.md` / `docs/ACCEPTANCE-REPORT.md`
- 发布说明：`docs/RELEASE-NOTES.md`
- 验收截图/PDF：`docs/verification/assets/`
- 功能截图：`docs/screenshots/`
- 产品路线图（能力表）：`docs/product-roadmap.md`
- 质量基线：`docs/QUALITY-BASELINE.md`
- 生态审计：`docs/ECOSYSTEM-AUDIT.md`
- 研究循环压测：`scripts/research_cycle_stress.py`
- 研究循环真实重启验收：`scripts/research_cycle_restart_test.py`
- 真实模型试跑记录：`docs/verification/assets/research-cycle-real-model-2026-11-24.md`
- 研究循环恢复/看门狗：`apps/server/src/research-cycle/research-cycle.service.ts`
- 研究循环图：`apps/server/src/research-cycle/research-cycle.graph.ts`
