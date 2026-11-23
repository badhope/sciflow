# 生态对标与真实性审计（2026-11-04）

[English](ECOSYSTEM-AUDIT.md) · **简体中文**

> 中文完整版：保留更多实现细节与历史背景；如与英文主文冲突，以英文主文为准。



> 本文回答三个问题：① 我们宣称的能力是否真实实现；② Agent harness 生态里有什么、我们缺什么、补了什么；
> ③ 同类开源项目有哪些值得吸收的设计，吸收到什么程度。所有外部事实以调研来源为准，
> 无法核实处标注 `[待核实]`，禁止凭记忆硬编。

---

## 1. 真实性审计（宣称 vs 事实）

验证面不是口头承诺，而是四道可复现门禁（全部在 AI_MOCK 模式下可离线复跑）：

| 门禁 | 命令 | 基线（2026-11-04 实测） |
|---|---|---|
| 单元测试 | `pnpm -r test` | server 50 文件 / 400 测试 · web 25 文件 / 175 测试 |
| 全量回归 | `python scripts/full_regression.py` | PASS 238 / FAIL 0 / KNOWN 0（全新库） |
| 路由探针 | `python scripts/route_probe.py` | 96 条全过 |
| 验收矩阵 + 巡检 | `python scripts/final_acceptance.py` · `node scripts/monitor_config_center.mjs` | 23/23 · 25/25 |

`docs/product-roadmap.md` 的能力表逐项有测试背书；路线图上标 `Partial` 的三项
（评审意见闭环、段落级恢复、桌面安装包 CI）如实标注为未完成——第三项本次已落地（见 §4）。

**轮子审计抽查**（对照 `ARCHITECTURE.md` §7 禁止重复造轮子守则）：
LLM 调用=AI SDK v7、编排=LangGraph、MCP=官方 SDK 1.32、结构化输出=generateObject+zod、
图表=recharts 封装、表格=TanStack Table v8、数据获取=TanStack Query、全文检索=FTS5 trigram、
向量=sqlite-vec、重试/并发=p-retry/p-limit、导出=docx、引用=citation-js(CSL)、日志=nestjs-pino。
抽查未发现手搓基建代码复活。

## 2. Agent 协议层：MCP / A2A / AG-UI 的取舍

2026 年的共识是三层协议栈（调研来源：cannyforge 2026 框架综述、qualiasolutions 生产化盘点、
devtoolhub/particula 协议核查文，均 2026 年内发布）：

| 层 | 协议 | 现状 | SciFlow 采取的动作 |
|---|---|---|---|
| Agent ↔ 工具/数据 | **MCP**（Linux 基金会 AAIF 治理，事实标准） | 我们用官方 `@modelcontextprotocol/sdk@^1.32.1`，Streamable HTTP + stdio 双传输，工具+资源已暴露 | **已有，保持**。[待核实: 对照 modelcontextprotocol.io 2026-07 stateless 破坏性变更核对 1.32.x 是否已适配；当前回归与真实端点互通正常] |
| Agent ↔ Agent | **A2A**（Apache-2.0，捐 Linux 基金会，2026-08 并入 AAIF） | 我们是**单智能体 + 图编排**，没有跨框架委派场景 | **明确不做**（C3 判断：无消费方的协议层是负债不是资产）。触发条件写入下文"引入时机" |
| Agent ↔ 前端 | **AG-UI**（CopilotKit，~17 种类型化事件） | 我们有自研 SSE 事件契约（delta/reasoning/tool_calls/usage），稳定且有回归覆盖 | **暂不迁移**。迁移触发条件：出现「第三方前端要接 SciFlow 后端」的真实需求时，把 sse.helper 的事件映射换成 AG-UI 事件——改一处映射层即可，架构上已预留 |

**A2A/AG-UI 引入时机（写死，防止心血来潮）**：出现第二个独立 Agent 需要互相委派任务 → A2A；
出现外部 UI 消费方或需要 CopilotKit 生态 → AG-UI。两者都出现前，实现它们只增加复杂度。

