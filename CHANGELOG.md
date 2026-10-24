# 更新日志 · Changelog

本项目格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，语义化版本号。以下按 `git log` 自底向上归纳历轮功能与修复，未含真实密钥。

## [1.0.0] - 2026-10-24

首个正式版：深度研究能力（对标 deep research 类工具）+ 反同质化 + 实验设计助手，外加 CLI headless 全流程与一批工程收尾。竞品调研对标 Stanford STORM / Elicit / NotebookLM / GPT-Researcher / PaperQA2（2026-10-24，结论沉淀于本批架构文档与 README）。

### Added（深度研究与差异化）
- **研究深度参数（depth 1-3）**：文献调研按轮递归——第 2+ 轮由 Planner 依据上一轮发现给出新检索词，命中跨轮去重合并、零新增自动收敛；流水线页/工作台均可切换（标准/深入/彻底），全局设置落 `pipeline_research_depth`。
- **反共识大纲变体（F2 反同质化引擎）**：大纲阶段一次产出「主推方案 + 2 个反共识变体」（挑战主流假设 / 另起组织框架），工作台确认卡与流水线大纲弹窗均可一键切换对比后采用；模型不支持时自动回退单大纲，流程永不中断。
- **实验设计助手（F3）**：研究问题 → 结构化实验设计稿（自变量/因变量/控制变量、对照组、样本量与统计功效提示、实验流程、分析计划、效度风险），落库可复看可删除；入口在「实验记录」页。
- **步骤耗时时间线（F-2.7）**：流水线详情新增甘特式耗时条（真实 startedAt/endedAt），哪一步最烧时间一眼可见。
- **命令面板注册表（F-3.1）**：⌘K 命令清单收敛到 `lib/commands.ts` 单一来源（label+关键词双通道模糊匹配）；设置页新增「快捷键速查」（F-3.2，与真实注册一一对应并有测试锁定）。
- **深度健康探针 `GET /api/health/deep`**（Q-10.3）：db 往返时延 / 向量扩展 / AI 配置三探针，运维巡检与桌面托盘可直接消费。
- **MCP resources（M-8.2）**：`sciflow://projects` 静态资源 + `sciflow://project/{projectId}/{documents|references}` 资源模板，Claude Desktop 等客户端可只读引用本地库。
- **CLI headless 全流程（C-7.2）**：`sciflow run --topic "主题" --auto --depth 2 --out ./paper/` 一条命令完成 建项目→流水线→自动确认大纲→导出 Markdown 论文；产物文件名取自论文标题。
- 前端工作台/流水线页新增研究深度选择器；实验页新增设计稿卡片（展开详情/删除）。

### Changed
- **CLI 重写 HTTP 层（C-7.1）**：`localApi` 从 `spawnSync('node',['-e',…])` 字符串拼接改为原生 `fetch`（node ≥18），消灭命令注入面；`pipeline run`/`doc export` 同步走 REST。
- `PipelineStepState` 增量字段 `variants`/`startedAt`/`endedAt`（纯增量，旧消费者不受影响）；`ResearchTraceEntry` 修正为线上真实契约 `{round,thought,action,query,found}`。
- 自定义提示词清单新增「实验设计助手」（可配即生效）。

### Verified
- server 新增 `pipeline-variants.spec.ts`（5 条，真图+真 SQLite）与 `experiment-design.spec.ts`（4 条）；web 新增 `commands.test.ts`（注册表/过滤/速查表 7 条）。
- 回归新增 10 条用例（深度探针/反共识变体下发/步骤时间戳/F3 设计稿 4 条/研究深度设置 3 条），其余契约不变。
- typecheck 双端 0 error；详见交付报告。

## [0.11.0] - 2026-10-23

品牌修订 2「墨流 · Ink Current」+ 信息架构合并批次。**科研问答并入工作台**（唯一对话入口），前端 -1 个重复页面、-602 行。

### Changed（品牌 · 墨流 Ink Current）
- **Logo 重做**：手绘感 S 曲线 → 几何双弧「墨流 S + 思想节点」（右上入水、左下出水，末端圆点=想法汇入水流）。唯一矢量源更新：`BrandMark.tsx` / `docs/brand/icon-master.svg`（1024 母版）/ `logo-mark*.svg` / `logo-horizontal.svg` / `favicon.svg` / `apple-touch-icon.*`；桌面 ICO/ICNS 经 `pnpm icons` 管线再生成。16px favicon 可辨识已实测。
- **设计语言去「AI 通用味」**：全局网格纹理背景移除（保留两团极淡品牌光晕）；Logo 釉面高光移除；主按钮常驻光晕改为 hover 出现（默认平面 + 细投影）；卡片阴影中性化（去 teal 色偏）；圆角刻度收敛（--r-lg 14→12）；指标卡数值加粗紧字距；新增品牌色文本选区。

### Changed（信息架构合并）
- **科研问答 → 工作台**：两处重复的对话界面（同内核同 MessageList）合并为一个。工作台补齐原科研问答全部能力：本地多会话（新建/重命名/删除/搜索，与旧页同 localStorage key，旧会话自动延续）、模型选择、深度思考、意图识别、slash 快捷指令（7 条）、followUps 追问建议、来源卡「引用进草稿」、Markdown 快照导出；保留工作台原有的文档预览/流水线运行卡/沉淀摘要注入。`ChatPage.tsx` 删除；`#/chat` 深链由 VIEW_KEYS 白名单自动兜底回工作台。
- **导航分组重排**：核心工作（工作台/论文写作/文献调研/知识库）→ 自动化（流水线/质量评分/投稿辅助）→ 记录与洞察（项目总览/实验记录/记忆中心）；命令面板与移动端 TabBar 自动跟随。
- **会话落盘改走内核 `onMessagesChange`**（删除 effect 内同步 setState，React Compiler lint 0 error）；slash 菜单改派生状态 + Esc 关闭记忆（同上）。
- **发送键统一**：工作台对话 Enter 发送 / Shift+Enter 换行 / ⌘+Ctrl+Enter 兼容（与输入区提示一致）。

### Verified
- typecheck 0 error；eslint 0 error / 1 warning（TanStack Table 已知互操作项）；web **67** 用例全绿；`vite build` 成功。
- 真实运行冒烟（AI_MOCK=1）：新 Logo 侧栏/favicon/登录门渲染正常；会话面板（本地会话+沉淀摘要）与 slash 菜单可用；对话内核端到端 mock 流式 667 字 0 pageerror；`#/chat` 深链兜底渲染工作台；390 无横向溢出。
- 已知后续：README 内 12 张截图仍为旧 Logo 时代画面（截图刷新涉及全页重拍，留待下批次）。

## [0.10.0] - 2026-10-23

交互基建统一批次：三处聊天入口收敛到同一内核、全局快捷键注册表、项目阶段条、可拖拽分栏。前端契约记录见 `ARCHITECTURE.md` §2.12。

### Added
- **统一聊天内核 `useChatSession`**（`apps/web/src/lib/chat-session.ts`）：工作台 / 科研问答 / 写作抽屉共用。累积回调强制走 `applyStreamDelta` 覆盖语义、停止保留已收文本并置 `stopped`、错误落到 `message.error` 可重试；发送/重试/续写统一触发 `onSend`（意图识别旁路）与 `doneTransform`（followUps 解析），`messageSuffix` 支持 FOLLOWUP_HINT 约定。此前三处各写一套 streamChat 回调，能力漂移（抽屉无来源卡、停止后不置 stopped）。
- **全局快捷键注册表 `lib/hotkeys.ts`**：mod 归一化（Mac ⌘ / Win Ctrl）、输入框保护、后注册者优先、handler 返回 `false` 放行外层；替换 7 处裸 `addEventListener('keydown')`（修「提示 ⌘S 但只在写作页生效」「Esc 被多处抢」类不一致）。App / ChatPage / WorkspacePage / WritingPage 四处接入。
- **异步动作三态 `lib/async.ts`**：`useAsyncAction`（running/error/idle + 防重复提交），替代手写 `setBusy/finally`（漏 catch 即静默失败）。ChatPanel 快捷动作、ChatPage「发送到写作页」接入。
- **项目阶段条 StageBar + `lib/stages.ts`**：六阶段（选题→文献→大纲→起草→评审→投稿）纯函数推断，只有真实数据才算完成（空项目不全绿），含待办角标（待确认大纲/未处理评审意见/逾期投稿）；`stages.test.ts` 5 条。AppShell 新增 `stageBar` 槽位，项目级页面共享。
- **移动端底部 TabBar**：AppShell 新增 `mobileTabbar` 槽位，窄屏高频视图一键可达。
- **可拖拽分栏**：`SplitPane`（写作编辑器左右栏）与 `useSplitDrag`（工作台预览宽度，localStorage 持久化）。
- **消息追问建议（followUps）**：科研问答页按 `---FOLLOWUPS---` 约定解析模型的后续追问，点击即以该问题续发（含历史上下文）。

