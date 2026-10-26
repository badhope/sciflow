# 仓库级 Agent 指令（对任何在本仓库工作的 AI 会话生效）

## 第一优先：防重复造轮子

1. **动手写任何代码前，先读 `ARCHITECTURE.md`**——它是本仓库唯一真理源。
2. 特别强制：`ARCHITECTURE.md` **§7 禁止重复造轮子守则**（手搓→成熟件对照表）与 **§2 依赖地图**（已采用/已拒绝/观察名单，全部 npm 实查版本）。
3. 你正要写"基建感"代码（调 LLM、抠 JSON、流式解析、状态机、图表、表格、分块、PDF、CLI 解析、日志、mock）时，先查 §7 表格——命中即用指定成熟件，**禁止自造**。
4. 新装包必须三查（npm 活跃度 / 体积 / 许可证）并回写 §2 地图；装 §2.5 拒绝清单里的包需要用户显式批准。
5. §2.4 所列**已有依赖**（citation-js、docx、better-sqlite3+FTS5+vec0、node-llama-cpp、p-retry/p-limit、zod、recharts 等）是已定案选型，禁止替换、绕过或重写。

## 第二优先：架构纪律

6. 流水线/编排只允许经 `graph/`（LangGraph）实现；禁止在 service 里内联闭包编排、禁止用抛异常做人工确认控制流。
7. 模型调用只允许经 `ai/`（AI SDK 封装）；结构化输出用 `generateObject` + zod，禁止手写 JSON 抠取。
8. 完成任何影响架构/接口/数据模型/依赖的改动，**立即回写 `ARCHITECTURE.md`**（§0 基线、§2 地图、§4 结构图、§5 进度、§8 待办）。
9. P0 前置项清单见 §8，接手任务时先核销其中已完成的项。

## 本仓库工作流约定

- 遵循用户全局 AGENTS.md 全部纪律（最小改动、做完必验证、不主动 commit、诚实反幻觉）。
- 涉及代码改动前走 `aqg-code-construction` 六步；触及鉴权/加密/数据模型/CI 的按 deep 处理。
- 分阶段推进以 ARCHITECTURE.md §5 为准，每阶段验收门通过才算完成，禁止跳期（P0→P1→P2 串行）。

## 第一优先（v0.6 新增契约，违反即回归）

1. **布局只在骨架层定义**：页面不得自行决定分栏/断点/溢出策略。用 `components/AppShell.tsx`；
   `min-w-0` 只出现在骨架。历史事故：写作页五栏挤一行，1024px 下编辑器被压到 2px。
2. **图表不接受高度参数**：`components/charts.tsx` 的 `HBar` 内部自适应，禁止传 `height`/`barHeight`
   （这两个参数造成过两次事故）。颜色一律用 `--viz-series-*` / `--foreground` / `--border`，禁止写死 hex。
3. **错误只翻译一次**：`api/core.ts` 的 `request()` 抛 `ApiError`；页面只 catch，不拼文案。
   业务错误（含中文）原样透传，只有真正的网络失败才提示"无法连接服务器"。
   历史事故：字符类正则误判，74/87 条后端中文错误被覆盖成网络错误。
4. **流式回调参数是累积值**：`onDelta`/`onReasoning` 必须用 `api/stream-accumulator.ts` 的 `applyStreamDelta`
   覆盖，禁止字符串追加。历史事故：工作台输出平方膨胀。
5. **步骤清单单一来源**：`packages/core/src/pipeline-steps.ts`。新增步骤必须声明 `configurable` 与 `uiStep`；
   graph 的 `stepEnabled` 只接受注册过的 key（未注册会 warn 并放行）。
6. **流水线写正文必须走 `writeDocumentContent`**（`pipeline.graph.ts`），它负责版本递增与快照。
7. **引用契约**：正文只放 `[n]` 锚点；参考文献列表由前端按 CSL 样式渲染，服务端不内嵌列表。
8. **Agent 工具**：新增 MCP 工具会自动进入 `AgentToolBridge`（受 `AGENT_TOOLS_ALLOW` 白名单约束）。
   工具调用有次数上限与超时，轨迹落 `llm_call_log`（`caller=tool:*`）。
9. **`@Public()` 白名单**：只允许 `auth.controller.ts`（登录/注册）与 `health.controller.ts`（探活）。
   其余 controller 一律不得标注；`apps/server/src/auth/auth-surface.spec.ts` 会扫描全目录并红。
   历史事故：agent-trace 类级 `@UseGuards` 配方法级 `@Public()`，企业模式下轨迹与 token 用量完全裸奔。
10. **数值型环境变量必须走 `envInt`/`envFloat`**（`packages/core/src/env.ts`），禁止 `Number(process.env.X)`。
    非法值必须回落默认并夹取区间；NaN 穿透会让 `pLimit()` 失去并发闸门、`setTimeout()` 变成 0。
11. **列表型 UI 不得直接渲染原始 JSON**：流水线步骤明细用 `PipelineDag.summarizeStepOutput`。
    历史事故：大纲 JSON 把 DAG 行高撑成多行并在窄列横向溢出。
   部分网关流式不支持标准 tool_calls，传输层会回退到非流式工具循环（`AI_TOOLS_NONSTREAM=off` 可关闭）。
12. **配置中心单一写入口（v1.3 契约）**：角色/约束/钩子/权限/审计只经 `apps/server/src/config/config-center.service.ts`；
    Web 设置页、`sciflow config` CLI、对话工具 `config.*` 三条入口共用，禁止各自直写 `app_setting` 或 `config_*` 表。
    约束与 prompt_inject 钩子的唯一注入点是 `packages/ai/src/prompt-augmentation.ts`（AI 层四个 LLM 入口统一调用）；
    权限档升档每次最多一级、核心保护项（鉴权/密钥/SSRF/审计/数据库/端口/不可逆）任何档位不可改；
    `config_audit` 有只追加触发器，禁止 UPDATE/DELETE。细则见 `ARCHITECTURE.md` §2.17。
13. **扩展中心单一写入口（v1.4 契约）**：六类资产（skill/mcp/role/constraint/hook/prompt）只经
    `apps/server/src/extensions/extensions.service.ts` 写入；内置目录在 `extension-catalog.ts`，随仓库发布且默认启用。
    启用/停用必须同步投影到对应子系统（`project*`），禁止只改 `extension_asset` 不投影；
    `visibility=private` 的 SciFlow 私有优势工具不得进入导出包与外部 MCP `extension.list`；
    提示词模板默认不覆盖系统默认，必须显式「应用」。细则见 `ARCHITECTURE.md` §2.18。

## 验证纪律

- 回归脚本必须用**全新数据库**：脏库会让指纹去重、字段唯一性等用例误报失败。
- 修改契约（如引用渲染方式）时，必须同步更新 `scripts/full_regression.py` 里对应断言，
  并在 `docs/RUNTIME-FINDINGS.md` 记录「为什么改」。不允许只让测试变绿而不说明契约变化。