## 3. Harness 生产纪律对标（2026 共识 vs 本仓实现）

| 纪律项（业界共识） | 本仓状态 | 本次动作 |
|---|---|---|
| 循环步数上限 | `stopWhen: stepCountIs(n)` + `AGENT_MAX_TOOL_CALLS`（闭包隔离） | 已有 |
| **重复调用检测**（事故榜第一的空转：限额内反复刷同一工具） | **缺失** | ✅ 新增 `AGENT_TOOL_REPEAT_LIMIT`（默认 3）：（工具+参数稳定哈希）计数超限拒绝执行，给模型可读换路提示；键序不敏感；按请求隔离。3 条行为测试锁定 |
| 超时 + 看门狗 | 单步超时、流式空闲看门狗、工具 20s 超时 | 已有 |
| **模型降级链**（主模型重试耗尽 → 备选模型） | **缺失** | ✅ 新增 `AI_MODEL_FALLBACK`：非流式路径主模型失败后自动切备选重试一次，`caller:fallback` 留痕；流式路径不适用（增量已出无法重放），如实标注 |
| 成本遥测（cost-per-task） | `llm_call_log` 全量留痕 + 按日聚合 + 项目 token 走势 | 已有 |
| 评测集 | promptfoo 离线集 + autoevals 数值护栏 + 回归 238 断言 | 已有 |
| 技能渐进披露（Anthropic/Google 2026 方向） | 扩展中心 99 条资产 + 技能开关真实裁剪工具面 | 已有 |
| human-in-the-loop | 工具审批（副作用工具暂停 + 可读理由）+ 大纲人工确认节点 | 已有 |
| 提示注入防护 | 出站守卫（SSRF）+ 权限档；**注入检测专项缺失** | 登记为缺口（见 §6），未实现 |

## 4. 同类项目对标（12 个，逐个过设计，不看过场介绍）

对标对象（按调研来源整理，2026 年内资料）：GPT-Researcher、STORM/Co-STORM、DeerFlow、
PaperQA2、local-deep-research、Feynman、OpenScholar、Open Deep Research(LangChain)、
Onyx、Khoj、SurfSense、AutoGen。吸收原则：**只吸收与本仓定位（科研全流程工作台）一致的设计，
且每项都要落到代码或明确登记为不做的理由**——「学过」的惟一证据是代码里有它。

| 来源项目 | 值得学的 | 我们的对应 | 状态 |
|---|---|---|---|
| GPT-Researcher | 递归研究树（宽度/深度可配）；MCP client+server 双向 | 流水线=LangGraph 图（回炉节点即自适应深度）；MCP 双向都有 | ✅ 已覆盖 |
| GPT-Researcher | 引用精确率是第一基准（DeepResearchGym 第一） | 引用体检七类 + 锚点三级追溯 + 证据链视图 | ✅ 已覆盖 |
| STORM | **视角驱动的追问**生成大纲（outline-first） | 大纲先行 + 反从众大纲变体（contrarian variants） | ✅ 同型不同源 |
| DeerFlow | 计划可视 + 长时程状态（durable state） | 任务清单工具 + SqliteSaver 断点续跑 + agent_step 轨迹 | ✅ 已覆盖 |
| PaperQA2 | 引用必须绑定原文段落位置 | 证据锚点 → 引用 → 参考文献三级追溯，断链点名 | ✅ 已覆盖 |
| local-deep-research | 本地优先（Ollama/LM Studio）零云依赖 | node-llama-cpp 本地推理 + 免 Key 检索源 + 真实性探针 | ✅ 已覆盖 |
| Feynman | 审核主张而非只读论文 | 完整性检测（宣称实证但无实验→标红）+ 客观检查器 | ✅ 已覆盖 |
| Onyx/Khoj | 企业级 UI 打磨（搜索、快捷指令） | 品牌体系 + 命令面板 ⌘K + 快捷导航条 | ✅ 已覆盖 |
| SurfSense | 知识工作台（web+资料一体） | 知识库 RAG + 文献 + 文档同仓 | ✅ 已覆盖 |
| AutoGen | 多 agent 角色协作 | **不做**：评审/起草用 LangGraph 节点角色实现，避免多进程编排复杂度（§2 同理由） | ⚖️ 登记为非目标 |
| Khoj/Onyx | OpenTelemetry 级可观测导出 | 自有 trace + token 看板；OTel 导出**未做** | 📋 登记 §6 |
| GPT-Researcher | 一键多格式导出（PDF/Docx/MD） | MD/DOCX/LaTeX/HTML 导出 | ✅ 已覆盖 |