### Changed
- **`MessageList` 成为消息渲染唯一入口**：思考流折叠、来源卡（展开原文/引用进草稿）、token 用量、消息操作（复制/重试/继续/删除/发送到写作页）只保留一份实现；工作台/科研问答/写作抽屉全部接入，消除「抽屉没有来源卡」类能力漂移。
- **工作区草稿中的 `lib/optimistic.ts`（useOptimisticList）未随批次保留**：其撤销语义要求后端恢复接口，服务端无任何 restore 端点，属无法真实接线的死代码（同 F-013「配了不生效」类缺陷）；该文件从未进入提交历史。

### Verified
- `pnpm --filter @sciflow/web typecheck` 0 error；`npx eslint .` 0 error / 1 warning（TanStack Table 已知互操作项）；web **67** 用例全绿（含 WorkspacePage 8 条行为用例改走内核路径，D1 累积回归有效）；`vite build` 成功（22.7s）。
- server 端本批次零改动（基线 99 用例不变）。

## [0.9.0] - 2026-10-23

品牌与体验打磨批次 + 全维度审查驱动的数据完整性修复。审查报告见 [`docs/AUDIT-2026-10-23.md`](docs/AUDIT-2026-10-23.md)（35 条发现、具名竞品矩阵、路线图）。

### Security
- **Critical · PATCH 可越权改写非白名单字段**：`PATCH /documents/:id` 曾把整个 body 展开进 `db.update().set()`，实测可改写 `id / projectId / version / versions`（企业模式下等于绕过项目归属边界）。改为白名单 `{title, content, outline, status}`，其余字段一律丢弃。

### Fixed（数据完整性）
- **Critical · 顺序编码样式只渲染 1 条参考文献**：`renderCitations` 给每条文献同一个 CSL id `'entry'`，citation-js 按 id 去重，IEEE / Vancouver / GB-T / Nature / ACS 只输出最后一条。改为唯一 id，新增 5 样式「条数=引用数」断言。
- **删文档级联漏表**：只清 `citation / polish_record`，漏 `quality_report / review_comment / experiment` 且 `pipeline_task.documentId` 悬空。改为事务内清 6 张表并置空。
- **删文献不级联**：`citation / screening_queue / extraction_value` 残留，孤儿引用让 `citation-audit` 假绿（`citationRows` 仍计孤儿）。改为事务级联；audit 只计可解析引用并显式报孤儿。
- **删流水线残留 LangGraph 断点**：`reflexion_log / checkpoints / writes` 不清理，且运行中任务可被删除后继续写库。改为事务清理 + 运行中禁止删除。
- **手动快照版本号重复**：快照复用当前版本号，下一次保存再 push 同号快照。改为 `max(history)+1`。
- **导出参考文献顺序错位**：按 `inArray` 库序而非 citation 插入序，正文 `[n]` 与文末编号不一致。统一走 `listCitations()`。
- **引用体检假绿**：孤儿 citation 计入 `citationRows`，删除文献后仍报 ghost=0。现在按可解析引用计数并单独报孤儿。

### Fixed（功能与契约）
- **ReAct 检索轨迹恒空**：`pipeline_task.trace` 全库无写入点，前端面板永不显示。literature 节点现在按真实跨库命中写入轨迹（本轮演示 4 步）。
- **入参缺失返回 500**：`POST /documents {}` / `POST /pipeline {}` / `POST /references/search {}` 直接 500；文献空元数据 201 + 空 body。统一 400 校验。
- **写接口不校验项目存在**：流水线、知识库上传、投稿登记可挂到不存在的 `projectId`。三入口统一校验。
- **质量评分不校验文档存在**：可给不存在的 documentId 落报告。补存在性 404。
- **6 个自定义提示词配置不生效**：polish / translate / writeOutline / draftSection / cover_letter / response_letter 接入 `getCustomPrompt`（此前 listTools 可配但运行时不读）。
- **Agent token 统计恒 0**：`finishRun` 从不传 totalTokens。按时间窗聚合 `llm_call_log` 回填。
- **springer 样式前后端判定不一致**：前端当顺序编码制拦截「无需重排」，后端按著者-年改写正文。统一为著者-年。
- **性能**：Dashboard 计数改 `COUNT(*)`；投稿列表由 2N 次逐行查询改为批量 `IN`。

### Fixed（品牌与体验）
- **写作页三条数据损坏路径**：切文档标题串档（失焦写到错误文档）、切项目后仍编辑上一项目文档并写回、自动保存失败静默仍显示「已保存」。分别改为 `key={doc.id}` + docId 快照校验、项目级页面 `key={project.id}` 重挂载、保存中/已保存/失败重试三态 + 离开提醒。
- **写作页加载态误报空态**：文档列表未返回前先渲染「空空如也」，改为骨架屏。
- **触屏操作不可达**：消息操作、项目改名/删除等 hover-only 入口在触屏永久不可见，改为触屏常显 + 桌面 hover。
- **危险操作无确认**：文献删除、期刊移除、投稿记录删除、会话删除均改为 `ConfirmDialog`。
- **品牌对比度不达 WCAG AA**：品牌渐变首段白字仅 3.31:1、teal-600 按钮 3.74:1、暗色渐变白字 1.8:1。渐变改为 4.80/5.07/5.14:1，新增 `--brand-700` 与 `--on-brand`（暗色深墨字 6.8–9.4:1）。
- **页面标题图标不可见**：`brand-gradient-text`（background-clip:text）套在 SVG 上导致图标透明，6 处改为实色。
- **导航命名与图标统一**：`NAV_GROUPS` 直接引用 `VIEW_LABELS`（消除「长文写作/论文写作」等三套叫法）；文献 Library、实验 Beaker、总览 LayoutGrid，消除同图标表达不同功能。
- **页面容器与字号统一**：4 种最大宽度收敛为 `--page-max: 1152px`；9–10px 正文级文字统一提升到 11px。
- **390 横向溢出**：dashboard / pipeline grid 子项补 `min-w-0`，文献 7 个工具 Tab 改换行（1440 下最右从 1623px 收回屏内），写作页 AI 助手按钮移出滚动区。
- **主题三态 + 无闪白**：新增「跟随系统」，`index.html` 内联脚本预置 `.dark`，暗色刷新不再闪白。
- **空态与文案**：空态补插图/下一步 CTA；「STORM 式 / Elicit 式 / NotebookLM 式」等内部术语与竞品名改为能力描述；设置页不再暴露 `apps/server/.env` 路径；投稿状态下拉不再直出内部枚举。
- **字数统计失真**：`0.1K 字` / `0K 字` 改为精确字符数（<1000 显示原值）。
- **会话重命名**：原生 `window.prompt` 改为应用内 Modal。

### Added
- `apps/server/src/documents/documents-integrity.spec.ts`：6 条真实 SQLite 完整性回归（白名单/级联/快照/导出/引用渲染），突变验证有效（回退修复必红）。
- `apps/web/src/lib/{format,theme}.ts` + 测试：字数格式化与主题解析纯函数。
- `scripts/seed-demo.mjs`：可重复执行的演示数据种子（只走 REST API，库非空自动跳过，`RUN_PIPELINE=1` 可跑通流水线）。
- `docs/AUDIT-2026-10-23.md`：全维度审查与对标报告。
- `docs/media/demo.mp4`：24 秒真实操作导览视频。
- README 中英文版：12 张实机截图 + 视频 + 设计语言规范表。

