# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [1.14.0] - 2026-11-06

破坏性依赖全量升级（用户明确授权），每一处 breaking change 都配套改造并验证，不留「升了但跑不起来」。

### Changed

- **mermaid 11 → 12.3.0**：v12 的 renderer 注册与配置模型有变；本仓用法（`initialize` + `render` + 主题变量）保持兼容，浏览器实测渲染出 `sf-mmd-1` SVG 且无错误提示，仍走懒加载分包（主入口 137KB 不含 mermaid）。
- **vite 6 → 8.3.6**（rolldown 内核）+ **@vitejs/plugin-react 4 → 6.2.1**：v8 移除 esbuild 转译，`manualChunks` 只接受函数（对象形式直接构建失败），已改为函数式分包；构建耗时 18.7s → 1.79s。
- **js-yaml 4 → 5.5.0**：v5 移除默认导出并把多文档流判为错误，`extensions.service` 改用命名导入 `load`，并对 frontmatter 内的 `---` 分隔做逐段合并兜底（18 条扩展测试通过）。
- **p-limit 6 → 7.3.3 / p-retry 6 → 9.0.0**：均为 ESM-only；Node 24 可直接 require，服务端 CJS 产物运行验证通过。同步删除手写的 `p-retry` 类型 shim（此前它掩盖了真实类型）。
- **undici 7 → 8.12.4**：出站守卫 `safeOutboundFetch` 行为测试通过。
- **unpdf 1 → 2.1.0**：v2 砍掉 CJS 入口（纯 ESM），服务端改为动态 `import('unpdf')`；补本仓类型声明 `packages/retrieval/src/unpdf.d.ts`（只声明实际用到的 `extractText` 形状）。真实 PDF 上传实测 201 + 分块成功。
- **移除未使用依赖**：`unpdf` 曾在 server 侧空挂（真正使用方是 packages/retrieval），已收敛为单一来源。

### Fixed

- **根目录缺少 tsconfig 导致 vite 8 / vitest 5 无法转译 NestJS 装饰器**：vite 8 用 oxc 转译，装饰器开关从「被转译文件向上查找的 tsconfig」读取；仓库根没有该文件时，任何带 `@Injectable()` 的文件一导入就抛 `SyntaxError: Invalid or unexpected token`（无行号，极难定位）。已补根 `tsconfig.json`（`experimentalDecorators` + `emitDecoratorMetadata`）。
- **配置文件扩展名**：vite 8 要求 ESM 配置，`vite.config.ts`/`vitest.config.ts` → `.mts`（desktop 的测试脚本路径同步修正）。
- **workspace 覆盖规则锁死旧版本**：`pnpm-workspace.yaml` 中 `vite: ^6.4.4` / `undici: ^7.30.1` 的 override 会压住新版本，已同步到 8.3.6 / 8.12.4。

### Verified

- server 471 / web 177 / desktop 5；typecheck 干净；lint 0；build 成功
- 黑盒：回归 238-0-0、路由 96-0、验收 23-23、巡检 24-24、MCP 5-5
- 真实链路：PDF 上传解析（unpdf 2 动态导入）、写作页 mermaid 12 渲染、前端单端口托管

## [1.13.0] - 2026-11-06

把路线图里所有「Partial / Next」项全部做完，不留计划残留。

### Added

- **段落级版本恢复**：`extractSections` / `sectionDiff` / `restoreSection` / `replaceSectionBody` 纯函数层，`GET /api/documents/:id/sections/diff` 与 `POST /api/documents/:id/sections/restore`。版本对比弹窗新增「按章节恢复」面板，可只回滚某一节，恢复前自动快照全文。13 条单测。
- **按评审意见执行修改（评审闭环最后一环）**：`POST /api/documents/:id/sections/revise` 只重写命中的那一节，保留其余章节与全部引用标记，改前自动快照；`REVISE_SECTION` 提示词明确禁止编造数据并要求标注「待补充」。前端版本面板新增「按意见修改」按钮。评审从「有计划的文本」变为「可执行的动作」。
- **结构化质量反馈**：`structureFeedback` 把每条反馈映射到章节、严重度（blocker/major/minor）与维度，质量服务导出评审条目时写入 `sectionRef` 与对应维度（此前 `sectionRef` 恒为空）。7 条单测。
- **新颖性预检离线降级**：学术库不可达或关闭时不再只回 `skipped`，改为基于本地文献池重叠度 + 选题特异性的确定性判断，结果永远标记 `basis: offline-fallback`，绝不假装联网查过。5 条单测。
- **列表分页**：`paginate` 纯函数 + 文档/文献列表可选 `limit`/`offset`（上限 200），不带参数时行为完全不变。7 条单测。
- **上传演示视频**：`docs/media/demo.mp4` 按当前构建重录（1026 KB，覆盖工作台/流水线/质量/写作/文献/知识库/实验/总览/深色设置），README 中英双语嵌入；修复录屏脚本切深色不生效的问题（改存储后需重载页面）。

### Changed

- **界面默认亮色**：首次进入不再跟随系统深色偏好而落到深色，`DEFAULT_THEME_MODE = 'light'`；用户显式选择 dark/system 后仍严格尊重存储值。启动内联脚本与 `readStoredTheme` 同步修改，2 条新单测锁定。
- **依赖刷新**：`p-limit` 6 → 7.3.3（ESM-only 包在 CJS 构建下运行验证通过）、`@citation-js/*` 0.8 → 0.9.0（含 RIS 插件），全量 471 条服务端测试通过——路线图登记的「需兼容性验证」事项兑现为实际升级。

### Fixed

- 录屏脚本深色片段断言失败（App 会把主题写回 localStorage，仅改存储不重载不生效）。

## [1.12.0] - 2026-11-06

### Added