**结论**：12 个项目的核心设计里有 9 项已在本仓有同型实现，2 项登记为非目标（多 agent 协作、
索引优先架构），2 项登记为缺口（注入检测、OTel 导出）——没有"看了介绍就算学过"的项。

### 4.1 第二轮深度对标（2026-11-06，WebSearch 逐项核证）

在 11-04 首轮 12 项基础上，本轮新增调研 4 个 2025-2026 项目（来源：arXiv / GitHub / 官方博客，
检索日期 2026-11-06），共 16 项；本轮融合清单只收「与本仓定位一致 + 可落地」的项：

| 来源项目 | 本轮学到什么 | 落地情况 |
|---|---|---|
| CycleResearcher/CycleReviewer (ICLR 2025, arXiv:2411.00816) | review→revision 循环要落到**数据形态**：审稿意见结构化为逐条修改项 | ✅ `buildRevisionPlan` + `reflexion_log` 回链（缺口 #3 第一环） |
| AI Scientist-v2 (Sakana, arXiv:2504.08066) | VLM 图表评审回炉——需要视觉模型，超出当前范围 | ⚖️ 登记为非目标（无 VLM 依赖策略） |
| AI-Researcher (HKUDS, arXiv:2505.18705) | 端到端 idea→实验→写作全自动；本仓定位是「人主导、AI 打磨」的科研工作台 | ⚖️ 定位不同，不采纳全自动写稿 |
| OpenDraft (federicodeponte) | 19 个专职 agent 的分工编排 | ⚖️ 多 agent 编排维持非目标（§2 同理由） |
| GPT-Researcher（第二轮复核） | criteria-based 结果校验 agent | ✅ 质量门七维确定性规则已覆盖 |
| PaperQA2（第二轮复核） | 引用必须绑定原文段落 + 引用支持性验证 | ✅ 锚点→citation→reference 三级追溯已覆盖 |
| STORM/Co-STORM（第二轮复核） | 视角驱动追问生成大纲 | ✅ 大纲先行 + 反共识变体同型 |
| OpenTelemetry GenAI 语义约定（semconv-genai） | `gen_ai.*` 属性命名与 OTLP/JSON uint64 字符串线格式 | ✅ otel-export 模块按约定实现（缺口 #2 闭环） |
| OWASP LLM Prompt Injection Cheat Sheet / Microsoft Spotlighting | 消毒=剥离+标记+报告，不是过滤删除 | ✅ prompt-injection 模块实现（缺口 #1 闭环） |

**结论**：本轮 4 个新项目里 1 项落地（评审闭环数据形态）、3 项登记为非目标/定位外；
两大缺口（注入消毒、OTel 导出）本轮全部闭环，缺口清单只剩 #3 的自动执行部分。

## 5. 企业级发布面

| 项 | 状态 |
|---|---|
| 语义化版本 + tag | v1.5.0 → v1.10.0 全程注释 tag，RELEASE.md 流程 |
| Keep-a-Changelog | 每版归档，用户视角措辞 |
| CI（lint/test/回归/巡检） | `.github/workflows` 已有；**桌面安装包 CI 本次新增** |
| Windows exe 安装包 | 本机无 VS 工具链 → `desktop-installer.yml`：tag 触发 windows runner 构建 NSIS 安装包并附 Release，每次运行可下 artifact |
| 五仓镜像 | gitcode / gitee / github-x33834 / github-morningstar / github-badhope，PR-受保护仓走 squash 合并（GitHub 会签名） |
| 安全 | dependabot 周更（`.github/dependabot.yml`，2026-11-06 起有配置支撑）、SECRET 扫描 workflow、出站守卫、审计表只追加 |