### Verified
- typecheck 双端 0 error；eslint 0 error / 1 warning（TanStack Table 已知不兼容）；server **99** / web **62** 用例全绿；回归 **167/167**；双端 build 成功。
- Playwright 12 页 × 1440/390 + 明暗双主题 36 张截图，**0 pageerror、0 横向溢出**。
- 覆盖率（v0.9 末态）：server 行 36.94% / 分支 21.63%，web 行 43.12% / 分支 38.91%（仍低于红线，见 QUALITY-BASELINE）。

## [0.8.1] - 2026-10-22

### Fixed
- **桌面端打开后白屏（用户实测反馈「什么都没有」）**：两层根因叠加。
  1. web 用默认 `base: '/'` 构建，`index.html` 里是 `/assets/*.js`；Electron 通过 `file://` 加载时
     被解析成 `file:///C:/assets/...` → 全部 404。
  2. 改成相对路径后仍白屏：`file://` 页面 origin 为 `null`，Chromium 按 CORS 拒绝加载
     `<script type="module">`（`Access to script ... blocked by CORS policy`）。
  修复：Electron 注册 `app://` 自定义协议（`standard+secure+corsEnabled`）从 `resources/web`
  提供静态文件；桌面构建固定 `vite build --base=./`；`prepare-server.mjs` 增加 `assertWebRelative()`
  打包前强校验；新增 `apps/desktop/src/desktop-assets.spec.ts`（5 条静态契约，突变验证有效）。
- **桌面端错误不可观测**：新增 `desktop.log`（`%APPDATA%/@sciflow/desktop/logs/`），记录
  `did-fail-load` / `render-process-gone` / 渲染进程 error 级 console，避免下次只能看到白屏。

### Verified
- 打包产物实测：窗口标题 `工作台 · SciFlow`；CDP 探针 `root children=2`、`apiBase` 已注入、
  控制台 0 错误；`#/chat` `#/writing` `#/literature` `#/quality` `#/settings` 路由全部正常。
- 安装包 `SciFlow-Setup-0.8.1-x64.exe` 662MB；`pnpm --filter @sciflow/desktop dist` 可复现。
- 桌面端产物独立到 `apps/web/dist-desktop/`（`base=./`），网页部署仍用 `apps/web/dist/`（`base=/`）；
  两者不再互相覆盖（此前共用 dist 导致「刚修好又被 web build 覆盖回绝对路径」）。

## [0.8.0] - 2026-10-22

全维度安全审计批次：以可复现 PoC 为依据修复 4 个高危问题，补齐全表级联测试与运维/安全/质量基线文档。

### Security
- **Critical · 默认 JWT 密钥可伪造管理员令牌**：`AUTH_MODE=jwt` 时若未设 `JWT_SECRET`，此前回退到硬编码字符串 `sciflow-local-secret-change-me`，任何人可离线签发 `role=admin` 令牌。实测伪造 token 请求返回 200（完全绕过鉴权）。现强制：jwt 模式必须显式配置 ≥32 字符密钥，否则**拒绝启动**；本地模式用进程内随机密钥。复测：旧默认密钥伪造 → 401。
- **High · SSRF**：外部 MCP 服务器 URL 与 SearXNG 实例地址完全由用户输入，服务端直接 `fetch`/建立 MCP 连接。实测可请求 `http://127.0.0.1:3000/api/health` 与 `http://169.254.169.254/latest/meta-data/`。新增 `common/outbound-guard.ts`：拒绝回环/私有/链路本地（含云元数据）/CGNAT/保留/组播地址，域名 DNS 解析后二次校验（防 rebinding），拒绝内嵌凭据 URL；本地自建服务用 `ALLOW_PRIVATE_OUTBOUND=1` 显式放开。复测：内网地址 → 400。
- **High · IDOR**：`GET/PATCH /api/documents/:id` 仅按主键取数，实测用另一身份可直接读取/改写他人项目文档。新增 `ProjectAccessService` + `project.owner_id` 迁移：jwt 模式下按归属校验（越权统一 404，不泄露存在性），项目列表按 owner 过滤，文档列表必须带 `projectId`。本地模式 no-op（回归 169/169 证明未破坏单用户行为）。复测：第二身份读/写他人文档 → 404。
- **High · 开放注册**：`@Public()` 的注册接口在已有用户时仍允许自助开户，空库首位注册即管理员。现默认仅空库首次可注册，之后返回 403；确需开放用 `ALLOW_REGISTRATION=1`。
- **Medium · 引用体检假绿**：正文无锚点时 `score=100` 且无提示；且只识别 `[n]`，正文用 `[Ref:n]` 时误判 0 锚点。现兼容 `[n]`/`[Ref:n]`/`【n】`，无锚点时封顶 60 并提示。
- **Medium · 备份脚本完全不可用**：`scripts/backup-db.mjs` 因 `const { default: Database } = require('better-sqlite3')` 抛 `Database is not a constructor`，备份功能实际从未工作。已修复并完成备份→恢复回灌实测（45 张表 / 5 个项目完整）。

### Tests
- 新增 `outbound-guard.spec.ts`（11 条 SSRF 用例，含 DNS/字面量/IPv6-mapped）。
- 新增 `projects-cascade-full.spec.ts`：21 张表全量 seed + 归零断言（旧版只覆盖 8 张，删 `references` 级联仍全绿；现突变验证会红）。
- `charts.test.tsx` 的 Donut 配色断言改为可执行断言（抽出 `donutCellColors` 纯函数）；突变 `SERIES[(i+3)%]` 实测变红。
- 回归新增 27.4 / 27.5（`[Ref:n]` 锚点识别、无锚点封顶）；总数 167 → **169**。

### Docs
- 新增 `docs/SECURITY.md`（威胁模型、6 个已修复问题的 PoC 与复测、已接受风险清单）
- 新增 `docs/OPERATIONS.md`（SLI/SLO、健康检查、备份恢复实测、故障处置表、企业模式上线检查表）
- 新增 `docs/QUALITY-BASELINE.md`（覆盖率/复杂度/变异分数实测值与红线判定，含不达标项清单）
- `.env.example` 补充 `ALLOW_REGISTRATION` / `ALLOW_PRIVATE_OUTBOUND` 及密钥强度要求

### Changed
- 服务端单测 74 → **88**；web 57 保持；回归 167 → **169**。
- 每个页面补 `h1`（视觉隐藏，供读屏与文档大纲）——审计发现 12 个页面全部无 h1。

## [0.7.0] - 2026-10-21

真实可用性批次：独立审计（功能真实性 / 测试有效性 / 环境韧性 / 体验）驱动，先把「看起来有、实际不工作」的功能修到真的能用，再补测试与品牌。

### Added
- **科研问答会话化**：左侧会话侧栏（新建 / 搜索 / 重命名 / 删除），按项目隔离并落 localStorage；刷新、切页、切项目都不丢；输入草稿 300ms 防抖保存。
- **输入区「联网」开关**：按轮生效，`POST /api/chat/stream` 新增 `webSearch`，服务端即使知识库有命中或全局兜底关闭也会执行网搜（此前只有全局兜底开关，且默认关）。
- **消息级操作**：问答页与工作台都补齐「复制（带勾选反馈）/ 重新生成 / 删除单条 / 重试」，问答页另有「继续生成」；清空对话走二次确认。
- **空态引导**：问答首屏给 4 张「试试这样问」场景卡，点击填入输入框。
- **环境自检升级**：`/api/settings/check` 增加检索栈能力（向量扩展 / 嵌入模型 / 全文索引）与逐条修复指引；`/api/health` 增加 `capabilities`。
- **品牌修订**：新的流动 S 标志（一笔流线 + 渐变底），`docs/brand/*` 与 favicon / apple-touch-icon / 桌面图标全部同源再生成。