- **外源内容消毒（间接提示注入防线）**：文献摘要、粘贴的审稿意见、网页检索结果进入模型上下文前统一走 `packages/ai/prompt-injection`——剥离零宽/双向控制字符、中和代码围栏走私（``` → '''），并确定性检测指令覆盖/角色劫持/系统提示词探取/工具诱导六类信号（中英双语，只报告不删除）；命中段落以一次性随机标记包裹（spotlighting/datamarking，OWASP LLM Prompt Injection Prevention Cheat Sheet 与 Microsoft 2025 业界实践）。接线三处：`summarizeLiterature`（流水线/文献/MCP 共用）、`replyReview`、chat 联网搜索上下文。17 条单测。
- **OTel OTLP/JSON 轨迹导出**（生态缺口 #2 闭环）：`apps/server/src/agent/otel-export.ts` 纯映射层把已持久化的 `llm_call_log` / `agent_execution` 映射为 OTLP/JSON span（uint64 十进制字符串），属性遵循 OpenTelemetry GenAI 语义约定（`gen_ai.request.model`、`gen_ai.usage.*`、`gen_ai.agent.id`）；`OtelExportService` outbound-guard POST `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`，未配置环境变量时零开销关闭。`POST /api/agent/otel/export` 手动触发。12 条单测。
- **审稿意见闭环（生态缺口 #3 第一环）**：`buildRevisionPlan` 把审稿意见解析为逐条修改计划（类别 experiment/method/citation/writing/structure、严重度 major/minor、建议动作，确定性规则无 AI 调用）；`POST /api/submission/reply-review` 返回 `{ letter, revisionPlan, reflexionId }`，传 `taskId` 写入 `reflexion_log`（CycleResearcher 的 review→revision 循环在本仓的数据形态）。前端投稿页渲染修改计划。6 条单测。
- **`.github/dependabot.yml`**：npm（pnpm lockfile）+ github-actions 双生态周更，electron 钉位忽略（44 的预编译镜像未同步）；ECOSYSTEM-AUDIT §5 的 dependabot 宣称自此有配置支撑。
- **同类项目深度对标更新（2026-11-06）**：新增 OpenDraft、AI-Researcher(HKUDS)、AI Scientist-v2、CycleResearcher/CycleReviewer 等 4 个 2025-2026 项目，连同既有 10 项（GPT-Researcher、STORM/Co-STORM、DeerFlow、PaperQA2、local-deep-research、Feynman、OpenScholar、Onyx、Khoj、SurfSense、AutoGen）共 14 项，见 `docs/ECOSYSTEM-AUDIT.md` §4.1。

### Fixed

- **`pnpm build && pnpm start` 后打开 http://localhost:3000 此前是 404**：API 服务从不托管 web 产物，README 的 Quick start 是一纸空谈。现 server 在 `apps/web/dist` 存在时直接托管静态界面（express static + SPA 回退，复用已装 `@nestjs/platform-express`，零新依赖；`WEB_DIST` 可覆盖路径），产物不存在（headless/CLI/CI）时行为不变。已实测：单端口同时出界面与健康检查。
- **「宣称 vs 事实」错账清理**：三份 README 的配置巡检结果虚标 25/25（巡检自 v1.5 起实际 24 项）→ 修正为实测值；`README.en.md` 为过期重复副本（真正英文版是 `README.md`），删除并修正中文 README 的语言切换链接；ECOSYSTEM-AUDIT §5「dependabot 周更」此前无配置支撑 → 补 `.github/dependabot.yml`。
- **新模块全部 TDD 红灯先行**：先写 spec 确认 RED（模块缺失/断言失败），实现后 GREEN，测试断言行为而非实现细节。

## [Unreleased]

### Changed

- **README 三语与落地页文案重写：去「本地优先/多智能体」类 AI 产品套话，改以真实差异点开场**——一条流水线直通投稿、确定性七维质量门（同文同分可复现）、引用三级追踪与七类体检、证据链断点可见、有护栏的自主（审批/重复护栏/降级链）、宣称皆可验证。开篇的 "local-first multi-agent" 属双重不实（我们从未做多智能体编排），已删除；「能离线工作的检索」「密钥始终是你自己的」等营销行删除；「多智能体」错误宣称在落地页全部改为「确定性质量门/全流程流水线」。
- **验证表数字刷新**：server 376→404、web 135→175（旧数字是数轮版本前的存量，违反「宣称 vs 事实」纪律），并补桌面端 5 项、验收矩阵 23/23、MCP 握手 5/5。
- **README 截图重拍为展览数据**（18 张，含回归的写作页）：上一版用全新空库采集，10 个页面全是同一张「创建项目」空态，视觉上即重复图片。应用默认状态不变（空库即真实空态），README 作为展览位使用 `scripts/seed-demo.mjs` 的展览数据（用户定义的展览模式用途）。


### Fixed

- **desktop-installer CI 产物收集目录写错**（`dist` → 实际 `release/`，含 blockmap）：GitHub runner 上 NSIS 打包本身已成功，仅收集步骤失败；已修正并重新 dispatch。三份 README 的安装包输出路径同步修正。
- 新增 `scripts/mcp-handshake.mjs`：官方 SDK 客户端对 `/api/mcp/rpc` 走真实协议链路（initialize → tools/list → tools/call → resources），作为回归常跑成员——ECOSYSTEM-AUDIT 的「MCP 2026-07 stateless 适配」待核实项据此闭环（5/5 通过）。


## [1.11.0] - 2026-11-04

### Added

- **Agent harness 加固（生态对标后补齐，详见 `docs/ECOSYSTEM-AUDIT.md`）**：
  - *工具重复调用护栏*：同一（工具 + 参数稳定哈希，键序不敏感）在一次请求内最多真实执行 3 次（`AGENT_TOOL_REPEAT_LIMIT`），超限拒绝执行并给模型可读换路提示。这是 2026 生产事故榜第一名「失控循环」里次数上限拦不住的空转。3 条行为测试。
  - *模型降级链*：`AI_MODEL_FALLBACK` 配置备选模型，主模型重试耗尽且用户未取消时自动切换重试一次，`caller:fallback` 留痕。仅覆盖非流式路径（流式增量已出无法安全重放），行为在契约表（ARCHITECTURE §2.25）锁死。
- **Windows 安装包（exe）**：
  - 新增 `desktop-installer` CI 工作流：tag 触发 GitHub runner 出 NSIS 安装包并附 Release，手动触发可下 artifact——本机没有 VS C++ 工具链也能出包。
  - 原生模块三级获取链：GitHub 官方 Electron 预编译包 → npmmirror 镜像直链（`prebuild-install --download`，ABI 由 node-abi 精确换算）→ node-gyp 重编。前两级免工具链。
  - Electron 钉到 `42.11.18`（ABI 146，npmmirror 有官方预编译包；安全底线 ≥41.10.7 仍满足）。44 的 ABI 149 预编译镜像尚未同步，升级前先确认预编译可用。
- **生态对标与真实性审计文档**（`docs/ECOSYSTEM-AUDIT.md`）：四道门禁基线、MCP/A2A/AG-UI 三层协议取舍（A2A/AG-UI 登记引入时机而非实现）、12 个同类项目逐项对标（9 项已覆盖 / 2 项非目标 / 2 项缺口登记）、轮子审计抽查。

### Fixed

- **安装包打包在悬空 junction 上失败**：pnpm deploy 产物里 `.pnpm/node_modules/@sciflow/*` 是指向仓库源码的相对 junction（Windows 下 readdir 的 Dirent 把 junction 报成普通目录），旧清扫器递归进去 ENOENT 后被外层 catch 静默吞掉，7-Zip 打包报「系统找不到指定的路径」exit 1。清扫器改为 lstat 逐项判定 + 单项异常不中断，并无条件剔除工作区自链接。
- **README 引用已删除的 writing.png**：空库截图流程诚实跳过写作页后旧文件未清理，三份 README 与落地页已撤下该图（写作页能力由工作台截图覆盖）。

### Changed

- **品牌重塑 2.0「朱印」：去 AI 模板化，亮色暖纸为默认。** 旧视觉（青绿→湖蓝→天蓝三色渐变 + 轨道环 + 节点圆点 + 玻璃拟态 + 常驻辉光）与大量 AI 产品图标/界面同构；新体系回到科研工作的本体语言——纸、墨、黛、朱砂：
  - **Logo**：App 图标改为平涂朱砂印底 + 一笔白文 S + 印角留白（`icon-master.svg` 全量重绘，`pnpm icons` 已重出全部位图）；独立标志为黛蓝主笔 + 收笔一点朱砂；横版组合中「Flow」词标收朱砂（字标即印文）。轨道线、节点外环、渐变、光晕全部删除，且 `BrandMark.test.tsx` 以结构断言锁定（1 条主笔 + 1 个朱点），防止改回模板件。
  - **色彩**：默认主题改为「朱印纸墨」——暖纸白底 `#F5F4F0`、近黑墨色正文 `#262B33`、黛蓝主色 `#2F5480`、朱砂签名色 `#BE3B2A`（一屏一处，只用于印底/朱点/词标；错误语义仍走 rose，二者不同值不同职责）。`--color-teal-*` 工具类整段重映射为黛蓝阶，2600+ 处组件类名零改动完成换色；深色「墨夜」底改暖调近黑 `#101318`。图表系列色同步换为黛蓝/朱砂/苔绿/赭石/石青/灰。
  - **质感收敛**：`brand-btn`/`nav-active` 的多色渐变改为同相两档微差（读作平涂）；常驻辉光删除（hover 保留低幅投影）；玻璃顶栏降模糊降饱和；图表/空态插画渐变回退值同步更新。
  - **各端落地**：桌面端窗口背景/错误页（`#F5F4F0`/`#101318`）、浏览器 `theme-color`、设置页风格名与色卡、GitHub Pages 落地页（`docs/index.html` 配色与 favicon）、`docs/BRAND.md` 全文重写为 2.0。
- **默认状态即真实状态：官方截图不再使用回归/演示数据。** 此前 README 截图在跑过回归与演示种子的库上采集，侧栏出现「回归基线项目 / route-probe」等脚本产物，看起来像预置数据。现全部截图改为**全新空库**采集——应用出厂即真实状态；展览/演示数据仍可经 `node scripts/seed-demo.mjs`（仅手动 CLI）注入，不改默认行为。无项目空态同步升级：印章图标 + 三步上手卡（建项目 → 灌语料 → 开跑），不再是一句孤立提示。
- **界面治理审计**：
  - 项目总览：全局阶段条与驾驶舱内阶段导航同屏重复——总览页不再渲染全局阶段条，保留驾驶舱内可点击的完整版。
  - 文献库：年份/来源分布与高被引图表常驻把文献列表挤出两屏，改为默认折叠的「库内概览」披露区（v2-disclosure），首屏直达文献条目。
  - 质量评分：客观检查器七维网格由 6 列（第 7 项「信息密度」孤行）改为 lg 7 列 / sm 4+3 两行。
  - 实验沙箱：右栏「实验设计助手」空态改紧凑变体（`Empty compact`），窄栏不再被大图标空态占据。
  - 全部截图（10 页面 + 深色 + 6 风格×明暗）在治理后用空库重拍。

### Removed

- **实验沙箱不再预填示例代码**：新建实验的代码框此前预填一段可运行的 Python 示例（点「运行」即产生一条记录），属隐性预制数据；改为空输入框 + placeholder 引导，空代码时运行按钮禁用。

### Fixed

- **截图脚本的同文档导航陷阱**：`capture-screenshots.mjs` 主题循环里 `page.goto` 到与当前完全相同的 URL（`#/settings` → `#/settings`）不会重载页面，localStorage 的新主题值读不到，上一轮的明暗会「粘」到后续所有截图（此前能通过纯属初始状态恰好等于期望）。改为设键后显式 `page.reload()`。
- **出站守卫单测依赖真实 DNS**：`outbound-guard.spec.ts` 的「公网放行」用例直接解析 example.com——本机代理 fake-ip 模式会把任意域名解析到 `198.18.0.0/15`（RFC 2544 基准测试保留段），守卫按契约正确拒绝导致误报。改为 mock `dns.lookup`（守卫行为无缺陷，测试不应依赖网络环境）。
- **端口占用导致的假截图**：5173 被其他项目的残留 dev server 占用且 vite 未加 `--strictPort` 时会顺延端口，截图脚本截到的是别家应用。采集前必须核验页面标题。

## [1.10.0] - 2026-11-03

### Added

- **Agent harness.** Four capabilities borrowed from coding-agent infrastructure
  and applied to research work, each with behaviour tests:
  - *Task list* (`update_todo_list`) — the model maintains an explicit plan so a
    long job is auditable. Replaces the whole list at once, preserving ids of
    unchanged items so the UI animates instead of flickering.
  - *Context compaction* — folds earlier turns into an extraction-based digest
    once history passes a character budget. Extraction rather than free
    summarisation, because a model-written abstract drops numbers and
    conclusions. Keeps at most half the turns verbatim, so a short history can
    still be compacted instead of degenerating into truncating the last message.
  - *`@` mentions* — type `@` in the composer to pull a specific reference,
    knowledge document or manuscript into the turn. Only triggers at word
    starts, so email addresses do not fire it; the tag is expanded at submit
    time so the textarea stays editable.
  - *Tool approval* — side-effecting tools (`experiment.*`, `document.*`,
    `project.*`, `config.*`) can pause for confirmation with a readable reason.
    Read-only tools never prompt, because confirmation fatigue turns approval
    into a rubber stamp.
- **Evidence chain view.** Shows question → evidence → anchors → citations →
  traceable entries, derived from the actual manuscript text and reference pool,
  and names the broken links.
- **Visual layer v2** (`styles/enhancements.css`): four-step depth scale with an
  edge highlight, interactive-card hover that only fires on real affordances,
  staggered list entry, live-status pulse that stops when work stops, tabular
  numerals so metrics do not jitter, and progressive disclosure. All animation
  respects `prefers-reduced-motion`; a `prefers-contrast: more` block keeps
  borders visible.
- `GET/POST/DELETE /api/agent/tasks` and `GET/POST /api/agent/approvals`.

### Fixed

- **Harness endpoints were mounted at `/api/api/agent/*`.** The controller
  declared `api/agent` while the app already applies a global `api` prefix, so
  every new endpoint 404'd. Caught by reading the route table in the boot log
  rather than by the type checker.
- **Compaction did nothing on short-but-large histories.** With fewer turns than
  the keep-count it could not find a boundary and fell back to truncating the
  final message only, leaving the earlier bulk in place.
- **Two React violations** surfaced by lint: `setState` synchronously inside an
  effect in the task panel, and a non-memoised array feeding a `useMemo`
  dependency list in the workspace.

### Fixed

- **All real model endpoints were rejected by the outbound guard.** The address
  classifier treated any non-IP string as dangerous, so a hostname such as
  `api.openai.com` was refused before DNS resolution. Every real provider call
  failed with "blocked address"; only the in-process mock gateway worked, which
  is why the existing tests — all of them using IP literals — never caught it.
  The classifier now returns false for hostnames and the decision happens at
  connection time against each resolved address.
- **IPv6 link-local blocking only matched the `fe80` prefix.** The real range is
  `fe80::/10`, so `fe90::1` through `febf::1` passed the check. Address
  classification now uses `net.BlockList` with correct CIDR prefixes for
  `fe80::/10`, `fc00::/7` and `ff00::/8`.

### Changed

- Removed the duplicate address-classification implementation in
  `apps/server/src/common/outbound-guard.ts`; it now reuses
  `packages/core/src/ip-policy`, so the API and the AI transport share one rule
  set instead of two copies that could drift.
- `isBlockedAddress` and `isCloudMetadataAddress` are documented as accepting
  IP literals only. `isIpLiteral` is exported for callers that need to branch.

### Added

- Behavioural regression tests covering hostname pass-through, the full IPv6
  link-local range, IPv4-mapped IPv6 bypasses, and the distinction between
  public and reserved addresses.
- Release process (`docs/RELEASE.md`), issue and pull request templates, a
  secret-guard workflow, and version tags for every released version.
- Bilingual README with English as the primary language.

## [1.9.5] - 2026-10-31

前端信息架构重构 + 评分门禁补漏：把界面按「科研生命周期」重排，堵住「篇幅不达标也能过门」的漏洞。

### Fixed
- **篇幅未达标准也能过质量门（Major）**：实测一篇 2307 字稿件在「SCI 通用期刊」档
  （要求 4500 字）篇幅仅得 5/20，但结构/引用/可读性全满分，总分 **89 通过 80 分门禁**。
  修复：正文低于所选标准下限 90% 直接判硬伤（封顶 40），不再让形式分救回体量不足的稿子。

### Changed（前端信息架构）
- **导航从「按工具分类」改为「按科研生命周期」**：旧的「核心工作/自动化/记录与洞察」
  把核心能力（全自动流水线）折进默认收起的组里；新结构为
  `① 研究立项 ② 证据与资料 ③ 写作与质量 ④ 投稿与复盘`，带序号与副标题，段内按阶段排序，
  用户从上往下走即可。工具页（实验/记忆）不再与主流程抢位。
- **移动端底栏换位**：用「流水线」替掉「评分」——流水线是核心能力入口，评分是阶段性检查。
- **新增「项目驾驶舱」**（首屏唯一主区域）：一次回答三个问题——现在在第几阶段（0-6 进度）、
  下一步点哪个按钮（由阶段推断，空项目也能给对第一步）、质量门达没达标（分数/标准/及格线/
  硬伤数/还差几分）。统计卡、环形图、执行追踪降为次级区块。
- `ShellNavGroup` 支持 `hint` 副标题与 `step` 序号。

### Verification
- server 345 / web 134 单测全绿（新增 6 条驾驶舱行为断言 + 1 条篇幅硬伤回归）
- 回归 238/238、巡检 25/25、探针 96/96、lint 0
- 浏览器实测（真实 dev 服务）：导航四段与序号渲染正确，驾驶舱显示「阶段 0/6 · 当前：选题」
  「下一步：运行一次流水线」「质量门：未评分」

## [1.9.4] - 2026-10-30

评分体系重构：不再把「结构完整」当成「内容优秀」，引入五档可选标准与信息密度维度。

### Added
- **五档质量标准**：草稿迭代 / SCI 通用期刊（默认）/ 顶刊 IEEE Trans·Nature 子刊 / 综述 Survey / 会议 CCF-B/C。
  每档独立约束正文篇幅、章节数、唯一引用数、每章引用密度、句长、模板腔密度、章节均衡与及格线。
- **第 7 个确定性维度「信息密度」**：模板腔/套话密度 + 最大章节占比；专门拦截「格式像论文、内容没有信息量」的稿件。
- **引用强度评分**：引用闭环不再只判「有没有引用」，还按所选标准要求唯一引用数与每章密度；默认 SCI 档低于 15 篇会按比例扣分，顶刊档要求 30 篇。
- **设置页标准选择器**：质量门实际使用的标准、及格线和标准名在客观检查器卡片中显示。

### Changed
- `quality-audit` 默认阈值从 3000 字/4 章收紧为 SCI 通用期刊档 4500 字/5 章/15 个唯一引用；保留 `minChars/minSections` 显式参数兼容 CLI/旧调用。
- pipeline quality gate 读取 `app_setting.quality_standard`，回炉及格线按标准变化，不再固定 80。
- README 删除版本流水账，改为核心能力、定位、评分原则与真实验证证据优先。

### Verification
- server 344 tests / web 128 tests / lint 0；评分标准单测覆盖五档、套话密度、章节均衡、引用强度与 strict 长文。
- `https://api.agnes-ai.cn/v1/models` 可达，测试令牌返回 401；真实 Key 不在本机凭据库，未伪造真实论文端到端结果。

## [1.9.3] - 2026-10-30

第四轮审计抓到本仓库**最深的一个假象**：mock 网关对 AI SDK 的结构化消息全部失配。
修复它之后，此前三轮「mock 全链路回归」的可信度被重新校准——它们验证的只是管道连通。

### Fixed
- **mock 网关对 AI SDK 数组消息全部失配（Critical）**：AI SDK 发送的 `content` 是
  结构化数组（`[{type:'text',text:'…'},…]`），而 `getLastUserContent` 直接 `String(content)`
  → 得到 `"[object Object]"` → **27 条 mock 路由规则全部失配**，任何 AI 调用都返回兜底问答文本。
  后果：此前所有 mock 回归里，大纲/起草/评审/润色/翻译拿到的都是同一段通用文本——
  各步骤的输出契约从未被真实验证过。修复：新增 `extractMessageText`（string /
  text-part 数组 / 混合数组三形态），12 条单测锁定。
- **mock 起草不守「空池禁引用」契约**：mock 修复暴露后，空文献池场景起草产物带
  `[文献1][文献2]` 残留锚点（客观 40 分硬伤）——mock 无论文献池是否为空都硬编码
  `[Ref:1][Ref:2]`。修复：按 prompt 是否含 `[Ref:N]` 文献清单决定输出锚点，
  并按章节标题返回**差异化内容**（此前 5 个章节同一段文本触发「重复段落」硬伤）。
  实测：空池流水线 objective 40→69、残留锚点 0、审计 60 分（无引用，非假绿）。
- **检索重排静默无效**：`rerankChunks` 没有 mock 规则 → 开启 `retrieval_rerank` 后
  mock 返回兜底文本 → zod 解析失败 → 被 catch 静默吞掉 →「重排已开启」但排序从未变过。
  修复：补 mock 规则（按关键词命中打分，确定性可断言）。实测 `rerankScore` 字段首次出现。
- **润色永远返回空**：mock 的 `extractPolishText` 只认「待处理文本：」，而自定义提示词
  分支用「待处理正文：」→ 提取失败 → 返回整段 prompt → 触发 ai.service 失败保护
  （< 原长 30%）→ 润色结果恒为空 + 「输出异常」。实测修复前 `polished: ""`，
  修复后 304 字正常返回。
- **翻译接口 500**：`POST /documents/:id/translate` 不传 `text` 时，`polish_record.original`
  NOT NULL 约束直接炸出未捕获 SqliteError（HTTP 500）。修复：空 text 回落文档正文，
  两者皆空返回 400 可读提示。

### Tests
- server **336**（+12：mock-gateway.spec——三形态路由 / 空池禁引用 / 章节差异化 / 重排打分 / 润色双标记）
- 回归 235/235、巡检 25/25、探针 96/96、web 128/128、lint 0（全绿后提交）

## [1.9.2] - 2026-10-29

第三轮逐模块「宣称 vs 实现」审计（websearch / experiments / memory / MCP / desktop）修复批次。
方法：每个模块用真实 HTTP / 真实 Python 沙箱 / 真实 MCP 握手验证，不读代码下结论。

### Fixed
- **零 Key 联网搜索在国内网络恒为空转（Major）**：实测 `api.duckduckgo.com` 在国内网络
  连接超时，且其 Instant Answer API 本身只返回「实体摘要」而非网页搜索结果——
  「什么都不配默认走 DDG 兜底」实际恒为 0 结果，且失败**静默**返回 `[]`（HTTP 201），
  用户无从区分「没有结果」与「源不可用」。修复：
  ① 新增 `so360` provider（免 Key、国内可达，实测返回相关结果，解析抽纯函数带 4 条单测）；
  ② DDG 失败自动降级 so360，全链失败返回带 `notice` 的诊断（不再静默）；
  ③ 设置页新增「测试当前引擎」按钮与 provider 选项说明。
- **程序记忆注入不可观测（Minor）**：`proceduralMemory` 会注入起草 prompt，但没有任何
  痕迹可验证「记忆真的进了 prompt」。端到端实测（写入记忆 → 跑流水线 → 查日志）后补
  `[记忆] 程序记忆已注入起草 prompt（N 字）` 打点。

### Verified（本轮确认真实可用，无需修改）
- 实验沙箱：Windows 下真实 spawn Python 3.14 执行脚本，`6*7→42`、死循环正确判 `timeout`
- 程序记忆：写入 → 起草注入 → 日志可见（3 处打点）
- MCP 双向：`initialize/tools/list/resources/list/resources/templates/list` 全通，
  serverInfo 版本 1.9.1，SSRF 正确拒绝回环地址
- desktop 打包链静态完整（pnpm deploy → extraResources 二级目录规避 node_modules 丢弃）

### Tests
- server 324（+4：so360 解析）
- 回归 232 → **235**（27.10a-c 网搜诊断）
- 全路由探针 96/96；巡检 25/25

## [1.9.1] - 2026-10-29

第二轮「宣称 vs 实现」审计（全路由真实探针 97 条 + 静态接线扫描）修复批次。
方法：不是看代码写了什么，而是对每个路由发真实 HTTP、对每个配置项追读写两端。

### Fixed
- **「研究缺口」功能全量不可用（P0）**：`POST /api/references/gap` 用 `@Body('projectId')`
  逐字段取参，而全局 `InputValidationPipe` 对 body 入参要求「必须是 JSON 对象」——
  管道收到的是 **string**，于是无条件 400。前端按钮永远失败，且回归脚本没覆盖该路由，
  缺陷存在两个版本未被发现。修复：管道放行标量（那是 `@Body('x')` 的合法语义），
  控制器改整对象取参 + 显式校验；回归新增 27.9 断言。
- **空文献池产出的「伪引用」全链路隐形（P0）**：引用渲染器把越界锚点降级为 `[文献N]`，
  但引用体检只认 `[n]/[Ref:n]/【n】`、客观质量检查器只认 `[数字]`——于是「引用全断」
  被报成「没有引用」（60 分），正文里全是读者无法溯源的伪引用却不触发任何硬伤
  （实测同一稿体检 60 分、客观 77 分、0 硬伤）。修复链：
  ① 起草 prompt 空池时显式禁用引用标记（此前两条指令自相矛盾，模型只能编造）；
  ② 引用体检新增 `residualAnchors` 红牌判定（每处 −10 不封顶，落库为空再 −60）；
  ③ 客观检查器把 `[文献N]/[Ref:N]/[补充文献]` 计入占位硬伤（封顶 40）。
  回归新增 27.6/27.7。
- **三个配置项「文档说有、设置里没有」**：`pipeline_token_budget` / `retrieval_rerank` /
  `websearch_in_pipeline` 此前只能改库或环境变量——预算耗尽的报错让用户「到设置中调整」，
  `docs/CONFIGURATION.md` 也声称「设置页 websearch_in_pipeline」，实际 UI 无此开关。
  修复：并入 `GET/POST /api/customization/pipeline-settings`（四元组：深度/预算/重排/联网），
  设置页「流水线步骤与运行参数」面板新增三项控件；预算缺省口径与流水线统一为 300k。

### Changed
- 静态 `openapi.json` 重新生成：v1.4.0/147 paths → **v1.9.0/151 paths**（补齐
  objective-audit / pipeline rerun / references discover / quality project-overview），
  前端类型定义 `openapi.d.ts` 同步。

### Fixed (2)
- **mock 网关缺「扩展资产生成器」路由**：`extension.generate`（一键 AI 生成资产）在 mock 模式下
  必然 JSON 解析失败——该功能在 CI/验收里从未被端到端冒烟过。补 mock 路由后探针 96/96 全绿。
  教训：匹配特征必须取自 **user message**（`getLastUserContent` 只看最后一条 user），
  首版用 system 消息里的「资产生成器」做特征，永远不命中。

### Tests
- server 320（+8：input-validation.pipe 5 条、citation-audit 残留 3 条）
- 回归 223 → **232**（新增 27.6/27.7/27.8a-f/27.9 共 9 条，全部针对本轮修复）
- 探针脚本 `scripts/route_probe.py`（96 条真实请求）入库，供后续审计复用；当前 **0 失败**

## [1.9.0] - 2026-10-29

这次不是加功能，而是**把宣称的能力真正接通**：审计发现三处「文档说有、代码里没有」的假象——
向量检索从未产出过向量（调用了 node-llama-cpp 不存在的 API）、模块边界 ESLint 规则从未命中、
引用体检只查三类问题。三处全部修复并补上护栏，另加检索去冗余与前端按需加载。

### Fixed
- **向量检索从未真正工作（P0）**：`EmbeddingService` 在 `LlamaContext` 上调 `getEmbeddingFor`，
  而 node-llama-cpp 3.x 只在 `model.createEmbeddingContext()` 返回的 `LlamaEmbeddingContext` 上提供该方法。
  结果 `embed()` 恒返回 null，`knowledge_chunks_embedding` 表永远是空的——README 宣称的
  「sqlite-vec 向量 ANN + FTS5 混合检索」实际只有 FTS5 单路。修复后端到端实测：上传 1 篇资料后
  `embeddedChunks` 从 0 变 1，同义改写查询能命中。
- **向量维度无守卫**：模型输出非 384 维时 vec0 insert 抛错，整个上传事务回滚（用户看到 500）。
  现在入口统一守卫，维度不符该块降级全文检索并给出可操作提示。
- **模块边界规则形同虚设**：`eslint.config.mjs` 的 pattern `**/packages/*/src/*!(index)*` 在
  eslint 的 minimatch 实现下**从未命中**——把 `packages/core/src/quality-audit` 深路径导入塞进
  `apps/server` 仍然 0 报错。改为显式列目录后规则真实生效，并同步把 28 处深路径导入收敛到
  `apps/server/src/common/*` 桶。

### Added
- **嵌入双后端**：`EMBEDDING_PROVIDER=auto|local|api`。已配置模型 Key 的用户无需再手动下载 GGUF——
  直接用同厂商的 `/embeddings`（`ai` SDK `embedMany`），零额外配置即可启用语义检索。
  本地 GGUF 仍是默认优先（数据不出机器）。
- **批量嵌入**：上传走 `embedBatch`（API 每批 64 条；本地受限并发 4），替代逐条 `Promise.all`。
- **MMR 检索去冗余**（`packages/retrieval/src/mmr.ts`）：RRF 融合后按「相关性 − 冗余度」贪心重排，
  解决「同一篇文档的相邻块占满 topK」——5 条来源其实是同一段话的 5 个切片。
- **引用体检 5 类新判定**：未引用条目、锚点断号、重复 DOI、同 DOI 元数据冲突、孤儿引用；
  判定下沉为纯函数 `packages/core/src/citation-audit.ts`，`issues[]` 历史契约保留，
  另给 `details[]`（level/code/items）供 UI 红/黄/绿分级。
- **学术检索 TTL 缓存 + 全并行**：`ScholarSearchService.search` 加 10 分钟 LRU（`SCHOLAR_CACHE_TTL_MS` 可关），
  三源 × 各关键词并行（原按 query 串行，4 关键词 × 3 源 = 12 次往返）。
- **包公共出口**：`packages/ai`、`packages/retrieval` 补 `index.ts` 与 `package.json`
  （此前连包描述文件都没有，`@sciflow/ai` 无法被当作包引用）。
- **查询路径索引 5 条**：`citation(reference_id)` / `memory_log(project_id, created_at DESC)` /
  `pipeline_task(status)` / `document(project_id, updated_at DESC)` / `reference(project_id, fingerprint)`。
- **健康探针暴露嵌入真实后端**：`capabilities.embeddingBackend`（local/api/none）+ `embeddingDimension`；
  设置页自检同步（此前只看 `EMBEDDING_MODEL_PATH` 是否存在，配了远程 Key 也显示「未配置」，与实际相反）。

### Changed
- **前端按需加载**：`ForceGraph`（sigma+graphology）、`WritingEditor`（CodeMirror）、
  `WritingPreview`（react-markdown+KaTeX）改为 `lazy()`。编辑器句柄拆到独立轻量模块
  `pages/writing/editor-handle.ts`，否则父页面静态 import 会把 CodeMirror 拉回首屏。
  实测：`LiteraturePage` 570KB→106KB、`WritingPage` 682KB→54KB（编辑器与预览各自独立 chunk）。
- **单测速度**：server vitest 开 `isolate: false`（spec 均为纯函数/服务级用例，DB 已按进程隔离），
  40 个 spec 总时长 40s→10s。
- **ESLint 忽略 `.tmp/`**：本机做对标调研时把参考仓库拉进工作区，会让 `eslint .` 直接崩（缺对方插件）。

### Tests
- server 285→312（新增 `citation-audit.spec.ts` 11 条、`retrieval-quality.spec.ts` 16 条）
- 全量回归 223/223、配置中心巡检 25/25、web 128/128、lint 0 error

## [1.8.0] - 2026-10-28

安全收口 + 体验补洞批次：把「归属校验」从 5 个控制器补到全部 13 个（企业模式跨租户越权彻底关闭），
把「实例级配置」从"登录即可改"收紧为管理员专属并给出前端降级视图，质量页补上流水线真正使用的客观分，
记忆中心补上量化指标与项目作用域。

### Security
- **补齐 8 个控制器的归属校验（IDOR）**：`knowledge` / `memory` / `research` / `quality` / `submission` / `agent-trace` / `dashboard` / `chat` 此前**完全零校验**（v1.7 只补了 pipeline）。企业模式下任一账号可：
  - 用他人 projectId 上传/读取知识库资料原文、做跨项目 RAG 问答（他人私有资料进自己的 prompt）
  - 读他人项目的情景记忆（每次研究的主题与结论摘要）、删他人记忆
  - 列他人项目的实验设计稿、读写他人文档的审稿意见、用他人正文生成回复信
  - 按 documentId 读他人稿件的评分与改进建议，按 report id 读任意报告
  - 列他人项目的投稿记录与事件流（期刊名/稿号/修回截止日）、改他人投稿状态、删他人投稿
  - 用他人 projectId 读执行轨迹（输入原文/模型/token）、读单次 run 详情
  - 无 projectId 拉全库总览（他人待确认大纲、超期投稿、低分文档标题）
  - `GET /documents/:id/objective-audit` 单独漏在 citation-audit 之外
  - 关闭方式：`ProjectAccessService` 新增 `assertKnowledgeDoc / assertMemory / assertSubmission / assertResearchDesign / assertReviewComment / assertAgentExecution / assertQualityReport`，13 个控制器全部改为「子资源 → 项目 → owner」断言，非本人一律 404（不泄露存在性）；本地模式行为不变。
- **实例级配置收紧为管理员专属（AdminGuard）**：`settings`（模型厂商/Key/baseURL/连接测试）、`config`（权限档/角色/约束/钩子/预设/审计）、`extensions`（内置资产启停）、`customization`（意图/步骤开关/质量权重/提示词）、`usage`（全实例成本）、`websearch`（provider Key）、`submission` 的期刊库增删。此前只要求登录 —— 任一 member 改 baseURL 即可把全实例请求（含他人稿件）引到自己的服务器，或直接放开权限档。新增 `apps/server/src/auth/admin.guard.ts`；本地模式（AUTH_MODE!=jwt）直接放行，零登录体验不变。
- **企业模式禁止跨租户聚合**：`dashboard/overview`、`memory` 列表、`documents` 列表在无 projectId 时分别改为 403 / 403 / 400（原来静默返回全库）。

### Added
- **质量页「全部文档最新分」总览卡**：进入页面即列出项目内所有文档的客观分（对当前正文实时计算，零模型成本）+ 最新 LLM 分，按**最差优先**排序，带达标/未达标/空文计数与硬伤徽标；点击任一行切换当前文档。此前只能一篇一篇选文档看分，真实痛点「哪几篇还没达标」无法回答。后端新增 `GET /api/quality/project-overview`（归属校验 + 前端兜底排序，不依赖接口顺序）。
- **质量页「客观检查器」卡片**：切换文档即自动出分（纯规则、零模型成本），展示六维分 + FNV 指纹 + 硬伤口径（空文/过短 0 分 vs 其余封顶 40）+ 统计明细。此前该页只有 LLM 7 维分，而流水线门禁用的是客观分 —— 用户会看到「页面 62 分却过闸」的认知冲突。卡片上明写「流水线质量门用的就是这个分」。
- **记忆中心 KPI 卡片**：记忆总量 / 情景记忆 / 程序记忆 / 近 7 天新增四项量化指标（此前这些数字只能从环形图里读）。空态补一张「两类记忆从哪来」说明卡（含项目隔离说明）。
- **记忆中心按项目隔离**：`MemoryPage` 新增 `project` 参数，列表与概览请求都带 projectId（企业模式服务端强制）；契约测试锁定「请求一定带 projectId」。
- **文献发现结果的排序与年份筛选**：学术库命中 20 条时可按「相关度 / 最新 / 高被引」排序 + 年份下限过滤；「全部导入」改为「导入当前结果」，只导入筛选后的集合（隐藏操作是数据污染来源）。
- **普通成员设置页降级视图**：企业模式 member 打开设置页不再吃一墙 403，改为一张说明卡（哪些是实例级配置、可正常使用哪些功能）+ 外观主题（个人偏好，对所有人开放）。新增 `lib/use-auth-role.ts`（health + /auth/me 派生，带缓存）。

### Changed
- `App.tsx` 的 `MemoryPage` 传入 `project`；`api.memory.list` 增加 projectId 参数。
- `pipeline-access.spec.ts` 的「列表」语义扩展到 9 条；`auth-surface.spec.ts` 增加 AdminGuard 契约 2 条。

### Verification
- server **285 passed / 38 files**（新增子资源归属 10 条 + AdminGuard 契约 2 条 + 质量总览 5 条）；web **128 passed / 19 files**（新增记忆项目作用域 2 条 + 客观检查器卡片 4 条 + 总览/默认选中 3 条）；desktop 5 passed。
- `pnpm lint` 0 problem；typecheck ×2；`pnpm -r build` 全绿。
- **JWT 模式真机验证**（独立库 + `AUTH_MODE=jwt`）：
  - admin 注册 → 建项目 → 知识库上传/列表 200；无 token 访问 settings 401；幽灵 projectId 404；无 projectId 记忆 403。
  - member（第二位注册）：读他人项目文档/知识库/投稿全部 404；settings/config/extensions/customization/usage/websearch 全部 403；提权 `POST /config/permission` 403；自己的项目文档/记忆/总览 200；无 projectId 总览 403、文档列表 400。共 23 项断言全 PASS。
- 浏览器巡检：11 个页面 × 亮/暗 + 5 个页面 × 390px，无 console 错误、无横向溢出；6 主题 × 明暗 × 4 页面共 48 张截图，主题均真实生效（采样 `--background` / `--card` / `--radius-lg` / `data-theme` 断言）。
- **`scripts/verify-jwt-access.mjs`（新增，28 项断言）**：自拉独立库 + 独立端口跑真实 HTTP，覆盖数据面 404 / 配置面 403 / 自己资源 200 / 无 token 401 / 跨租户聚合 403·400 / 提权 403；已接入 CI（`types-unit-build` job），失败以非 0 退出。此前这套验证只是一次性临时脚本，删掉就无法复现。
- **`use-auth-role.test.ts`（新增 8 条）**：角色解析契约 —— 本地模式 none、admin/member 判定、无 token 不误请求、接口异常 fail-closed 到 member、并发 inflight 去重、缓存与 reset（登出/换号不残留）、hook 的 loading→实际值。

## [1.7.0] - 2026-10-28

主题多样化 + 科研能力补齐批次：把「只有明暗两种外观」升级为 6 套风格包，并补上对标科研工具的三处硬缺口（学术库发现检索、自动配图可渲染、选题新颖性预检进入自动化流水线）。

### Added
- **6 套主题风格包（与明暗正交）**：科研青绿（默认）/ 学术经典（纸墨衬线·零阴影·2px 圆角）/ 暖色纸感（米黄纸底·柔影·长读）/ 现代极简（纯灰阶·单强调色·去氛围光）/ 暗夜实验室（深蓝黑·霓虹青·等宽数字）/ 高对比无障碍（纯黑白·2px 边框·3px 焦点框·WCAG AAA）。
  - 实现方式：Tailwind v4 工具类编译为 `var(--color-*)`，风格包只覆盖调色板 + 品牌/语义 token + 圆角/阴影/密度/字体刻度，**2600+ 处类名零改动**即可整站换肤（`apps/web/src/styles/themes.css`，约 700 行，gzip 后仍为个位数 KB）。
  - 新增 `data-theme` 维度与 `applyTheme(resolved, style)` 单一写入点；`theme-color` meta 随主题更新；`index.html` 预置脚本同时写风格与明暗，刷新无闪变。
  - 设置页新增「外观与主题」分区（置顶）：6 张真实 token 绘制的预览卡 + 明暗三态；命令面板新增 6 条「风格：X」命令；`lib/theme.ts` 新增 `THEME_STYLES` 单一事实源与 `readStoredStyle`（非法值回落默认）。
- **学术库发现检索（文献页）**：新增 `POST /api/references/discover`，文献页检索区加「本地文献库 / 学术库检索」切换。学术库走 OpenAlex + Crossref + arXiv（免 Key），只返回元数据不入库，命中项按标题去重标记「已导入」。此前三源检索只被流水线内部调用，UI 上新项目没有任何发现文献的入口。
- **自动配图真实渲染**：新增 `MermaidBlock`（按需 `import('mermaid')`，绝不进主包）接管写作预览里的 ```mermaid 代码块。此前流水线「自动配图」生成的图表在预览中只是一段代码文本，图表价值为 0。深色/风格切换时自动重绘；语法错误保留源码 + 提示，不炸页面。
- **新颖性预检节点（流水线第 2 步）**：`novelty-check` 在文献调研前用学术库比对近 8 年同题工作，输出「重叠度（高/中/低）+ 相近工作 + 改题建议」；重叠度 ≥70% 时把提醒写入产物「研究说明」，不只留在日志里。重叠度口径为纯函数 `noveltyOverlap`（以选题 token 为分母取最相近标题覆盖率），零 LLM 调用、结论可复现。可在设置页单独关闭。
- **`pipeline-metrics` 新增纯函数 + 4 条单测**：`tokenizeForMatch`（中英分词，与学术检索门禁同规则）、`noveltyOverlap`。

### Changed
- **主题层去除硬编码颜色**：`index.css` 中 `:root/.dark` 之外的 19 处 hex + 40 处 rgba 全部收敛为 token（玻璃层 `--glass-bg/--glass-blur`、代码块 `--code-bg/fg/border`、链接 `--link`、选区 `--selection-bg`、滚动条、骨架屏、氛围光 `--ambient-1/2`、焦点环 `--focus-ring-color/-w`、气泡前景 `--bubble-user-ink`），使每套风格包都能接管代码块/编辑器/玻璃顶栏，而不是只换卡片底色。
- **对比度还债**：`--muted-foreground` 由 `#64748b`（在 `#f4f6fb` 上 4.40:1，低于 AA）调至 `#5d6d85`（4.87:1）；`--font-heading` 引入，学术/纸感两套用衬线标题。
- **Electron 启动底色跟随系统明暗**（原来固定 `#f4f6fb`，深色用户启动闪白一帧）。
- **默认明暗由 `light` 改为 `system`**（`lib/theme.ts` 与 `index.html` 预置脚本原本不一致，导致首帧按 system 渲染、挂载后被翻回浅色，实测约 41ms 的深→浅闪变）。

### Security
- **流水线端点补归属校验（IDOR）**：`PipelineController` 此前完全没有 `ProjectAccessService` 校验，而 documents / references / knowledge 全部都有——企业模式（`AUTH_MODE=jwt`）下，知道 taskId 的任一账号可读他人流水线的主题、产物文档 id 与执行轨迹，也可替他人项目起流水线烧对方 token。现在 `create/list/:id/confirm-outline/stop/rerun/delete` 全部按「任务 → 项目 → 归属」断言，非本人一律 404（不泄露存在性）；列表在企业模式必须显式传 projectId，本地模式保持零登录全量返回（CLI/回归依赖）。新增 `pipeline-access.spec.ts` 9 条。

### Fixed
- **文献页检索结果卡排到右列**：`LiteratureTable` 直接返回 Fragment，而它是 `grid lg:grid-cols-2` 的一个网格项——命中多时（学术库检索 15-20 条）结果卡会各自成为网格项，把 AI 工具面板挤到下一行、整页错位。现在包单容器 + `space-y-4`。
- **设置页滚动监听的死代码**：`useEffect` 里 `return` 之后的两条语句永不执行（`onScroll()` 与一个错误的 `window.removeEventListener`），且依赖 `[activeSection, sections]` 导致每次高亮变化都重建监听。改为 `[sections]` 单依赖 + 真实容器监听。
- **`--on-brand` 误用**：阶段条徽标前景写死 `#1f1300`，在深色/高对比主题下不可读，改用 `--on-brand`。
- **文献检索结果类型**：`hits` 原声明为本地 `Reference[]`，接学术库元数据时缺 `id/projectId` 等字段；结果卡按可选字段渲染（已核对每条使用点）。
- **`.tmp-brand-mark.txt` 空文件**清理。

### Verification
- server **268 passed / 36 files**（新增选题重叠度 4 条 + 流水线归属校验 9 条）；web **111 passed / 16 files**（新增主题包契约 4 条）；desktop 5 passed；mock 全量回归 **PASS 221 / FAIL 0**。
- `pnpm lint` 0 problem；typecheck ×2 通过；`pnpm -r build` 全绿（mermaid 拆为独立异步 chunk，主包无 mermaid 代码）。
- `scripts/final_acceptance.py` **23/23**；`scripts/full_regression.py`（全新库 + AI_MOCK=1，端口 3101）**PASS 221 / FAIL 0 / KNOWN 0**。
- 浏览器实测（1600×1000，真实后端 3100 + vite 5273）：6 套风格 × 明暗共 12 张截图；点选风格即时生效、`meta[theme-color]` 同步、刷新后保持；写作预览 mermaid 渲染出 SVG；文献页「学术库检索」切换可见；设置页流水线步骤编辑器出现「新颖性预检」（10 步）。
- 对比度脚本核算 12 组正文/辅助文字组合，正文 ≥13:1、辅助 ≥4.87:1，高对比主题 21:1。

## [1.6.0] - 2026-10-27

品牌与界面打磨批次：全站视觉体系重做（品牌 3.0 标志 / 七种表面层级 / 三档字体），修掉一批「所有卡片长得一样」的信息架构问题，并把境外模型依赖的可用性问题在 UI 上摊开。

### Added
- **品牌标志 3.0（墨流 · Current）**：由「两段同心圆弧拼 S」改为**单一连续笔势**——粗细渐变的主 S 水流 + 贯穿全图的主流线 + 收笔处的成果节点。2.0 的同心圆在 24px 以下会退化成两个圈，且与通用 AI 产品的「圆环 + 渐变」高度雷同；3.0 缩到 16px 仍能读出方向。同源更新 favicon。
- **品牌组合排版 3.0**：词标拆 Sci（中等字重）+ Flow（渐变加粗），标语前加 1px 竖分隔线并拉开字距（0.14em），形成期刊页眉式分栏感，替代「图标 + 两行随便的小字」。
- **七种表面层级（SurfaceTone）**：`panel` / `inset` / `metric` / `accent` / `warning` / `danger` / `plain`。此前全站 61 处 `<Card>` 只有一种视觉，指标、图表、表单、列表、危险区完全同权重。现在按信息角色选用，规则是「越靠近内容的容器阴影越弱」。
- **三档字体栈**：`--font-ui`（界面，系统无衬线优先）/ `--font-read`（论文正文与预览，中文宋体 + 拉丁衬线）/ `--font-mono`。全部为系统字体，**零 CDN 依赖**（Google Fonts 在国内不可达且会阻塞首屏），也不新增字体文件。
- **页面抬头（Hero）**：项目总览从「一张塞满内容的大白卡」改为品牌化抬头 + 折叠式偏好设置，首屏出现明确的「运行流水线 / 继续写作」主操作。
- **快捷导航条**：原 5 张等大功能卡（与草稿列表抢主次）改为一行紧凑分段导航，功能不减、视觉权重降低。
- **写作工具面板分组**：9 个等权 section 归并为「写作辅助 / 评审与质量 / 过程资产」三组，组内网格用容器查询自适应列数。
- **设置页导航重建**：11 个锚点与真实 DOM 顺序对齐（原顺序错乱，且 `settings-persona` / `settings-extensions` / `settings-config` 三个锚点在 DOM 中不存在，点了没反应）；补上「连接测试」入口；跳转后导航项横向居中、高亮跟随。
- **厂商预置重排 + 境外可用性提示**：国内可直连厂商（DeepSeek / 通义 / 智谱 / Kimi / 豆包 / UniSound / 硅基流动 / 百度千帆）排前，本地 Ollama 次之，OpenAI / Anthropic / Gemini 标注「境外」并附替代路径说明。原先 OpenAI、Google 排前两位，新用户点第一个必然连接失败。
- **文献引用选择器**：加搜索（标题/作者/期刊/年份）、已引用优先、按年份倒序（文献库 85 条时不再逐条翻找）。

### Changed
- **图表层拆分**：`MetricCard / ChartEmpty / SegBar / Sparkline / ProgressRing` 从 `charts.tsx` 拆到零依赖的 `charts-primitives.tsx`；recharts 从主包剥离为独立 chunk（主包 **0 引用 recharts**，436KB 图表库按需加载，基础件仅 3.34KB）。
- **空态容器**：改为虚线边 + 极浅底，与正常内容卡区分（避免「空态也像有数据」）。
- **长列表绘制**：扩展中心 / 知识库列表加 `content-visibility: auto`，视口外行不参与布局与绘制。
- **全局**：`scrollbar-gutter: stable`，避免筛选/分页切换时整页横向跳动。

### Fixed
- **文献页错误完全不可见**：`error` 被解构为 `_error` 后丢弃，检索/导入/核验失败时用户点完按钮毫无反应。现在页面顶部统一展示并可关闭。
- **写作页工具面板大片空白**：分组后 section 高度不一致，grid 默认拉伸导致「写作辅助」下方一整屏空白（改 `align-items: start` + 自适应行高）。
- **暗色模式对比度**：inset 面板与迷你统计卡在暗色下几乎不可见；品牌徽标内图形在暗色下变成深墨色（`--on-brand` 语义误用）。
- **设置页跳转无效**：滚动容器是 `.app-shell__content` 而非 `window`，且平滑滚动被重渲染打断；改为容器级即时滚动 + 高亮锁定 400ms。
- **MiniStat 卡套卡**：全链路小卡原本在白卡内再套一层白底带边，改为透明弱底。

### Verification
- web **107 passed**（16 files，新增表面语义 4 条 + 品牌组件 5 条）/ server 255 passed / desktop 5 passed。
- typecheck ×2 / eslint **0 problem** / build ×3 全绿。
- 浏览器实测：工作台（亮/暗/390px 移动端）、设置页（11 锚点逐个跳转验证）、写作页（工具分组）、文献页、质量页；移动端无横向溢出（scrollWidth = clientWidth = 390）。
- 主包体积：recharts 引用数 **0**；`charts-primitives` 3.34KB、`charts` 436KB（独立异步 chunk）。

## [1.5.0] - 2026-10-27

真实论文全流程验收批次：用 u2-flash 从 UI 端到端跑完多篇完整论文，把「跑不通 / 跑完看不见产物 / 分数注水」逐条修掉；新增**确定性客观质量检查器**（六维硬指标 + 学术诚信检测）作为门禁唯一判定依据，LLM 评分降为参考建议。

### Added
- **客观质量检查器 `packages/core/src/quality-audit.ts`**：纯函数、零随机、零网络，六维各 20 分（结构完整性 / 篇幅达标 / 引用闭环 / 可读性 / 修辞严谨 / **学术诚信**）归一为 100 分；硬伤（占位符、空文、重复段落、长篇零引用、悬空锚点、名实不符）直接封顶 40 或 0；附 FNV-1a 指纹，同文本必然同分同指纹。
- **学术诚信维度（名实相符）**：检测「自述未开展原始实验 / 仅归纳已有研究」却给出「实验结果表明…优于/提升/有效」的稿子——本系统不运行实验，这类结论属于编造研究成果。实测拦下一稿：原 97 分假绿灯 → 40 分硬伤。
- **结构维度按文章类型判定**：综述/框架类不再被「缺方法/结果章节」误罚（本系统不跑实验，强求结果章节只会逼模型编数据）；实证类（有结果表/带数值指标）仍按 IMRaD 要求。
- **`GET /api/documents/:id/objective-audit`**：返回六维报告 + 硬伤 + 统计 + 指纹 + 最近 LLM 评分历史（对照漂移）。
- **CLI `sciflow quality check --doc <id> | --file <path>`**。
- **前端「客观检查器」面板**（写作页 → AI 工具）：六维条形图、硬伤清单、指纹、字符/章节/引用统计、证据展开、手动重跑；切换文档自动清空避免串分。
- **`POST /api/pipeline/:id/rerun`**：失败/中断任务一键沿用原主题重跑（此前只能删除任务再手输主题）；流水线页失败卡片加「重跑本任务」按钮。
- **内置免 Key 学术检索 `ScholarSearchService`**：OpenAlex + Crossref + arXiv 三源合并去重，为全新项目补充真实文献元数据（否则起草阶段零参考文献，引用维度必然崩）。
- **文献相关性门禁**：检索词分组覆盖 + token 级相关度排序 + 标题必命中；实测把 DeepLab / 图像修复 / 遥感超分等跨域高被引论文挡在参考池外。

### Changed
- **质量门以客观分为准**（原为 LLM 分与客观分取 min）：同一稿件 LLM 评分实测在 27–59 之间随机漂移，取 min 会让「内容没变差但模型心情变了」反复回炉。LLM 反馈仍注入回炉提示词，但不参与合格判定。
- **参考文献排序改为相关性优先**：原按被引数排序导致池子里前几条是 DeepLab/Bagging 等离题高被引论文；现在按「主题词 + 检索词」token 相关度排序，相关条目 ≥8 时剔除零相关旧条目。
- **起草池与渲染池输入统一**（projectId + topic + keywords）：此前起草不传主题、渲染不传主题，两个池顺序不同 → 正文 `[n]` 与参考文献编号错位（评审据此误判「引用严重错误」）。
- **评审附录按 citation 插入序编号**：此前用文献池顺序拼附录，正文 [18] 与附录第 18 条对不上。
- **润色改为真并行**：去掉了嵌套 `p-limit`（外层占满并发槽时内层 `complete()` 永不调度，实测挂死 5.5 小时）；11 段/14 段并行润色实测 71–90 秒完成，另加 600s 总看门狗 fail-soft。
- **评审 LLM 失败降级**：`reviewPaper` 空响应不再让整条已起草完成的流水线判 failed，改为仅用客观检查继续。

### Fixed
- **润色死锁**（严重）：`polish()` 内层 `this.limit` 与 `complete()` 内同一 p-limit 嵌套，`AI_RPM_CAP` 较小时永久饿死；任务卡 5.5h、0 CPU、0 外连、0 LLM 调用记录。
- **流水线产物不可见**：完成后工作台仍展示旧稿（`docs[0]` 按 updatedAt 升序=最旧一篇）；现在优先展示任务产物，并在任务完成的瞬间清掉用户此前的显式选择。
- **写作页 `?doc=` 失效**：`initialDocId` 只在挂载时读一次，点「完整编辑器」打开任何文档都落到同一篇；无指定时也默认取最旧一篇（改为最新）。
- **导出参考文献作者显示为 JSON 数组**：`exportMarkdown` 未走 `parseAuthors`，导出成 `— ["A","B"]`（docx 路径本来就是对的）。
- **检查器 CRLF 失配**：同一文本 LF 得 97、CRLF 得 82（`^`/`$` 锚定规则在 `

` 上全部失效）；入口统一换行归一。
- **检查器 `/g` lastIndex 污染**：`RegExp.test` 在 `/g` 模式推进 `lastIndex`，同一正则第二次调用结果不同 → 「综述类」判定时真时假；统一改为无状态克隆测试，并加 50 次连测守护。
- **`AI 返回空响应` 死循环重试**：`defaultMaxOutput()` 用厂商上报的 131072 导致 180s 超时，改为封顶 8192；润色按输入长度估算输出上限。
- **模型重复输出章节标题 / 自造参考文献块**：`sanitizeSectionDraft` 剥掉复述标题与自造 `## 参考文献`（曾把正文截断成首章）。
- **流水线步骤失败即整条 failed**：文献检索/学术检索失败均静默降级，不阻塞主流程。

### Verification
- server 253 passed（35 files）/ web 98 passed（15 files）/ desktop 5 passed；typecheck ×2 / eslint 0 problem / build ×3 全绿。
- 客观检查器单测 23 条：100 次同分同指纹、CRLF 等价、/g 状态隔离 50 次、名实不符硬伤、真实验稿不误伤、综述结构不误罚。
- 真实端到端（u2-flash，全程 UI 操作）：论文《异配图节点分类中残差聚合的失效边界：机理分析与评估协议》15,019 字符 / 9 章 / 19 条引用，客观分 **98/100**（结构 20 / 篇幅 20 / 引用 20 / 可读 17 / 严谨 20 / 诚信 20），指纹 `q88eff328`，连续 3 次调用完全一致；全文 0 处虚构实验结论。
- 参考池 19 条全部为异配图 / 过平滑 / 残差连接 / 节点分类主题（此前混入 DeepLab、图像修复、遥感超分等 5 篇跨域论文）。

## [1.4.0] - 2026-10-26

扩展中心批次：内置 87 条科研资产（社区开源 74 + SciFlow 私有优势 13）随仓库发布、默认全启用；技能/ MCP / 角色 / 约束 / 钩子 / 提示词六类统一管理，四种添加入口 + 对话入口，全部真实投影到对应子系统。

### Added
- **扩展中心（`/api/extensions`）**：`extension_asset` 单表承载六类资产；`source=builtin-public`（社区开源，含仓库/许可证/安装方式）/ `builtin-private`（SciFlow 私有优势工具，仅本机可见）/ `user` / `import`；`enabled` 默认 1。
- **内置目录 87 条**：
  - 20 个 MCP（Context7、DeepWiki、arXiv、Paper Search、Zotero、BioMCP、Semantic Scholar、CNKI、Obsidian、NotebookLM、Basic Memory、Deep Research、Agentset、DocsAgent、PaperDebugger、PDFMathTranslate、Lit Review Tools、Patsnap、Obsidian Wiki、LLM for Zotero）
  - 31 个技能（Anthropic 官方 Skills、Academic Research Skills 53.9k★、Codex/Claude 学术三件套、Agent Research Skills、Claude Scholar、Academic Humanizer、Claude Prism、LatteReview、Paper Proofreading、AI Research Writing、Deep Research Prompts、Awesome Agent Skills 等 + 13 个 SciFlow 私有：引用体检/统计口径审计/可复现性方案/伦理扫描/图表规范/新颖性扫描/基金契合/投稿风险/审稿答辩/精读矩阵/实验计划/数据可用性/提示词加固）
  - 10 个角色（方法学家/统计顾问/期刊编辑/基金评审/数据管理员/伦理审查员/科研馆员/可复现性专员/图表设计师/审稿回复专家）
  - 10 条约束、4 个钩子、12 个提示词模板
- **四种添加入口（每个资产面板都有）**：① 手填模板 ② 粘贴 SKILL.md / 模板 JSON / MCP JSON ③ 拖拽上传 .md/.json/.zip（ZIP 自动解析内部 SKILL.md 与 JSON）④ 一键 AI 生成（按模板出草稿，jsonrepair 容错，确认后落库）。第五入口：对话工具 `extension.list/create/toggle/generate`。
- **投影真实生效**：启用/停用同步到 `app_setting.skills`（技能，保留内置 4 项）/ `config_role` / `config_constraint` / `config_hook` / `custom_prompt`（仅显式「应用」时）/ `mcp_server`（HTTP 端点）。
- **私有优势工具不外泄**：导出包与外部 MCP 客户端的 `extension.list` 均过滤 `visibility=private`。
- **CLI**：`sciflow ext list|toggle|import|export|reset`。
- **设置页新增「扩展中心」分区**：分类计数、私有开关、停用/启用/删除/恢复内置/导出；各资产面板（角色/技能/提示词/约束/钩子/MCP）内置「从扩展中心添加」快捷入口。
- **回归新增 12 条**（快照/六类齐全/默认启用/含私有/模板齐全/导出不含私有/手填新增并注入/停用撤回/删除/SKILL.md 导入/非法格式报错）。
- **巡检新增 5 项**（资产 ≥80 / 内置全启用 / 含私有 / 导出不含私有 / 扩展工具暴露），巡检总数 19→24。

### Changed
- **提示词模板默认不覆盖系统默认**：模板「启用」只代表可用，必须显式点「应用」才写入 `custom_prompt`——自动覆盖会静默改变流水线起草的 [n] 锚点契约（回归实测 citations 回填失败，故收紧）。
- **资产 key 生成**：非 ASCII 名称改用哈希短码（此前中文名净化后产生空 slug 冲突）。

### Fixed
- **AI 生成返回非法 JSON 时整体失败**：改用 `jsonrepair` 修复（与 `AiService` 同策略），失败时才报可读错误。
- **前端一键生成 60s 超时**：AI 生成最长 3 分钟，改为显式 `AbortSignal.timeout(300_000)` 关闭默认兜底。

### Tests
- 新增 `apps/server/src/extensions/extensions.service.spec.ts`（18）、`apps/web/src/pages/settings/ExtensionCenter.test.tsx`（11）。
- 门禁：server 221 / web 98 / lint 0 / typecheck ×2 / build ×2 / final_acceptance 23/23 / 回归 **PASS 220 / FAIL 0** / 巡检 24/24。

## [1.3.0] - 2026-10-26

配置中心批次：角色 / 约束工程 / 钩子 / 权限矩阵 / 审计统一到一个服务，Web 设置页、CLI、对话工具三条入口共享同一数据源，任一入口写入其余入口立即可见并真实生效。

### Added
- **配置中心（`/api/config`）**：角色库（默认角色即对话角色，可切换/删除非默认）、约束工程（level=must/must_not/should，scope=all/chat/pipeline，按 sortOrder 注入）、钩子（`chat:before|chat:after|pipeline:before|pipeline:after` × `prompt_inject|block|webhook`）、权限档、审计、预设、生效预览。
- **权限矩阵**：`strict`（只读）/`balanced`（角色/约束/钩子/提示词/技能）/`open`/`unrestricted`（全面放开，默认档）。核心保护项（鉴权、密钥与加密、SSRF、审计、数据库路径、监听地址端口、不可逆操作）任何档位不可改，UI 明示原因。
- **对话内完成配置**：新增 8 个 MCP 工具 `config.snapshot / set_permission / upsert_role / upsert_constraint / delete_constraint / upsert_hook / apply_preset / preview`，模型可在同一轮对话里连续调用完成多项设置（步数上限 12、单轮 24 次），完成后前端显示「工具调用 · N 次」折叠卡并汇总结果。
- **CLI 对等入口**：`sciflow config status|permission|role|constraint|hook|preset|preview|audit`，与 Web/对话同一服务；写操作带 `X-Sciflow-Actor: cli` 审计来源。
- **技能开关真实生效**：停用「文献检索 / 知识库问答 / 写作辅助」会同步裁掉对应 MCP 工具；配置工具不受影响。
- **内置预设 4 套**（离线）：学术严谨型、高效产出型、审稿人视角、数据处理型；应用幂等。
- **配置包导入 / 导出**：`GET /api/config/export` / `POST /api/config/import`（`sciflow config export|import`，设置页「导出 JSON / 粘贴导入」）。导出不含审计与密钥；导入幂等（同标题同规则/同名同事件同类型跳过），`--replace` 可覆盖用户自建项，单条坏数据只跳过不整体失败。
- **运行时巡检脚本** `scripts/monitor_config_center.mjs`：19 项只读检查（含对话真实返回与 usage、日志无 error），供监控 / CI 使用。
- 设置页新增「配置中心」分区：权限档、一键预设、角色、约束（带注入预览）、钩子、审计。

### Changed
- **角色唯一事实源**：`config_role` 取代 `app_setting.system_prompt` 作为角色来源；设置页「角色与技能」保存时同步写角色库，旧数据保留兼容回退。
- **约束/钩子注入点收敛**：`packages/ai/src/prompt-augmentation.ts` 为唯一实现，`AiTransportService` 四个 LLM 入口统一追加 system 层；设置页预览与真实调用同源。
- **无项目也能用工具**：ChatService 不再要求 projectId 才注入工具集；无项目时自动隐藏必填 projectId 的科研工具，保留配置工具。
- **CLI 退出**：命令失败改用 `process.exitCode`（Windows 下 `process.exit` 触发 libuv 断言）。

### Fixed
- **设置页角色与配置中心不同步**：此前两套存储各自为政，页面显示与模型实际收到的不一致；现已统一。
- **配置类对话工具在无项目时不可用**：此前 `useTools` 依赖 projectId，导致空库用户无法通过对话完成设置。
- **权限档可被一键解除（监控 AI P1）**：`setPermissionMode` 此前只校验枚举、不过权限矩阵，strict 下 40 秒即可切回 unrestricted；现改为专用门禁——降档自由、**升档每次最多一级**，非法值 400（不再静默回落），导入包夹带的 `permission.mode` 默认忽略。
- **非法权限档静默提权（P2）**：`normalizePermissionMode` 未知值原回落 `unrestricted`；现 fail-closed 回落 `strict`，DB 读取遇脏值告警。
- **重复钩子重复注入（P1）**：`config_hook` 缺唯一约束导致同名同事件同类型可重复创建、每次对话重复注入；现加 `ux_config_hook_name_event_type` 唯一索引 + 创建前预检。
- **非流式对话绕过 chat 作用域与钩子（P2）**：`/api/chat`、MCP `chat.answer` 走 caller=general 被判为 pipeline 作用域，且不执行 `chat:before`；现显式 `context: 'chat'` 并接入 block 钩子（返回 400 而非 500）。
- **审计可被删除（P2）**：`config_audit` 现加 `BEFORE UPDATE/DELETE` 触发器（任何档位不可改写/删除）；`merge=false` 导入先快照被删条目写入 `bulk_delete` 审计。
- **唯一默认角色可被停用（P3）**：`updateRole` 增加不变量守卫，禁止把唯一可用默认角色取消默认或停用。
- **巡检脚本假绿（P2）**：检查项从 14 增至 19（钩子重复/类型、默认角色原始计数、全部适用约束覆盖、审计拒绝原因、日志文件存在），并补充日志体积记录。
- **block 钩子抛裸 Error → 500**：改为 `BadRequestException`，非流式入口返回 400 可读原因。

### Tests
- 新增 `apps/server/src/config/permission.spec.ts`（6）、`config-center.spec.ts`（22）、`agent/agent-skill-gating.spec.ts`（4）、`packages/ai/src/prompt-augmentation.spec.ts`（6）、`apps/web/src/pages/settings/ConfigCenterSettings.test.tsx`（6）。
- 回归脚本新增配置中心 16 条断言（快照/约束增删停用与注入/钩子增删与拦截/权限拒绝与审计/预设幂等）。
- 门禁：server 203 / web 87 / lint 0 error / typecheck ×2 / build ×2 / final_acceptance **23/23**（新增 CLI config status/preview 两项）/ 回归 PASS 205 / 巡检 19/19（已接入 CI）。

## [1.2.0] - 2026-10-26

模型接入体验批次：设置页从「手填模型名」升级为「填地址和 Key → 自动检测模型 → 自动匹配能力 → 连接测试」，并在真实浏览器里用 UniSound u2-flash 端到端验证。

### Added
- **三种主流协议**：OpenAI 兼容（默认）/ Anthropic Messages / Google Gemini，官方 AI SDK provider 接入（`@ai-sdk/anthropic` 4.0.78、`@ai-sdk/google` 4.0.93），与仓库现有 `ai@7.0.137` 的 provider 依赖版本对齐。
- **自动检测模型**：填写 Base URL + Key 后 800ms 防抖自动拉取 `/models`（也可点「检测模型」），结果展开为可选列表并显示上下文窗口 / 输出上限 / 工具调用能力；网关元数据缺失时允许手填。`POST /api/settings/providers/discover`。
- **连接测试**：表单内「测试连接」与厂商行内「测试」均用当前表单值（未保存）发最小消息，不切换、不落库；失败按鉴权/模型不存在/超时给可读原因。`POST /api/settings/providers/test`。
- **能力自动匹配**：厂商行新增 `protocol/context_window/max_output/tool_calling/models`，激活即生效；最大输出超过上下文窗口时服务端钳制，未上报时单次输出上限回落 4096；`tool_calling=0` 时 chat 静默移除工具集而不是被上游 400。
- **常见厂商预置**：只预置地址与协议（OpenAI / Anthropic / Gemini / DeepSeek / 通义 / 智谱 / Kimi / 豆包 / UniSound / Ollama），不再硬编码模型名（旧硬编码已过时会误导）。
- **本地端点开关**：Ollama 等回环地址需显式勾选「本地/内网端点」，仍拒绝云元数据地址（SSRF 守卫不放松）。

### Fixed
- **StrictMode 下对话永远停在「正在生成…」**：`useChatSession` 的挂载清理把 `mountedRef` 置 false 后未在重新挂载时复位，`onDone/onError` 被整体吞掉（浏览器实测复现，修复后正常收尾）。
- **流式 token 恒为 0**：OpenAI 兼容 provider 未开 `includeUsage`，上游 usage 块从不返回；开启后成本与上下文占比恢复真实值。
- **编辑激活中的厂商不生效**：此前只改库不刷新内存连接，出现「页面显示新模型、实际仍打旧端点」；更新激活厂商后重新 `switchProvider`。
- **掩码 Key 被当真实 Key 上送**：检测/测试接口编辑态提交掩码回显时回查库内真实 Key，避免 `***` 触发 401。

### Tests
- 新增 `packages/ai/src/model-catalog.spec.ts`（10）、`apps/server/src/settings/settings.provider.spec.ts`（9）、`apps/web/src/pages/settings/ProviderManager.test.tsx`（8）。
- 门禁：server 165 / web 81、typecheck ×2、eslint 0 error、server build 全绿。
- 真实浏览器验证：设置页点击「UniSound MaaS」→ 键盘输入 Key → 自动检测 29 个模型 → 选择 u2-flash（上下文 1M / 输出 131K）→ 「测试连接」1425ms 正常 → 保存 → 激活 → 列表「测试」1592ms 正常 → 工作台对话真实返回「正常」并落 `llm_call_log`。

## [1.1.0] - 2026-10-25

产品化收口批次：安全收口、品牌升级、前后端 1:1 对齐、人设与技能体系，以及界面整合与默认亮色。

### Security（阻断级）
- **企业模式系统性 IDOR 收口**：`ProjectAccessService` 新增 `assertReference` / `assertExtractionField` / `assertExperiment` 三断言；projects PATCH/DELETE、documents 全部操作端点、references/experiments controller 整体重写注入归属校验（此前部分端点仅校验项目、未校验资源归属）。
- **experiments run 任意命令执行面**：运行沙箱入口增加项目归属与文档归属校验，堵住跨项目/伪造 documentId 的执行路径。

### Added
- **墨流 2.0 品牌**：一笔流线 S + 数据闭环轨道弧 + 思想节点/收笔墨滴；渐变三色 `#0f9e94→#0b8fb4→#0b6fc4`；favicon/apple-touch-icon/SVG/PNG 全套 + docs 品牌规范。
- **前后端 1:1 对齐补缺**：手动版本快照入口（提交信息 + 创建快照，快捷键文案更正）；项目总览「Agent 执行追踪」卡片（最近执行 + 近 14 天 Token 走势）；命令面板知识库检索改走服务端 `knowledge/search`（BM25+向量，按文档聚合）。
- **角色与技能（persona + skills）**：设置页新增「角色与技能」——自定义系统提示词（整体替换内置角色段）+ 技能启停（内置 4 项 + 自定义增删）；chat 每轮注入自定义人设与启用技能清单。新端点 `GET/POST /api/settings/persona`。
- **界面整合**：默认亮色（无存储即浅色）；侧边栏「自动化」「记录与洞察」低频分组默认折叠（渐进披露）；设置页 8 分区导航滚动跟踪激活高亮。

### Fixed
- **外部 MCP 工具恒传空参数**：McpToolList 外部工具 externalArgs 双模式（JSON / 纯文本）透传修复。
- **community 排序无效**：改社区号升序 + 内部 id 稳定排序。
- **AI 空响应用 429 伪装**：`AiEmptyResponseError` 可重试语义，耗尽后 502 暴露。
- **lint 全绿**：eslint 配置转 `.mjs`（消除 ESM 探测警告）+ TanStack Table 兼容告警行级豁免（带原因注释）。

## [1.0.1] - 2026-10-24

发布后真实性检查驱动的缺陷修复批次：真实模型运行暴露的挂起死锁、联网检索未接入流水线，以及一轮数据口径与重复实现清理。

### Fixed（阻断级）
- **上游挂起导致流水线永久卡死**：`packages/ai/src/ai-transport.service.ts` 此前只有「客户端断连」信号，无浏览器请求（流水线/CLI/MCP）时上游不回包会无限等待（真实事故：quality-gate 卡死 17.5 分钟）。新增请求级超时 `AI_REQUEST_TIMEOUT_MS`（默认 180s，0=禁用）：非流式按总时长、流式按「空闲无数据」判定，超时抛 504 并写明可调参数。
- **运行中的流水线无法停止**：新增 `POST /api/pipeline/:id/stop`（`pipeline.controller.ts` / `pipeline.service.ts:stop`）。停止置 `cancelled`，运行中步骤标 `cancelled`、未执行步骤标 `skipped`，并阻止在途节点把状态改回 running；停止后 `DELETE` 不再被「请先停止」阻塞。流水线页新增「停止」按钮（二次确认）。

### Added
- **流水线联网检索**（默认关闭）：`apps/server/src/pipeline/pipeline-websearch.ts` 把 WebSearchService 的五 provider 结果转成 `PaperHit`（按 URL 去重、上限 6 条、匹配度 0.9→0.5 递减），并入文献步骤的检索摘要与起草 prompt（标注为「未入库、不可直接引用」）。开关：`WEBSEARCH_IN_PIPELINE=on` 或 app_setting `websearch_in_pipeline=on`；失败静默降级不影响流水线。
- **Agent 工具调用可视化**：chat 会话建立 `agent_execution` run，工具调用落 `agent_step`（此前 chat 路径 runId 恒空，前端看不到）；前端 `MessageList` 新增「工具调用 · N 次」折叠卡（`chat-session.ts` 不再丢弃 `tool_calls` 事件）。
- **judgment 层 provider 可插拔真正接线**：`JUDGMENT_BASE_URL` / `JUDGMENT_API_KEY` / `JUDGMENT_MODEL` / `JUDGMENT_TIMEOUT_MS` 生效，判别请求可脱离主生成模型。

### Changed
- **分数口径统一**：chat 的 `sources[].score` 统一为 0-100 百分制；前端删除 `score > 1 ? score : score*100` 的量纲猜测（低相关命中会被放大 100 倍）。
- **版本单一来源**：新增 `apps/server/src/common/version.ts`（运行时向上查找 package.json），MCP `serverInfo` 与外部 MCP Client 自报版本从写死的 0.3.0/0.4.0 收敛到包版本；CLI 同步。
- **文档校准**：README 导出能力（LaTeX/HTML 已接）、测试数（server 139 / web 73）、回归条数（184）；CHANGELOG 工作台深度选择器表述；`scripts/full_regression.py` 头注基线。

### Fixed（数据口径与重复实现）
- **知识库匹配度归一错误**：检索分是百分制（1-100），流水线按 `/8` 归一 → 任何 ≥8 分都夹到 1.0，跨库匹配度失去区分度；改为 `normalizeKnScore()`（`pipeline-metrics.ts`）。
- **token 预算漏计/串账**：`lastTotalTokens` 是实例级单值，并行起草后逐个读取只能拿到最后一个调用；新增 `lastTokensFor(caller)` 按调用方取值，`trackBudget(taskId, caller)` 显式传参与评审/润色共用。
- **用量平均时延失真**：失败调用以几十毫秒快速失败，混入 `AVG(latency_ms)` 会把真实耗时压到极低；改为只统计成功调用（`usage.service.ts`）。
- **Agent 用量按日聚合时区错位**：`toISOString()`（UTC）与 SQL 报表 `localtime` 口径不一致；统一为本地日界（`normalizeAgentDate()`）。
- **尾部块正则重复实现**：`documents.service.ts:polish` 自写 `indexOf('## 参考文献'/'## 图表')`，不认识「## 研究资料」→ 知识库参考块被送进润色；改用 `tail-blocks.ts` 单一来源。
- **步骤标签重复定义**：`WorkspacePage.tsx` 自写 `STEP_LABELS`，与 `packages/core/pipeline-steps` 漂移（如 `outline: '大纲'` vs `'大纲生成'`）；改用 core 单一来源。
- **桌面端 test 脚本不可用**：`apps/desktop` 未装 vitest，`pnpm --filter @sciflow/desktop test` 必然失败；改为经 server 的 vitest 配置运行（5 条桌面契约测试真跑通）。
- **web 测试缺 `@sciflow/core` 别名**：vitest 配置未同步 vite 的别名，导致 import core 的组件测试直接解析失败；已补齐。

### Tests
- 新增：`ai-transport.timeout.spec.ts`（4）、`ai-transport.tokens.spec.ts`（3）、`pipeline-stop.spec.ts`（6）、`pipeline-websearch.spec.ts`（5）、`pipeline-metrics.spec.ts`（4）、`usage.service.spec.ts`（3）；回归脚本新增 6 条停止接口断言（178 → 184）。
- 门禁：server 139 / web 73 / 桌面 5、`final_acceptance.py` 21/21、回归 PASS 184 / FAIL 0。

## [1.0.0] - 2026-10-24

首个正式版：深度研究能力（对标 deep research 类工具）+ 反同质化 + 实验设计助手，外加 CLI headless 全流程与一批工程收尾。竞品调研对标 Stanford STORM / Elicit / NotebookLM / GPT-Researcher / PaperQA2（2026-10-24，结论沉淀于本批架构文档与 README）。

### Added（深度研究与差异化）
- **研究深度参数（depth 1-3）**：文献调研按轮递归——第 2+ 轮由 Planner 依据上一轮发现给出新检索词，命中跨轮去重合并、零新增自动收敛；流水线页可切换（标准/深入/彻底），全局设置落 `pipeline_research_depth`，工作台按同一设置运行。
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

品牌与体验打磨批次 + 全维度审查驱动的数据完整性修复。审查报告见 [`docs/archive/AUDIT-2026-10-23.md`](docs/archive/AUDIT-2026-10-23.md)（35 条发现、具名竞品矩阵、路线图）。

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
- `docs/archive/AUDIT-2026-10-23.md`：全维度审查与对标报告。
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
详细记录见 [`docs/archive/RUNTIME-FINDINGS.md`](docs/archive/RUNTIME-FINDINGS.md)。

### Added
- **Agent 工具链（核心能力）**：`AgentToolBridge` 把 11 个 MCP 工具转成模型可调用工具，对话中模型能自主检索文献库/知识库。带项目作用域（防跨项目检索）、调用次数上限、单项超时、轨迹落库。实测真实模型单轮触发 5 次工具调用并引用真实文献元数据。
- **流式能力补全**：`completeStream` 改遍历 `result.stream`，转发 `text-delta` / `reasoning-delta` / `tool-call`；前端新增 `onToolCall` 回调。此前推理增量与工具调用被完全丢弃。
- **布局契约 `AppShell`**：侧栏/工具栏/滚动/断点收敛到一处，窄屏自动变抽屉。写作页由五栏改为「编辑器主区 + 底部 Tab + AI 助手抽屉」。
- **语义化设计 token**：`--foreground` / `--muted` / `--border` / `--viz-series-*` 等，图表与 DAG 不再写死 hex。
- **LaTeX / HTML 导出**：`DocExporter` 接上两个按钮（本地纯函数转换，不依赖网络）。
- **引用顺序护栏**：新增 `citation-order.spec.ts`（5 条），并做过红绿验证。
- **用量分型统计**：`llm_call_log.kind` 区分 `llm` / `tool`，成本看板不再被无 token 的工具调用污染；新增 `tools` 汇总。
- **文档**：`docs/archive/RUNTIME-FINDINGS.md`（实测记录）+ `docs/runtime-screenshots/`（修复前后对照）。

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
- **docs/archive/HANDOFF.md**：新环境/新会话续接唯一入口（起步/完成度/待办/踩坑清单/文档地图）。
- **docs/archive/audit-report.md + docs/archive/audit-notes.md**：深度审计报告与 76 项原始疑点笔记入仓归档。

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