## 6. 登记的缺口（诚实清单，按优先级）

1. **提示注入专项检测**：~~外源网页/文献摘要进入上下文前无专门消毒层~~ **已闭环（2026-11-06）**：
   `packages/ai/prompt-injection`（剥离+中和+六类信号检测+spotlighting 包裹），接线
   `summarizeLiterature` / `replyReview` / chat 联网上下文，17 条单测。
2. **OTel trace 导出**：~~自有轨迹已在库，缺标准导出~~ **已闭环（2026-11-06）**：
   `apps/server/src/agent/otel-export.ts` + `OtelExportService`，OTLP/HTTP-JSON + GenAI 语义属性，
   `POST /api/agent/otel/export`，未配置 endpoint 时零开销关闭。12 条单测。
3. **评审意见闭环 / 段落级恢复**：**第一环已落地（2026-11-06）**——回复信 + 结构化修改计划
   （`buildRevisionPlan`）+ `reflexion_log` 回链（传 `taskId`）；自动执行修改任务（意见→自动重写
   对应章节→质量门复检）仍是路线图 Partial 项，维持登记。

## 6.1 待核实项闭环（2026-11-04）

| 原 `[待核实]` 项 | 结论 | 验证方式 |
|---|---|---|
| MCP SDK 1.32.x 对 2026-07 stateless 规范的适配 | **已闭环：适配正常**。`scripts/mcp-handshake.mjs`（官方 SDK 客户端）对 `/api/mcp/rpc` 走通 initialize → tools/list（23 工具）→ tools/call → resources/list → resources/read，5/5 通过 | `BASE=… node scripts/mcp-handshake.mjs`，已纳入回归常跑清单 |
| Electron 44（ABI 149）预编译镜像同步 | **未同步**（镜像最高 ABI 146 = Electron 42）。当前钉 42.11.18 是正确决策；升 44 前以同命令复查 | `curl registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/` 过滤 electron-v149 |
| desktop-installer CI 首跑 | **已闭环：端到端成功**。Run 1 失败（产物目录写错 dist）→ Run 2/3 修正后收集仍失败（收集步骤 `|| true` 吞错）→ 加硬失败与诊断输出后 Run 4 全绿：打包 ✓ 收集 ✓ 上传 ✓，artifact `sciflow-windows-installer`（541MB）。CI 出 exe 链路可用 | GitHub Actions runs #1–#4 + artifact API |

## 7. 变更记录（本文所述动作的落点）

- `apps/server/src/agent/agent-tool-bridge.ts`：重复调用护栏 + `agent-tool-repeat.spec.ts`（3 测试）
- `packages/ai/src/ai-transport.service.ts`：`AI_MODEL_FALLBACK` 降级链（非流式）
- `.github/workflows/desktop-installer.yml`：Windows 安装包 CI
- 本文档
## 2026-11-22 Agent harness 二轮补课

本轮把工具循环按 OpenCode 当前的 harness 行为重新过了一遍，重点看大输出、
重试、取消、并发、轨迹和 MCP 注解；同时复查“能复用却手写”的位置。范围只收
工具层，不新开产品页面。

本轮闭环：