### Fixed
- **设置页永久「加载配置…」**：Provider 此前只在「刷新」按钮里调用 `load()`，首次进入永远空白。
- **三类纯文本接口全部报「无法解析的数据」**：`request()` 现在识别 `text/*` 按文本返回——Cover Letter、审稿回复、AI 文献综述恢复可用。
- **科研问答 Markdown 不渲染**：改用 Streamdown（代码块/表格/公式/列表），并补 `.markdown-body` 排版。
- **科研问答不在导航**：并入「核心工作」，⌘K 可搜。
- **切项目串话（隐私级）**：页面按 `project.id` 重挂载，旧项目消息不再写进新项目的 localStorage。
- **停止生成是空壳**：abort 后保留已收文本并置 `stopped`，显示「已停止 · 继续生成」；Esc 改为 window 级监听。
- **编辑消息丢历史**：改为载入输入框重发（原消息保留），不再静默截断。
- **输入体验**：单行 input → 自适应高度 textarea；Shift+Enter 换行；中文输入法组词中的 Enter 不再误发送；斜杠菜单支持 ↑↓ 高亮与 Enter 执行选中项。
- **暗色模式白卡浅字**：`Card`/`Modal` 改 `var(--card)`；辅助文字对比度从 2.6:1 提到 4.6:1。
- **项目总览恒为 0**：`dashboard.service` 的 SQL 写成 `documents.id`（物理表是 `document`），异常被整体 catch 吞掉；改为 `document.id` + 分块降级 + 错误日志。
- **用量统计显示 `null%` / `nullms`**：无调用时聚合值为 NULL，补 `COALESCE`/`NULLIF`。
- **文献页 390 固定 828px 被裁**：网格子项补 `min-w-0`。
- **写作编辑器不换行**：CodeMirror 启用 `EditorView.lineWrapping`。
- **Modal 无对话框语义**：补 `role="dialog"` / `aria-modal` / `aria-labelledby` / 焦点陷阱 / 关闭归还焦点。
- **标签页标题恒为默认值**：改为「页面名 · SciFlow」。

### Tests
- 新增 `jwt-auth.guard.spec.ts`（6 条行为用例）：守卫本体改成 `return true` 时 4 条立即变红（原静态契约测不出来）。
- 新增 `stream-chat.test.ts`（7 条）：用 ReadableStream 驱动真实 SSE 解析，覆盖跨块分片、坏行、`[DONE]`、error 事件、HTTP 错误、abort。
- 收紧三处「永远通过」的断言：引用回填精确断言 3 行与顺序、`listSummaries` 真正调用被测方法、downsample 端点必须精确命中首尾。
- 顺带修出真 bug：`downsampleIndices(1000,100)` 最后一个下标只到 990（尾部数据永久丢失），改为端点对齐。
- E2E 冒烟改为真实链路（建项目 → 选项目 → 发消息 → 等助手回复）；后端断开时**必须失败**（实测验证）。
- 回归脚本删除恒真 `check(..., True)`；导出用例改为断言内容非空且含标题；CI 补 `SCIFLOW_DB_PATH`（否则 2 项降级为 info）。

## [0.6.0] - 2026-10-20

实测驱动的正确性批次：装依赖、起服务、用 Chromium 逐页操作后发现 12 个用户可见缺陷，修复后又由独立审计抓出 13 个本轮引入的回归。同时补全 Agent 工具链（此前完全不可用），重建前端布局契约。
详细记录见 [`docs/RUNTIME-FINDINGS.md`](docs/RUNTIME-FINDINGS.md)。

### Added
- **Agent 工具链（核心能力）**：`AgentToolBridge` 把 11 个 MCP 工具转成模型可调用工具，对话中模型能自主检索文献库/知识库。带项目作用域（防跨项目检索）、调用次数上限、单项超时、轨迹落库。实测真实模型单轮触发 5 次工具调用并引用真实文献元数据。
- **流式能力补全**：`completeStream` 改遍历 `result.stream`，转发 `text-delta` / `reasoning-delta` / `tool-call`；前端新增 `onToolCall` 回调。此前推理增量与工具调用被完全丢弃。
- **布局契约 `AppShell`**：侧栏/工具栏/滚动/断点收敛到一处，窄屏自动变抽屉。写作页由五栏改为「编辑器主区 + 底部 Tab + AI 助手抽屉」。
- **语义化设计 token**：`--foreground` / `--muted` / `--border` / `--viz-series-*` 等，图表与 DAG 不再写死 hex。
- **LaTeX / HTML 导出**：`DocExporter` 接上两个按钮（本地纯函数转换，不依赖网络）。
- **引用顺序护栏**：新增 `citation-order.spec.ts`（5 条），并做过红绿验证。
- **用量分型统计**：`llm_call_log.kind` 区分 `llm` / `tool`，成本看板不再被无 token 的工具调用污染；新增 `tools` 汇总。
- **文档**：`docs/RUNTIME-FINDINGS.md`（实测记录）+ `docs/runtime-screenshots/`（修复前后对照）。

### Fixed
- **工作台流式回答平方膨胀**：`onDelta` 回调参数是累积全文，工作台却按增量追加（5 个分片后长度 10→31）。抽出 `applyStreamDelta` 纯函数统一语义。
- **业务错误被改写为「无法连接服务器」**：`core.ts` 用字符类正则判首字，87 条后端中文错误中 74 条被覆盖。重写为 `ApiError` + 两层分离。
- **质量雷达图恒等于满分**：数据多边形写死 `poly(100)`，与满值网格逐字节相同。
- **写作页 1024px 编辑器宽度仅 2px**：五栏挤一行所致，重构后为 387px。
- **上传 >100KB 返回 500**：body-parser 默认 100kb 且异常被兜成 500；现配置 64mb 并映射为可读 413。
- **分章起草开关是死开关**：写入 `pipeline_config` 但 graph 从不读取；`figures` 开关则无 UI 入口。步骤清单收敛为 `packages/core/pipeline-steps.ts` 单一来源。
- **流水线产物无版本历史**：graph 绕过 `DocumentsService` 直接写库；新增 `writeDocumentContent` 统一入口。
- **参考文献重复渲染**：服务端内嵌列表与前端 CSL 渲染并存；改为正文只留 `[n]` 锚点。
- **HBar 三条数据丢标签**：高度公式漏算轴区；重写为内部自适应，调用方不再能传 `height`/`barHeight`。
- **进度环浅色主题下文字不可见**：标签色写死 `rgba(255,255,255,*)`。
- **流水线页同一任务渲染两遍**：删除重复的线性时间线（439 行）。
- **README 启动命令失效**：`dist/main.js` → `dist/apps/server/src/main.js`；`.env` 加载改多路径探测。
- **工具调用污染用量统计**、**citations 无 ORDER BY 导致编号错位**、**413 文案写死上限**、**桌面抽屉无遮罩**、**选项目后抽屉不收起**、**版本重复快照**、**起草禁用时仍自动配图**、**导出按钮落在可视区外**。

### Fixed（全模块复审批次，B1–B12）
- **鉴权绕过（安全）**：`agent-trace` / `websearch` 的 `@Public()` 与类级守卫冲突，企业模式下执行轨迹、prompt、token 用量完全开放。移除并加 `auth-surface.spec.ts` 白名单契约。
- **删项目留下孤儿行**：零外键 + 手写级联漏了 `agent_execution` / `agent_step` / `chat_session`。补齐并加真实库级联测试。
- **非数字环境变量致并发闸门失效**：`Number(env)` → NaN → `pLimit(NaN)`。新增 `envInt`/`envFloat`（回落 + 夹取 + 告警），9 条单测。
- **环形图配色错位**：零值分段仍占配色槽位，唯一非零分段取到第 N 色（实拍为紫色）。过滤零值；全零给占位。
- **质量页短板柱状图视觉误导**：未设 `max` 导致三根柱都顶满；固定 0–100 并 token 化配色。
- **流水线 DAG 被整段 JSON 撑爆**：新增 `summarizeStepOutput`（大纲→标题+章数、质量门→总分），加 `overflow-hidden` 与 `title` 提示。
- **mock 网关脚本路径失效**：`mock-openai-http.mjs` 仍 require 旧 dist 布局，promptfoo 必崩；双路径候选 + 实跑验证。
- **桌面打包前置检查失效**：`prepare-server.mjs` 检查不存在的 `dist/main.js`。
- **设计 token 缺失**：`--rose-500` 等 4 个被组件引用但未定义，取色静默失效。
- **CI 缺失**：README 承诺的三 job GitHub Actions 实际不存在，新增 `.github/workflows/ci.yml`（命令与本机实测一致）。
- **文档数字失真**：Electron 38→41（内嵌 Node 24）、测试数、回归数、路由数（111→114）全部按实测更新；`.env.example` 补齐 20+ 个实际可用变量。

