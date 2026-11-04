# 生态对标与真实性审计（2026-11-04）

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
| 技能渐进披露（Anthropic/Google 2026 方向） | 扩展中心 87 条资产 + 技能开关真实裁剪工具面 | 已有 |
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

## 5. 企业级发布面

| 项 | 状态 |
|---|---|
| 语义化版本 + tag | v1.5.0 → v1.10.0 全程注释 tag，RELEASE.md 流程 |
| Keep-a-Changelog | 每版归档，用户视角措辞 |
| CI（lint/test/回归/巡检） | `.github/workflows` 已有；**桌面安装包 CI 本次新增** |
| Windows exe 安装包 | 本机无 VS 工具链 → `desktop-installer.yml`：tag 触发 windows runner 构建 NSIS 安装包并附 Release，每次运行可下 artifact |
| 五仓镜像 | gitcode / gitee / github×3，PR-受保护仓走 squash 合并（GitHub 会签名） |
| 安全 | dependabot 周更、SECRET 扫描 workflow、出站守卫、审计表只追加 |

## 6. 登记的缺口（诚实清单，按优先级）

1. **提示注入专项检测**：外源网页/文献摘要进入上下文前无专门消毒层（概率中/影响高）。
   方向：外源内容包裹 + 指令特征过滤，放 `packages/ai/prompt-augmentation` 旁。
2. **OTel trace 导出**：自有轨迹已在库，缺标准导出（概率低/影响中）。方向：OTLP exporter 挂 agent-trace.service。
3. **评审意见闭环 / 段落级恢复**：路线图既有项，维持 Partial 标注。

## 6.1 待核实项闭环（2026-11-04）

| 原 `[待核实]` 项 | 结论 | 验证方式 |
|---|---|---|
| MCP SDK 1.32.x 对 2026-07 stateless 规范的适配 | **已闭环：适配正常**。`scripts/mcp-handshake.mjs`（官方 SDK 客户端）对 `/api/mcp/rpc` 走通 initialize → tools/list（23 工具）→ tools/call → resources/list → resources/read，5/5 通过 | `BASE=… node scripts/mcp-handshake.mjs`，已纳入回归常跑清单 |
| Electron 44（ABI 149）预编译镜像同步 | **未同步**（镜像最高 ABI 146 = Electron 42）。当前钉 42.11.18 是正确决策；升 44 前以同命令复查 | `curl registry.npmmirror.com/-/binary/better-sqlite3/v12.11.1/` 过滤 electron-v149 |
| desktop-installer CI 首跑 | **首跑失败但打包成功**：electron-builder 在 runner 上完成 NSIS 打包，仅「收集产物」步骤用了错误目录（`dist`，实际 `release/`）→ 已修正工作流并重新 dispatch | GitHub Actions run 41698278507 步骤表 |

## 7. 变更记录（本文所述动作的落点）

- `apps/server/src/agent/agent-tool-bridge.ts`：重复调用护栏 + `agent-tool-repeat.spec.ts`（3 测试）
- `packages/ai/src/ai-transport.service.ts`：`AI_MODEL_FALLBACK` 降级链（非流式）
- `.github/workflows/desktop-installer.yml`：Windows 安装包 CI
- 本文档