| 缺口 | 改动 |
|---|---|
| 超大工具结果原样进入模型上下文 | 单结果默认 20,000 字上限，保留头 70% + 尾 30%；完整内容写入权限 0600 的临时文件，模型用 `read_tool_output` 分页回读 |
| 单轮没有总输出预算 | 新增 `AGENT_TOOL_OUTPUT_TOTAL_CHARS`（默认 160,000）；耗尽后返回可读停止原因 |
| 瞬时失败直接失败 | 只读工具用 `p-retry` 指数退避重试；写工具永不自动重试，避免重复副作用 |
| 工具执行忽略模型取消信号 | AI SDK 的 `ToolExecutionOptions.abortSignal` 透传到桥层；超时改用 `AbortSignal.timeout` + `AbortSignal.any` |
| 并行工具无上限 | `p-limit` + `AGENT_TOOL_CONCURRENCY`（默认 3） |
| 成功的工具输出不进轨迹 | `agent_step.output` 现在保存 2,000 字成功预览；MCP 工具与 `read_tool_output`、`tool_search` 都落轨迹 |
| MCP 客户端无法区分只读/破坏性工具 | `tools/list` 补 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` |
| SSE 已发 `[DONE]` 但 forwarder 提前 cancel | 继续读到上游 EOF 才收尾；异常标 error，用户中止标 cancelled，驾驶舱显示“已中止” |

复用判断：

- 并发与重试直接用 `p-limit` / `p-retry`，没有自己写信号量或退避器。
- 参数校验仍走 `zod.fromJSONSchema`，没有第二套 schema 转换器。
- 超时和取消用平台 `AbortSignal`，没有自建定时器注册表。
- 容错 JSON 仍只保留 `jsonrepair` 一个入口。
- chat run 的真实 usage 回写 `agent_execution.total_tokens`，不再固定为 0。

仍然欠着，按优先级：

1. `packages/db/src/database.ts` 还是命令式 `ensureColumn` 迁移。带校验和、可回滚的迁移账本是当前最大的运维债。
2. 启用技能的正文仍一次性注入（上限 8,000 字）。改成 `skill` 工具按需加载，才和 OpenCode 的渐进披露对齐，也能缩短基础提示词。
3. 没有 `task` 子智能体、会话级 undo/checkpoint、后台会话执行器。这三项是与 OpenCode 的真实差距，但没有产品口径前硬加，会让 UI 解释成本大于收益。
4. MCP prompts 尚未暴露；tools 和 resources 已暴露。
5. Vite 仍有大 chunk 警告（`WritingEditor`、`elk`）。

不算债的部分：

- 二维 PCA 投影只有约 60 行，引入 UMAP/t-SNE 会让桌面包体明显变大。
- Passage 合并是科研检索的领域逻辑，不是通用库能直接替的轮子。

## 2026-11-23 AI 通用能力融合（22 项收口）

本轮执行《SciFlow 通用 AI 能力融合实施计划》的 A1-A9、B1-B6、C1-C7，共 22 项。
硬边界未动：没有新增产品页面，一级导航仍是 9 个入口；唯一新增的后端 Nest 模块是聚合搜索
`SearchModule`，其余能力全部扩展现有模块。

| 组 | 落地结果 |
|---|---|
| A1 会话 | 会话 CRUD、全文搜索、置顶/归档落服务端；`chat_session` 迁移与 E2E 覆盖 |
| A2 分支 | 消息树 `id/parentId`、`activeLeafId`、编辑/重新生成分支、版本切换；`branch_json` 落库 |
| A3 文件理解 | 统一 `FileExtractService`：PDF/OCR、DOCX、XLSX、PPTX、EPUB、图片 OCR、音频转写、视频抽音轨；聊天附件与知识库共用 |
| A4 搜索 | `SearchModule` 聚合文档/会话/项目/实验/文献/知识库，`GET /api/search` 单次返回分组结果；⌘K 与 `?q/?focus/?session` 深链消费 |
| A5 自动化 | 时间/事件触发器、阈值、站内信/浏览器/飞书通知、幂等去重、重试、最近运行状态；Croner 调度 |
| A6 输出 | Playwright `printToPDF` 导出、演示模板、对话工具产物落文档/项目、回答存为文档 |
| A7 分享 | 文档/对话快照分享、过期时间、只读匿名评论、作者删除；对话快照脱敏 |
| A8 提示词 | 扩展 manifest 区分 `tool/chat` scope；聊天模板进入 slash 菜单，`/api/extensions/chat-prompts` |
| A9 连接器 | 国内优先目录：Zotero + 飞书，加密凭据、测试/导入/通知/Webhook；Notion/Drive/Overleaf 已移除 |
| B1 输入区 | 工作台与写作页共用 `ChatComposer`，删除两套重复附件/slash/停止逻辑 |
| B2 收件箱 | AgentOps 自动化卡片展示任务、审批、通知；统一 `useAgentInbox` 查询键与轮询 |
| B3 证据库 | 知识库 Tab 直接导入 Office/EPUB/音视频，`?q=` 过滤，不新增文件库 |
| B4 写作页 | PDF/PPTX 导出、模板选择器复用 A6，模板切换不覆盖正文 |
| B5 设置 | 连接器进“扩展与工具”，数据导出/清理进“用量与审计”，设置仍 9 组 |
| B6 模板字段 | 删除未使用的 `project.templates` 与 DTO；v19 迁移删列；模板统一由 `outline-templates` 提供 |
| C1 PWA | 手写 `sw.js` 换成 `vite-plugin-pwa`，`navigateFallback`、`cleanupOutdatedCaches`、`/api` 排除缓存 |
| C2 定时 | Croner 解析/计算 nextRun，保留 DB 持久化与扫描器 |
| C3 Office | `officeparser + mammoth + exceljs`，不手写 OOXML 解包 |
| C4 OCR | `tesseract.js` 懒加载 `chi_sim+eng`，页数/像素上限，失败可降级 |
| C5 PDF | Playwright `printToPDF`，A4、页边距、表头重复、公式、参考文献悬挂缩进 |
| C6 XLSX | 导出从 SheetJS `xlsx` 换成 `exceljs`，三张 sheet 读回校验 |
| C7 保留清单 | CodeMirror 6、Recharts、Streamdown/remark/rehype/KaTeX、unpdf、pptxgenjs/docx 保留；`cmdk` 不引入 |

### C7 保留清单（禁止为换而换）

| 依赖 | 用途 | 决策 |
|---|---|---|
| CodeMirror 6 | 写作编辑器 | 保留；现有扩展与主题已稳定 |
| Recharts | 图表 | 保留；统一走 `components/charts.tsx` |
| Streamdown / remark / rehype / KaTeX | Markdown 与公式渲染 | 保留；与聊天流式输出耦合 |
| unpdf | PDF 文本抽取 | 保留；OCR 只做扫描件兜底 |
| pptxgenjs / docx | PPTX/DOCX 导出 | 保留；导出结构与现有模板一致 |
| `cmdk` | 命令面板 | 不引入；现有面板与权限、路由深度耦合，重写收益低 |

只有出现明确维护或安全问题时才替换上述依赖；不为“看起来更生态”重写。

### 验收与诚实边界

- 全量门禁：server/web 单测、lint、typecheck、build、首屏 chunk budget、OpenAPI 生成。
- 真实样本：图片 OCR、扫描 PDF OCR、真实 mp4 抽音轨转写、DOCX 表格、EPUB、XLSX 多 sheet。
- 已真实通过：Zotero 公开 Web API 读取/导入、飞书 OpenAPI 消息发送。
- 未闭环：群内真实自定义机器人 Webhook URL（飞书只在群设置 UI 提供创建入口，OpenAPI 不支持）、PWA 真机安装与更新旧缓存。
  Notion、Google Drive、Overleaf 已按国内优先策略移除，不再保留“待凭据”占位。
- 真实音频在模型端点没有 `/audio/transcriptions` 时，走本地 `faster-whisper` 兜底（`scripts/local-transcribe.py`）。
- 产品口径：路线图“不做协作 UI”按“不新增页面、公开分享 + 只读评论优先、团队协作后置”执行。