### Changed
- 版本统一 `0.6.0`（root / server / web / desktop / core / db / CLI / OpenAPI）。
- 回归断言按新引用契约更新；`full_regression.py` 明确要求**全新数据库**。
- `Dockerfile` 补 `COPY packages`（此前容器内 tsc 报 TS2307）。
- web 加 `@sciflow/core` 别名，不再用深相对路径跨树引用。

## [0.5.0] - 2026-10-18

深度审计驱动的正确性批次 + 检索与引用升级 + 模块化拆分 + 可视化两件 + 五平台工程链路。全程以 `scripts/full_regression.py`（基线 161→165）为门禁，每批全绿入库。

### Added
- **检索 RRF 双路融合（B-3.2）**：`knowledge.search` 重构为 ANN(语义)+FTS5(词面) 并行召回 → Reciprocal Rank Fusion(k=60) 归一百分制；单路失败自动退化，双空回退 LIKE 兜底；`rrfFuse` 纯函数。
- **LLM 重排开关（B-3.3）**：`retrieval_rerank=on` 时融合 top12 走 LLM 打分重排（默认 off），命中块透传 `rerankScore`。
- **引用体检闭环（B-4.3）**：`GET /api/documents/:id/citation-audit` 锚点×落库交叉审计——幽灵引用红牌/无 DOI 黄牌/绿牌打分；质量页新增「引用体检」按钮与结果卡。
- **网搜可插拔 Provider（B-6.1/F-3.4）**：DuckDuckGo 兜底 + SearXNG(开源自部署) + Tavily/Serper/Brave（用户自填 Key，掩码回显）；`GET/PUT /api/web/config`；chat 联网兜底开关（默认 off）；设置页网搜面板。
- **DOI 核验（B-5.2）**：`POST /api/references/:id/verify-doi` opt-in 触发 Crossref——假 DOI 直接提示「可能是幻觉引用」，成功回填元数据并同步 citation verified。
- **任务级 token 预算器（B-2.2）**：起草/评审/润色三点打点，默认 300k tokens，`pipeline_token_budget` 可调（0=不限），超限任务终止。
- **流水线 DAG 实时图（F-2.1）**：自绘轻量 SVG 零依赖——状态八色着色、回炉回路虚线回边（Reflexion 语义可视化）、retry 徽标、当前步骤呼吸动画。
- **成本仪表盘增量（F-2.3）**：usage 新增 `byModel`（fast/strong 档位分布）与 `budgetTokens`（预算上限透出），设置页补预算指标卡与模型分布 HBar。
- **docs/HANDOFF.md**：新环境/新会话续接唯一入口（起步/完成度/待办/踩坑清单/文档地图）。
- **docs/audit-report.md + docs/archive/audit-notes.md**：深度审计报告与 76 项原始疑点笔记入仓归档。

### Fixed
- **H1 Reflexion 定向回炉**：旧实现 instructions 恒空、只回传 feedback 原文 → 新增 REFLEXION_PLAYBOOK 按最低分两维生成章节级修订指令，结构化落库供下轮起草逐条落实（自动改分真正可演示）。
- **H2 成本失控双闸**：并发互斥（同项目 running 任务 409 拒绝新建，防 p-limit 共享池 429 风暴）+ token 预算器。
- **H3 RAG 上下文贫瘠**：注入片段 320→800 字符（`KNOWLEDGE_SNIPPET_CHARS` 可配）。
- **H4/H6 SQL 级限流**：references.search 与 knowledge.likeSearch 全部 LIKE 转义 + SQL LIMIT（不再全量拉内存）。
- **H5 并发互斥**：见 H2。
- **H7 分块零重叠**：CHUNK_OVERLAP 0→120（15%），块边界语义连续。
- **H8 尾部块切割失效**：`` 对中文永不匹配（JS \w 不含汉字）→ 显式 lookahead；参考文献/图表块不再被送润色（学术诚信红线）。
- **前端静默吞错**：Submission/Literature 等四处 `.catch(() => setX([]))` 改错误态（ErrorBox/setError）。
- **ZodError 全局 400**：入参校验失败由全局过滤器识别为 400+首条 issue（原 500 误导）。
- **GENERATE_FIGURES 示例污染**：移除 GNN 硬编码示例，主题强制贴合论文领域。

### Changed
- **模块化拆分（M3）**：`packages/{core,db,ai,retrieval}` 四包物理落地（ESLint 依赖红线强制：packages 禁反向依赖接口层/接口层禁深路径绕过）；apps/server 原 10 处桶过渡，调用方零改动；ARCHITECTURE §2.9 回写。真 workspace 拆包待跨应用复用需求触发。
- **零内置原则**：嵌入模型自动下载移除（`EMBEDDING_MODEL_PATH` 用户自备，不配自动降级 BM25）；默认模型名与占位列表清空。
- **rootDir 显式固化 `../..`**：dist 入口变 `dist/apps/server/src/main.js`（scripts/Dockerfile/desktop/文档全链路同步）。
- **回归基线 161→165**（27.x 引用体检 case）；`full_regression.py` 守门员地位不变，新失败一律 FAIL。
- **仓库策略定案**：GitHub/badhope 唯一主仓，四端手动镜像（mirror.yml 移除）；主分支保护要求签名提交（SSH 签名链路已打通）。

## [0.4.2] - 2026-10-15

容器化与前端两处真实缺陷修复 + 界面截图刷新 + 仓库元数据治理。

### Fixed
- **Docker 构建从根上不可用（三处真因，逐一实测修复）**：① 基础镜像原是 alpine(musl)，better-sqlite3 等原生模块无预编译包、容器内缺工具链，`pnpm install` 直接失败 → 改为 glibc 的 `node:22-slim` + 编译工具链兜底；② 缺 `.dockerignore`，`COPY apps/server` 把宿主机 node_modules 拷进镜像覆盖容器内依赖树（tsc 等 bin 全部消失，`MODULE_NOT_FOUND`）→ 新增 `.dockerignore`（node_modules/dist/.env/data/桌面产物等一律不入上下文，兼防密钥入镜像）；③ 按 filter 只装 server/web 与 workspace 锁文件校验一致性对齐。
- **`HBar` 柱高语义错误（影响 8 处图表）**：实现把 `barHeight` 当整图高度（`resolvedHeight = height ?? barHeight ?? 240`），调用方传 5/6/7 时图表被压成 5px 高、柱条全部折叠到同一像素行，Recharts 因此报 "two children with the same key"；同时 `max` prop 被静默忽略。修复：`barHeight` 改为单柱厚度语义、高度按条目数自适应（显式 `height` 仍优先）、补 `domain=[0,max]`。新增 7 条回归测试（含 red-green 验证）。
- **`jsonText` 遇到已解析对象崩溃**：`/api/quality/latest` 等接口 `parseJson` 后再返回（与 DB 原样字符串形态并存），旧实现直接 `raw.trim()` → `TypeError: raw.trim is not a function`，写作页质量区渲染中断。修复：兼容对象/字符串双形态；`QualityReport.scores` 类型同步为联合类型。回归测试覆盖。

### Changed
- **界面截图全面刷新（docs/screenshots/）**：旧图（10-09）为对话工作台重构前界面；本次用 mock 后端实跑一条完整流水线后重拍 7 张真实界面（对话工作台为默认视图、流水线、写作、质量、文献库、知识库、项目总览），并提供可复跑的采集脚本 `scripts/capture-screenshots.mjs`；中英文 README 预览区同步更新。
- **Docker 部署验证落地**：`docker build --target build/server/web` 三个 target 全部实测通过；server 镜像起容器 → `/api/health` 200（health 输出含 db/ai 状态），日志显示 111 路由注册与 EmbeddingService 就绪。
- **五端仓库元数据对齐**：GitHub 三仓补齐 18 个 topics 与 homepage；Gitee 转公开并补中英文描述/主页；GitCode 补描述/主页；README 镜像区措辞随之更新（不再有"Gitee 为私有"声明）。

## [0.4.1] - 2026-10-15

依赖安全批次（全量告警 103→3）+ 修复两处发布级缺陷（桌面打包丢依赖 / 容器编排起不来）+ 门面文档一致性。

### Fixed
- **桌面打包致命回归**：electron-builder `extraResources` 过滤器硬编码排除根级 `node_modules`，导致安装包静默缺失全部生产依赖（1.42GB→100MB），应用启动即崩。修复：bundle 改放二级目录 `resources/bundle/server`（`electron-builder.yml` + `server-manager.ts` 入口路径 + `prepare-server.mjs` 布局同步）；实跑验证打包产物内起后端 → `/api/health` 200、111 路由全注册、better-sqlite3 原生模块可用。
- **容器编排两版都起不来**：`docker-compose.yml` 未设 `HOST` → 容器内绑 `127.0.0.1`，宿主 `-p 3000:3000` 连不通（补 `HOST=0.0.0.0` 且宿主侧仅发布回环）；`docker-compose.prod.yml` 因 `HOST=0.0.0.0` + `AUTH_MODE=none` 被启动安全闸拒绝（显式 `ALLOW_INSECURE_BIND` 并注明不发布 3000 端口）。
- **`pnpm openapi:gen` Windows 失败**：`spawnSync` 经 shell 执行含空格路径的 node 可执行文件会失败（报 `exit null`）→ node 直连 exec、pnpm 走 shell。
- **Dockerfile**：`pnpm@9` → `11.7.0`（与仓库 packageManager 及锁文件格式一致）；补齐 `apps/desktop/package.json` 以通过 frozen-lockfile 校验。
- **依赖安全**：`pnpm audit` 告警 103 → 3（生产依赖仅 1 low）。含 electron 38.8.6 → **41.10.7**（关闭 5 条 high：沙箱继承、`<webview>` Node 集成、协议处理器、拖拽）、`simple-git`/`@simple-git/argv-parser`（2 critical + 3 high）、`tar`、`shell-quote`、`vite`、`vitest`/`@vitest/mocker`/`tinypool`、`diff`、`js-yaml`、`source-map-js`、`postcss-selector-parser`、`semver`、`electron-builder`/`app-builder-lib`/`builder-util-runtime`。无法修复的 3 条（修复版未发布）登记于 `SECURITY.md`。
- **overrides 纪律**：安全钉版一律按受影响范围定点，禁止跨 major 全局替换（实测全局升 js-yaml 打坏 `@redocly/openapi-core` 致 `openapi:gen` 崩溃；全局升 basic-ftp 打坏 `@electron/get` 缓存枚举致 electron-builder 崩溃）。

### Changed
- **仓库卫生**：删除两份陈旧 `package-lock.json`（声明 0.1.0、依赖口径与当前版本完全不符）并在 `.gitignore` 拦截；移除零引用的 `pdf-parse`；移除根目录交付报告与重复的 `docs/website.html`；新增 `.github/dependabot.yml`（每周检查 + 安全更新单独分组）与 `.prettierignore`。
- **门面与文档一致性**：`docs/index.html`（GitHub Pages 实际服务页）清除 Supervisor / 手写 SVG / 四平台 等过时口径，补 badhope 仓库入口；`docs/sciflow-code-tree.html` 删除幽灵 `orchestrator/` 模块、改为真实 `pipeline/` 编排说明；`docs/development.md`、`CONTRIBUTING.md`、`docs/product-roadmap.md` 图表与计数口径改正（vitest 版本、回归基线、体积红线）。
- 版本统一 `0.4.1`（root / server / web / desktop / CLI / OpenAPI）。

## [0.4.0] - 2026-10-15

平台级重构（去手搓化 × 成熟件换装）+ 真实模型端到端验收 + 五平台镜像发布。

### Added
- **Vercel AI SDK 模型层**（`ai@7` + `@ai-sdk/openai-compatible`）：传输 / 流式 / 重试 / 结构化输出整体换装，`generateObject` + zod 取代手写 JSON 抠取（`jsonrepair` 仅兜底）；兼容 Ollama / LM Studio 本地端点。
- **LangGraph 编排层**：主流水线重写为真 DAG——`interrupt()` 大纲人工确认、SqliteSaver checkpointer 断点续跑、质量门 Reflexion 回炉回环、分章起草 p-limit 并行（`AI_DRAFT_CONCURRENCY` 可配）。
- **MCP 官方 SDK**：`POST /api/mcp/rpc`（Streamable HTTP）+ `cli mcp serve`（stdio）双传输，替换自造 REST 工具协议。
- **前端栈升级**：TanStack Query 全站数据获取（含流水线轮询）、TanStack Table（钉 `^8.21.3`）抽取矩阵、sigma.js + graphology 重写引用网络（WebGL）、streamdown 流式 Markdown、CodeMirror 6 写作编辑器、react-router 声明式路由。
- **对话优先工作台（WorkspacePage）**：对话线程 + 内联流水线卡（大纲确认在对话内完成）+ 文档预览；线程 localStorage 持久化 + 会话历史侧栏。
- **知识库检索升级**：sqlite-vec 向量 ANN + FTS5 **trigram** 全文混合检索（中文可检索，3-gram OR 展开）、`@langchain/textsplitters` 分块、`unpdf` PDF 解析。
- **质量工程**：eslint flat config 全仓 0 error（39 项豁免清零）；vitest（server 16 / web 15，含 msw 网络层拦截）；autoevals 离线 scorer 守护；promptfoo 契约评估；Playwright 冒烟；`pnpm openapi:gen`（Swagger → openapi-typescript，111 paths）；CI 扩为三 job（类型/单测/构建 + mock 全量回归 161 项 + E2E/评测）。
- **mock 网关重制**：MSW 进程内拦截（`AI_MOCK` 不再占端口）；`apps/server/scripts/mock-openai-http.mjs` 将同一路由表暴露为 `127.0.0.1:5099` HTTP 端点，供 promptfoo 等外部工具离线调用。
- **五平台镜像**：GitCode / Gitee / GitHub ×3 同步发布（CI 徽章 + 镜像导航 + 英文 README 重写为真实口径）。

### Fixed
- **AI SDK v7 system 消息语义**（真实模型 400 根因）：system 统一拆出为 `instructions`（generateText / generateObject / streamText 三调用点全覆盖）。
- **限流误判**：识别 `statusCode` 字段与中英文「速率限制 / 配额」文案，退避放宽至 4 次 / 2s→60s（此前免费档上游配额错误不重试即失败）。
- **默认视图短路**：根路径意外落旧 dashboard（`||` 短路三元兜底）修复为对话工作台；E2E 断言收紧。
- **Electron 33 → 38**：内嵌 Node 22 原生 `require(ESM)`，解决 `swagger@12` / `p-retry@6` / `ai@7` ESM-only 依赖链；better-sqlite3 打包时按 Electron ABI 自动重编（幂等 ABI 戳）。
- **评审维度独立性**：评分锚点 + 引用存疑不再连坐其他维度（"疑似/无法核实"表述，不臆断学术不端）；大纲 prompt 写作类型感知（综述不得套「实验与结果」章节）。

### Changed
- README（中文 + 英文）/ docs 与实现全面对齐（图表 / 引用网络 / 检索 / 编排口径）；版本统一 `0.4.0`（root / server / web / desktop / CLI）。

## [0.3.0] - 2026-10

方向修正：还原被误删的完整功能集，做可交付可打包的完整智能体。

### Added
- **还原桌面端（`apps/desktop`，Electron）**：恢复被误删的 Electron 主进程 + preload + server-manager + auto-updater + electron-builder 配置 + 图标资源，`pnpm --filter @sciflow/desktop build` 可出 Windows NSIS 安装包。
- **还原 6 个后端模块 + 4 个前端页面**：Agent 轨迹追踪（`agent/`）、实验沙箱（`experiments/`）、审稿判断（`judgment/`）、MCP 工具（`mcp/`）、记忆中心（`memory/`）、Web 搜索（`websearch/`）、投稿流程（`research/submission`）及对应前端 ExperimentsPage / MemoryPage / SubmissionPage / McpToolList。
- **还原品牌体系与文档**：`docs/brand/` 全套 Logo 资源 + `docs/BRAND.md` + `docs/website.html` + `docs/sciflow-code-tree.html` + `scripts/full_regression.py` + `scripts/generate-icons.mjs`。
- **供应商 API Key 落库加密（`common/secret-crypto.ts`）**：AES-256-GCM，主密钥来自 `SCIFLOW_SECRET` 或 DB 同目录 `.sciflow.key`；历史明文启动时一次性就地加密；备份/复制 sciflow.db 不再等于泄露凭据。
- **对话跨会话摘要注入（`chat-session.service.ts`）**：会话结束 LLM 摘要落库，新会话自动注入最近 5 轮（SSE `onComplete` 回调驱动，不阻塞流）。
- **CLI 入口（`cli.ts`）**：headless 批处理，`health / project list / pipeline run|status / doc export / chat sessions` 子命令。
- **文档版本快照（对标 git commit）**：`POST /api/documents/:id/snapshot` 手动快照 + `PATCH .../commit-message` 提交说明 + 流水线起草前自动快照，自动流水线永不静默吃掉用户正文。

### Fixed
- **sqlite-vec 启动报错（真修）**：`require.resolve('sqlite-vec/better-sqlite3')` 因包 exports 只允许 `.` 子路径必然抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`；改用官方 `getLoadablePath()` 按平台解析预编译扩展（已验证 Windows `vec_version()=v0.1.9`）。
- **pnpm-workspace.yaml 占位符**：删除 `set this to true or false` 字面占位；`node-llama-cpp: false` 改为 `true`（此前禁止其 build scripts 导致原生二进制不编译）。
- **CI filter 名**：`pnpm --filter server|web` 改为 `--filter @sciflow/server|@sciflow/web`（与包名一致）。
- **版本号对齐**：server / web / desktop / 根 package.json 统一 `0.3.0`；CLI_VERSION 同步。
- **启动安全闸**：非回环绑定（`HOST=0.0.0.0`）必须 `AUTH_MODE=jwt`，否则拒绝启动（容器内零鉴权暴露面）。
- **评审 JSON 解析失败显式报错**：不再把格式漂移静默当成 0 分白烧一轮回炉。
- **断点续跑防覆盖**：重启续跑若文档在中断期间被人工编辑过，跳过自动覆盖式续跑并提示。
- **质量门最高分选优**：多轮回炉后若末轮非最高分，采用最高分轮次正文与评分落库。

## [0.2.2] - 2026-10

竞品对齐增强——Agent 轨迹追踪 + Web 搜索工具 + 对话摘要注入 + CLI 入口 + 版本快照增强。

### Added
- **Agent 执行轨迹追踪（`AgentTraceService`）**：统一 trace 模型记录每次 Agent 执行的完整输入/输出、步骤链、Token 用量与时耗；SSE 流输出模式回填，HTTP/JSON 模式直接记录；步骤级（Step）详细输入/输出可单条展开。
- **Agent 轨迹后端 API（`agent/` 模块）**：统一 trace 模型记录每次 Agent 执行的完整输入/输出、步骤链、Token 用量与时耗；SSE 流输出模式回填，HTTP/JSON 模式直接记录；步骤级（Step）详细输入/输出可单条展开。前端轨迹面板（对标 Cursor/Cline/OpenHands）尚未实现，待补。
- **Web 搜索工具（`WebSearchService`）**：DuckDuckGo Instant Answer API 无 key 即时搜索 + HTML 回退抓取描述 + SQLite 缓存（TTL 1 小时）。
- **对话跨会话摘要注入（`ChatSessionService`）**：会话结束时异步 LLM 总结并存库，新会话启动时注入最近 5 轮摘要，消除重启应用后的失忆问题。
- **CLI 入口模式（`cli.ts`）**：`NestFactory.createApplicationContext` 无 HTTP 启动，复用全部 DI 容器，health / project list / pipeline run / doc export / chat sessions 子命令。
- **文档版本快照增强**：手动快照（幂等）+ commit message 持久化。
- **SSE 流完成回调（`sse.helper.ts` onComplete）**：流解析层汇聚 fullText 与 totalTokens，在自然结束/abort/错误三个退出路径均触发回调。

### Changed
- `PipelineService` 调用 `AgentTraceService`（补齐执行链路的可观测节点）。
- `documents.service.parseVersions()` 返回类型扩展 `commitMessage?` 字段。

### Fixed
- 修复 `chat.controller.ts` 历史消息类型不匹配（`historyMsgs` 显式 `ChatMessage[]` 注解）。
- 修复 `documents.service.ts` 版本创建时 `content` 允许空串。
- 修复 `cli.ts` 子进程 stdout 类型歧义。
- 修复 `AgentTracePage.tsx` 未使用图标导入。
- **注**：AgentTracePage.tsx 实际未在代码库中，此条为历史 CHANGELOG 超前描述，保留仅供追溯。
- 修复 `database.ts` DDL 中误用 JS 风格 `//` 注释（应为 `--`，SQLite 不认），此 bug 导致服务启动报 `near "/": syntax error`。
- **[0.2.3 补齐]** AgentTrace keyset 分页 + Badge variant 重构 + CLI `pipeline status` 子命令 + 4 个 spec（38 测试全绿）+ tsconfig 排除 spec + 版本快照 UI 内联编辑 + 对话摘要注入 UI 透明化 + `/web` slash 命令集成。

## [0.2.0] - 2026-10

企业级封装第一轮：桌面端 + 品牌体系 + 企业认证 + 运维工具链。

### Added
- **桌面端（`apps/desktop`，Electron）**：内嵌 NestJS 后端（`ELECTRON_RUN_AS_NODE` 免分发独立 Node）+ 本地 SQLite（userData 数据隔离）；自动探测空闲端口；`pnpm deploy` 产出自包含 server bundle；electron-builder 三平台打包（Windows NSIS / macOS DMG / Linux AppImage+deb）；electron-updater 自动更新（opt-in，`SCIFLOW_UPDATE_URL` 显式配置才启用，本地优先不偷偷联网）。
- **品牌体系（`docs/brand/` + `docs/BRAND.md`）**：官方 Logo——一笔流线 "S"（Science + Flow），品牌渐变 teal→cyan→sky；资产含 App 图标母版 / 独立标志（浅深底）/ 横版组合；favicon 与 apple-touch-icon 同源升级；`pnpm icons`（resvg）从矢量母版一键再生成全部位图；侧栏 Logo 替换品牌图形；品牌指南文档（色板 token / 字体 / 语调 / 各端落地要求）。
- **企业认证（`apps/server/src/auth`）**：JWT 模式（`AUTH_MODE=jwt`），注册/登录/me 三端点 + 全局 JwtAuthGuard（默认 `none` 旁路，本地/桌面零破坏）；首位注册用户自动 admin；bcryptjs 哈希；`user` 表落库；前端 `client.ts` 自动附带 Bearer Token + 401 统一事件 + 全局登录门 `AuthGate`（仅 jwt 模式可见）。
- **健康检查增强**：`/api/health` 返回 `db` 可用性 / `uptime` / `authMode` / `desktop` 标识（degraded 状态上报）。
- **运维工具**：`docker-compose.prod.yml`（healthcheck / 命名卷 / 每日 SQLite 在线备份 sidecar / 认证开关）；`scripts/backup-db.mjs`（better-sqlite3 官方 backup API，不锁库，保留策略可配）；`apps/web/nginx.conf` 增强（gzip / hash 资源 immutable 缓存 / SSE 关缓冲 / 64M 上传）。
- **CSL 官方样式补缺**：`scripts/gen-csl-templates.mjs` 从 citation-style-language/styles 生成内嵌样式模板；`csl-register.ts` 注册 IEEE / GB-T 7714 / Nature / Chicago / Springer / ACS 六种官方样式 + `@citation/csl-locale-zh-cn` 官方中文 locale。

### Fixed
- **引用样式运行时崩溃（上次重构遗留回归）**：citation-js 0.8.x 仅内置 apa/vancouver/harvard1，IEEE/GB-T 7714/Nature/Chicago/Springer/ACS 六种样式渲染即抛 "Cannot find style"；GB-T 7714 因缺 zh-CN locale 崩溃（citeproc et-al undefined）。现全部修复并可渲染。
- **顺序编码制双编号**：官方样式自带 [n]/n. 编号，旧代码再手动补 [n] 导致 `[3] [1] …`；改为整表渲染取官方连续编号，单条渲染剥离后重写全局序号。
- **单测与实现脱节**：`documents.service.spec.ts` 仍断言已删除的手写渲染器行为（5/5 失败）；更新为断言 CSL 标准行为并新增 8 样式全注册防回归测试（7/7 通过）。
- **Web 幽灵依赖**：`DocExporter.tsx` 引用未声明依赖（unified / remark-parse / @types/mdast），依赖重排后构建失败；显式声明修复。

## [0.2.1] - 2026-10

生产级治理——消除重复造轮子 + 跨平台兼容 + 类型安全加固。

### Fixed
- **实验沙箱 Windows 兼容**：`process.kill(-pid, 'SIGKILL')` 在 Windows 上语义不同 → `taskkill /pid /T /F` 替代；内存监控(`仅 Linux /proc`)；兜底 `child.kill('SIGKILL')`。
- **Dashboard 类型安全**：`countRows(table: any)` → `SQLiteTable` 泛型约束；硬编码 `60` → `LOW_SCORE_THRESHOLD` 常量。
- **知识库评分归一化**：魔术数字 `999` → `NO_SCORE` 常量；FTS5 全文检索 bug 修复（缺失 MATCH 参数 + SQL 路径错误）。
- **MCP 工具校验**：`z.object(shape).passthrough()` → `.strip()`（拒绝未声明字段，避免工具契约泄露）。
- **前端 JSON 兜底**：`jsonText('')` 返回 `null` → 返回 fallback（消除 P0 崩溃链，影响 Dashboard/Settings 等多处）。
- **SVG 渐变 ID 冲突**：多插图共用 `id="brandDoc"` 导致渐变引用错乱 → `useId()` + `BrandGradient` 共享子组件。
- **CSL 作者构造去重**：`formatRefEntry8` 重复的作者解析逻辑 → 统一使用共享 `toCslAuthors`。
- **质量维度去重**：`QualityPage` / `WritingPage` 各自一份 `DIMS` 常量 → 共享 `qualityDims.ts` 模块（同时消除标签不一致）。
- **类型检查加固**：`WritingPage` 无效的 `'error' in reviewResult` 类型检查（interface 无 error 字段）→ `reviewers?.length` 判断。
- **Auth 异步一致性**：移除误加的 `await` 在同步 Drizzle 查询上；`login` 保留 async（bcrypt.compare 需要）。

### Added
- **`apps/server/src/common/sse.helper.ts`**：SSE 流解析统一封装 `forwardOpenAiSse`，替代 `chat.controller.ts` 中手写 SSE 拼接逻辑。
- **`apps/server/src/common/citation-csl.ts`**：CSL-JSON 构造工具（`toCslAuthors` / `buildCslEntry` / `buildCslEntries`），references 与 documents 共用。
- **`@nestjs/throttler` 全局频率限制**：60 RPM，防 DoS / Token 成本爆炸。
- **`@types/node` 前端依赖**：修复 `Buffer` 全局类型缺失。

### Removed
- **`@ts-nocheck` / `@ts-ignore`**：从 `DocExporter.tsx` 和 `SettingsPage.tsx` 全部消除。
- **4 个 LangChain 孤儿依赖**：git log 确认已剥离但未从 `package.json` 清理的 `@langchain/core`、`@langchain/langgraph`、`@langchain/langgraph-checkpoint-sqlite`、`@langchain/openai`。
- **`msw` 未使用 devDependency**。

### Changed
- **`database.ts` (~100 行手写 schema reconciliation 系统 → 删除)**：启动时反射遍历 SQLite 表/列对比 drizzle schema 的逻辑已冗余（DDL + ensureColumn 双通道覆盖迁移），依赖 drizzle-kit push 管理 schema。
- **`database.ts` DATA_DIR 路径**：`__dirname` 解析（dist 打包后错误）→ `process.cwd()/apps/server/data`。
- **`embedding.service.ts`**：`this.model` / `this.ctx` 旧属性 → `this.llamaContext`（unknown + 精确类型断言）。
- **`ai-transport.service.ts`**：手写并发限制器 ~38 行 → `p-limit` 库替代。
- **`version-diff`**：手写 LCS DP ~55 行 → `diff` 库替代。
- **`as any` 数量**：14 → 10（全部在合理的第三方库边界）。

## [0.1.9] - 2026-10

### Changed

### Added
- 跨库检索增强、自包含导出、大纲模板管理、级联清理。

### Fixed
- 真实 API 全链路验证收尾：u2-flash 推理型网关适配、五处半成品补齐、移动端溢出修复。
- 著者-年 a/b 后缀按正文首现序生成；SSE `chunkText` 2000 字截断保护。

## [0.1.7] - 2026-09

### Added
- mock AI 网关支持流水线端到端跑通，AI 回归全绿。
- 文内 `[n]` 锚点渲染、8 种引用样式（APA/IEEE/Vancouver/GB-T 7714/Nature/Chicago/Springer/ACS）、版本 diff（LCS，2000 行上限）、选刊登记、审稿直连、学习复盘卡、后端 6 项能力（LLM 成本追踪 / zod 结构化校验 / Checkpoint 断点续跑 / MCP Guardrail / RAG 混合检索 / hash 路由）。

### Fixed
- SSE sources 补上下文、版本命名后端化、Settings 页窄屏适配。

## [0.1.6] - 2026-09

### Added
- 端到端断点全打通 + 移动端窄屏适配 + 产品路线图文档 + 大数据量实测。

## [0.1.5] - 2026-09

### Added
- 投稿状态跟踪（投稿→under review→修回→录用/拒稿→转投串联）、修回截止日倒计时。
- 力导向引用网络图（手写 SVG，可交互）。*（0.4.0 起已换为 sigma.js + graphology，WebGL 渲染）*
- 实验沙箱（隔离 spawn Python，降级引导）。
- 知识库与文献双向打通、可搜索绑定 + 来源卡片。

## [0.1.4] - 2026-09

### Added
- 全页面可视化体系落地，补齐真科研环境高级功能与主流智能体交互范式（编排分组时间线、⌘K 命令面板、暗色模式）。*（0.4.0 起编排由 LangGraph 承担，不再有独立 Supervisor/orchestrator 模块）*
- 基于树状图的模块合并与横向扩展。

### Changed
- 砍除全部国外在线学术对接（OpenAlex / arXiv / Semantic Scholar / CrossRef），检索改走本地文献库，全面轻量化。

## [0.1.3] - 2026-09

### Added
- 移动端适配 + 全局快捷键；弹窗体验统一化。

### Changed
- SciFlow 品牌视觉系统升级（teal→cyan→sky 渐变 + 辉光 + 双层卡片阴影，亮/暗双套）。
- 全站错误文案友好化：HTTP 状态码 / 网络错误 / 超时统一转译中文提示（429→请求过于频繁、5xx→服务暂不可用、超时→AI 响应较慢）。

### Fixed
- CI：vitest 误扫 `dist/` 编译产物导致单测失败（限定仅跑 `src/**/*.spec.ts`）。
- 修复知识库建表缺陷；代码审计修复 8 项（引用错位、令牌桶负 delay 忙等、全文润色洗掉图表/参考文献、文献并行无闸触发 429、CommandPalette 键盘导航、无效路由兜底等）。

## [0.1.2] - 2026-09

### Fixed
- 流水线质量闭环大修：评审 Agent 切 fast 模型（思考模型 reasoning 前缀破坏 JSON 解析）；润色保留图表/参考文献尾部不被洗掉；分段润色根治长文截断；定稿自动取最高分轮次（修复「总是取最后/最差轮次」）；修复 `agent_run` 取最早行导致回炉形同虚设；回炉保图顺序；引用池主题相关性过滤 + DOI 标准化 + 按被引降序扩至 20 条；起草输出 JSON 围栏清洗。

### Added
- 综述自动配图（mermaid 技术路线/分类对比图）。

## [0.1.1] - 2026-09

### Fixed
- Agentic RAG 补检文献回填完整元数据（修复空元数据守卫过滤导致补充引用无出处）。

## [0.1.0] - 2026-09

### Added
- 首个可用版本：NestJS 11 + Drizzle/SQLite 后端、React 19 + Vite + Tailwind 前端；多智能体流水线（Planner/Research/Writer/Reviewer/Polisher + Reflexion 回炉）；本地文献库、知识库 RAG、SSE 流式科研问答、7 维质量评分、投稿辅助（选刊/Cover Letter/审稿回复）、记忆中心、MCP 工具台、内置零依赖 mock AI 网关。
