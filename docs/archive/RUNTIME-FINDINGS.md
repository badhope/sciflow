# SciFlow 实测缺陷与修复记录

> 基线：GitCode `badhope/sciflow` @ `c490054`（v0.5.0）
> 本文档记录：**实测发现的缺陷 → 根因 → 修复方式 → 验证结果**。
> 静态阅读能看出但未复现的推论不在此列。

---

## 0. 本轮结果总览

| 项目 | 修复前 | 修复后 |
|---|---|---|
| 全量回归 `full_regression.py` | 历史 PASS 165 / FAIL 0 | **PASS 238 / FAIL 0**（当前 v1.9.5 契约；断言按新引用与质量门契约更新） |
| web 单测 | 22 / 22 | **42 / 42**（新增流式行为/社区检测等） |
| server 单测 | 16 / 16 | **54 / 54**（新增引用顺序/尾部块/引用渲染/投影/契约共 38 条） |
| typecheck（双端） | 0 error | **0 error** |
| eslint | 0 error / 1 warning | **0 error / 1 warning**（库级已知） |
| 用户可见缺陷（实测） | 12 项 | **12 项全部修复并复测** |
| 审计发现的回归 | — | **13 项全部修复并复测** |
| Agent 工具调用 | 从未触发（0 次） | **单轮 5 次工具调用，答案引用真实检索结果** |
| 写作页 1024px 编辑器宽度 | **2px**（完全消失） | **387px** |
| 上传 140KB 文档 | HTTP **500** | HTTP **201** |

---

## 1. 缺陷清单与修复

### D1 · 工作台流式回答平方膨胀（P0）

**复现**：工作台发消息，输出变成 `这是本地 mock AI这是本地 mock AI 网关的确定性回复：已收这是本地…`

**根因**：`core.ts` 的 `onDelta` 回调参数是**累积全文**（`full += delta; onDelta(full)`），
`ChatPage`/`ChatPanel` 用赋值（正确），`WorkspacePage.tsx:144` 却写成 `content + d`（追加累积值）。

**修复**：
- 新增 `apps/web/src/api/stream-accumulator.ts`：把「累积值 → 赋值覆盖」的语义抽成纯函数 `applyStreamDelta`。
- `WorkspacePage` 改用它；`ChatPage`/`ChatPanel` 保持赋值语义。
- 新增 `stream-accumulator.test.ts`（5 条）：含一条「若误按增量追加会得到膨胀文本」的对照断言。

**验证**：实测输出为完整单句（112 字），无重复片段。

---

### D2 · 74/87 条业务错误被改写为「无法连接服务器」（P0）

**复现**：质量页对空文档点评分 → 页面显示「无法连接服务器」，抓包显示后端返回
`400 {"message":"文档内容过短，暂无法评分（至少 50 字）"}`。

**根因**：`core.ts:98` 用**字符类** `/[请求服务网络未授权没有操作]/` 判断是否透传，
只匹配首字符。`friendlyError` 已生成中文文案，却在同一函数的 catch 里被覆盖。

**修复**：
- 重写 `request()`：拆成「传输层（fetch）」与「错误翻译层（friendlyError）」两段。
- 新增 `ApiError`（携带 `status` + `translated` 标记）与 `isNetworkError()`。
- SSE 路径 `streamChat` 同步修复（原来也有同样的字符类问题）。
- 顺手修掉 SSE 解析的另一个 bug：坏行会触发 `onError` 并中断整个流（注释说「忽略坏行」但代码不是）。

**验证**：
- 实测页面显示「文档内容过短，暂无法评分（至少 50 字）」。
- 新增 2 条 msw 测试：一条挑首字不在旧白名单的中文错误，一条验证网络失败提示。

---

### D3 · 质量雷达图恒等于满分外圈（P1）

**根因**：`QualityPage.tsx:33` 数据多边形写死 `poly(100)`，只有顶点圆点用真实分数。
实测 87 分文档的数据多边形与满值网格 `points` 属性**逐字节相同**。

**修复**：改用 `QUALITY_DIMS.map((_,i)=>pt(i,value(i)))` 构造真实多边形；
同时把网格/轴线颜色改主题变量（原来写死 `#e2e8f0`，深色主题下几乎不可见），补 `<desc>` 无障碍描述。

---

### D4 · 分章起草开关是死开关 / 自动配图开关不可达（P1）

**根因**：步骤清单存在四份（`pipeline.service`、`customization.service`、`PipelinePage`、graph 里硬编码的
`stepEnabled` 调用），互不一致：UI 能关 `drafting` 但 graph 从不读；graph 读 `figures` 但 UI 清单里没有。

**修复**：
- 新增 `packages/core/src/pipeline-steps.ts`：步骤定义单一来源（key/label/core/configurable/uiStep）。
- server（`pipeline.service`、`customization.service`）与 web（`PipelinePage`）全部改用它。
- graph 真正响应 `drafting`：关闭时跳过 LLM 起草，直接用现有正文进入评审。
- `stepEnabled` 对未注册 key 打 warn 并放行（不再静默失效）。

**验证**：`POST /customization/pipeline-steps/drafting {"enabled":0}` 现在会真正影响流程；
`figures` 出现在设置页清单中。

---

### D5 · 写作页 1024–1440px 布局崩坏（P1）

**实测**（修复前）：

| 宽度 | 现象 |
|---|---|
| 1440px | 4 个折叠面板被压到 39px，文字竖排 |
| 1024px | **编辑器宽度 2px，完全消失** |
| 390px | 反而正常（走 mobile 分支） |

**根因**：五栏挤在同一 flex 行（大纲 240 + ChatPanel 288 + 编辑器 + AI 工具 288），
只有两级断点，且 `min-w-0` 散落在各页面而非骨架层。

**修复**：
- 新增 `AppShell` 组件（`components/AppShell.tsx`）：把侧栏/工具栏/滚动/断点策略收敛到一处，
  窄屏自动变抽屉。`App.tsx` 改用它。
- 写作页重构为「编辑器主区 + 底部 Tab（大纲/引用/AI 工具）+ AI 助手抽屉」，
  原有 440 行内联 AI 工具面板抽成 `WritingToolsPanel.tsx`。
- `WritingEditor` 修 CodeMirror 高度（绝对定位铺满容器，父级 flex 高度不确定时 `height:100%` 会塌成一行）。

**实测修复后**：

| 宽度 | 编辑器 |
|---|---|
| 1920px | 835×573 |
| 1440px | 595×573 |
| 1280px | 515×573 |
| 1024px | 387×573 |
| 390px | 372×581 |

所有宽度下 `squeezed=0`（无面板被压扁），溢出元素全部位于横向滚动容器内。

---

### D6 · 流水线页同一任务渲染两遍 + 进度环文字不可见（P2）

**修复**：
- 删掉重复的线性时间线（439 行），只保留 DAG + 「当前步骤详情」。
- 进度环 label 从「① 主题验证」这类长文本改为百分比数字，步骤名移到右侧。
- 进度环/图表文字颜色从写死 `rgba(255,255,255,*)` 改为主题变量（浅色主题下原来是白字白底，等于隐形）。

---

### D7 · HBar 三条数据丢标签（P2）

**实测**：DOM 探针显示 `height=100`，只渲染出 2 个类别标签，第三条被裁。

**根因**：`resolvedHeight = 条目数 × (厚度+10) + 16` 没有给 X 轴刻度区留空间。

**修复**：重写 `charts.tsx`：
- HBar 高度完全内部自适应（行高 30 + 轴区 26 + 上边距 6），**调用方不再能传 `height`/`barHeight`**——
  这两个参数正是历史上两次事故的来源。
- 所有颜色改主题变量（`--viz-series-*` / `--foreground` / `--border`）。
- 回归测试改为断言「高度随条目数线性增长，每条至少 30px」。

**验证**：3 条数据时高度 122px，三个标签全部可见。

---

### D8 · 上传 >100KB 返回 500（P1）

**实测**（二分）：97KB → 201，107KB → **500**。PDF 走 base64，**75KB 的 PDF 就会触发**。

**根因**：`main.ts` 未配置 body parser，Nest 走 Express 默认 100kb；
超限的 `PayloadTooLargeError` 不是 HttpException，被全局过滤器兜成 500。

**修复**：
- `main.ts`：`app.useBodyParser('json', { limit: '64mb' })`，与 nginx 的 `client_max_body_size 64m` 对齐。
- `http-exception.filter.ts`：识别 `entity.too.large` / 413 → 返回可读中文 413。
- 需要 `NestExpressApplication` 泛型才能调用 `useBodyParser`。

**验证**：140KB 上传返回 **201**。

---

### D9 · 流水线产物无版本历史（P2）

**实测**：流水线完成后 `version=1`、`versions` 归档数 0。

**根因**：graph 里直接用 `db.update(documents).set({content})`，绕过 `DocumentsService.update`。

**修复**：新增 `writeDocumentContent()`（`pipeline.graph.ts`），与 `DocumentsService.update` 同语义：
内容真变化时推历史版本并 `version+1`，上限 20 条。起草/回炉/润色/研究说明四处写入统一走它。

---

### D10 · 参考文献块重复渲染（P2）

**根因**：流水线把硬编码 GB/T 形态的列表写进正文，写作页预览又按用户选中的 CSL 样式拼一份。

**修复**：`citation-renderer.ts` 不再写参考文献列表，正文只保留 `[n]` 锚点 + 知识库命中（改名「## 研究资料」）。
列表统一由前端按当前样式渲染（数据源是 citations 表）。

**契约变更**：`full_regression.py` 两处断言同步更新为「正文含数字锚点 + citations 已落库」。

---

### D11 · README 承诺的 LaTeX/HTML 导出在 UI 中不存在（P2）

**状态**：`DocExporter.tsx` 里 `mdToLatex`/`latexDoc`/`htmlDoc`/`exportBib` 实现完整但零调用。
**处理**：本轮未接线，已从 README 的功能描述中移除，改为「Markdown / Word」（见 §4 待办）。

---

### D12 · README 启动命令失效 / .env 加载路径错（P1）

**实测**：产物是 `dist/apps/server/src/main.js`，README 写 `dist/main.js`（文件不存在）。

**修复**：
- `main.ts` 的 .env 加载改为多路径探测（cwd 的 `apps/server/.env`、`.env`，以及从 `__dirname` 逐级向上的同名路径）。
- README / 开发文档同步改为正确路径（见 §4）。

---

## 2. Agent harness 补全（本轮新增能力）

### 2.1 问题

修复前：`completeStream` 只遍历 `result.textStream`，**丢弃推理增量与工具调用**；
`pipeline_task.trace` 列全仓零写入；MCP 工具只能通过 REST/stdio 手动调用，
对话里的模型完全不知道自己有工具（实测模型回复「我没有连接到你的文献库」）。

### 2.2 修复

| 层 | 改动 |
|---|---|
| 传输层 | `completeStream` 改遍历 `result.stream`，分发 `text-delta` / `reasoning-delta` / `tool-call` / `error`；`tools?: ToolSet` 与 `stopWhen: stepCountIs(n)`（AI SDK v7 已移除 `maxSteps`，旧参数会被静默忽略） |
| SSE 层 | `sse.helper` 转发 `reasoning_content`（受 `forwardReasoning` 开关控制）与 `tool_calls` |
| 工具桥 | 新增 `AgentToolBridge`：把 11 个 MCP 工具转成 AI SDK 工具，带调用次数上限（默认 8）、单项超时（20s）、轨迹落 `llm_call_log`（`caller=tool:*`） |
| 注入点 | `ChatService.stream` 在开启且有 projectId 时注入工具集（`maxSteps=3`）；系统提示补「需要事实依据先调工具」 |
| 兼容回退 | 部分网关（实测 hcnsec 的 Qwen3.8）流式时把工具调用写成正文 `<tool_call>` 文本，只在非流式返回标准 `tool_calls` → 工具模式改走 `generateText + stopWhen` 的非流式循环，再按 SSE 契约回放 |

### 2.3 实测结果（真实模型）

```
[1] project 201
[2] seeded unique reference
[3] chat 201  图神经网络（Graph Neural Network, GNN）是一类用于处理图结构数据的神经网络…
[4] stream 201 text=840ch tool_calls=5 (61s)
    reply: 已查到。你的本地文献库中关于斑马鱼电压成像的文献，去重后只有 1 条：
           | 标题 | Zebrafish Optogenetics Voltage Imaging Protocol |
           | 作者 | Alice Zhang |  年份 | 2024 |  期刊 | Nature Methods |
[5] tool trace rows: 1 ["tool:literature.search(5)"]
```

模型自主调用工具 5 次，答案引用了真实检索到的文献元数据——**这是修复前完全做不到的**。

---

## 3. 专家审计发现的回归（本轮修复）

第一轮修复完成后，独立审计指出 13 处由本轮改动引入或遗漏的问题。逐条核实后全部修复：

| # | 问题 | 影响 | 修复 |
|---|---|---|---|
| A1 | `updatePipelineStep` 里多写了一条 `if (!enabled) throw` | **所有步骤都无法关闭**（含本轮卖点 drafting 开关），UI 必然 400 | 删除该判断，只保留 `configurable` 校验；实测禁用 drafting → 201、骨架步骤 → 400 |
| A2 | 工具模式**无条件**降级非流式 | 所有项目内对话变成"全文生成完才一次性吐出"，流式体验名存实亡 | 改为按已知问题主机清单（`AI_TOOLS_NONSTREAM_HOSTS`，默认 `hcnsec.cn`）+ 显式 env 开关；实测流式 25s vs 非流式 61s |
| A3 | 非流式回退读 `r.reasoning`（是数组） | 推理内容变成 `[object Object]`，前端判 string 失败 → 深度思考静默丢失 | 改读 `r.reasoningText` |
| A4 | 尾部保护正则不认识 `## 研究资料` | 知识库参考块被当正文送润色，AI 可能改写引文 | 抽出 `tail-blocks.ts` 单一来源，补 `研究资料`；两处重复正则合并 |
| A5 | 关闭起草时重复 render | 每轮回炉追加一份 `## 研究资料` / `## 图表`，版本历史堆重复快照 | `stripTailBlocks` 先剥尾部块再 render；drafting-off 时不重复拼 prevFigures |
| A6 | 工具无项目作用域 | A 项目的对话能检索到 B 项目文献；`knowledge.query` 必失败 | `buildToolSet(projectId)`，对声明了 projectId 的工具强制覆盖 |
| A7 | 工具计数器是单例字段 | 并发对话互相重置/抢占配额 | 计数移入 `buildToolSet` 闭包；超时改用 unref 定时器 |
| A8 | 回边指向"大纲生成" | 视觉上误导成"质量门失败回到大纲"，实际是节点内重跑 | 改为 quality-gate 节点右侧自环 |
| A9 | 遮罩样式只在 ≤900px 定义 | 桌面端打开 AI 助手抽屉时无遮罩、点外部不关闭 | 遮罩基础样式提到媒体查询外 |
| A10 | 选项目后抽屉不收起 | 窄屏遮挡主区 | `SidebarContent` 接入 `useAppShell().closeSidebar()` |
| A11 | 版本重复快照 | 续跑/重跑已有正文时 history 出现两条相同记录 | `writeDocumentContent` 加"最新快照内容相同则跳过"幂等判断 |
| A12 | citations 无 ORDER BY | 重跑/手工增删后正文 `[n]` 与列表第 n 条可能不是同一篇 | 加 `ORDER BY createdAt, id` |
| A13 | 413 文案永远写 "64mb" | `body-parser` 的 limit 是字节数（number），代码只认 string | 数字格式化为 MB，回退读 `BODY_LIMIT` |

同时清理的死代码：`PIPELINE_STEP_LABELS`（第 5 份步骤标签）、`PIPELINE_CONFIGURABLE_STEPS`、`PIPELINE_STEP_LABEL`、`.split*` CSS（无 JSX 使用）、`STATUS_STYLE.text` 及对应 CSS、`CitationRenderer` 的 `_libScore` 参数。

工程修正：
- `apps/web/vite.config.ts` 加 `@sciflow/core` 别名 + `fs.allow`，`tsconfig` 加 `paths`——
  写作页不再用 `../../../../packages/core/...` 深相对路径。
- `Dockerfile` 补 `COPY packages packages`（此前只 COPY apps，容器内 tsc 会 TS2307）。
- 前端 `streamChat` 新增 `onToolCall` 回调，消费服务端下发的 `tool_calls`（此前透传了但客户端无消费方）。

**回归**：修复后重跑 165/165 全绿，双端 typecheck / lint / build 全通过，真实模型流式工具链实测正常。

---

## 4. 设计契约（本轮新增，后续改动必须遵守）

1. **布局**：页面不得自行决定分栏与滚动。用 `AppShell` + `.split` / `.writing-layout`；
   `min-w-0` 只在骨架层出现一次。
2. **图表**：所有图表用 `components/charts.tsx`；HBar 不接受高度参数（内部自适应）。
   颜色一律走 `--viz-series-*` / `--foreground` / `--border`，禁止写死 hex。
3. **错误**：`request()` 抛 `ApiError`；页面只 catch，不再自行拼文案。
   业务错误（中文）由 `friendlyError` 原样透传，网络失败才提示「无法连接服务器」。
4. **流式**：`onDelta`/`onReasoning` 的参数是**累积值**，必须用 `applyStreamDelta` 覆盖，禁止追加。
5. **步骤清单**：唯一来源 `packages/core/src/pipeline-steps.ts`。
   新增步骤必须同时声明 `configurable` 与 `uiStep`，graph 的 `stepEnabled` 只接受注册过的 key。
6. **写正文**：流水线写文档必须走 `writeDocumentContent`（保版本）。
7. **引用**：正文只放 `[n]` 锚点；参考文献列表由前端按 CSL 样式渲染，服务端不再内嵌。

---

## 5. 待办推进（本轮完成 3 项）

| 原待办 | 状态 | 说明 |
|---|---|---|
| LaTeX / HTML 导出接线 | ✅ 完成 | `DocExporter` 接上两个按钮，走本地纯函数转换（`mdToLatex` / `mdToHtmlSync`），不依赖网络。实测导出 `.tex`（336B）与 `.html`（896B）均正常。 |
| 引用锚点双编号 | ✅ 完成 | 根因是批量插入共用同一毫秒 `createdAt`，`ORDER BY` 不稳定。改为**严格递增时间戳**（`citation-renderer` 批次内 +1ms、`addCitation` 不小于现有最大值+1），`listCitations` 补显式排序。新增 5 条回归测试并做过红绿验证（注入旧实现 → 1 条失败；恢复 → 21/21 通过）。 |
| 虚拟滚动 | ✅ 改为分批渲染 | 文献卡片高度随「筛选理由 / 阅读状态」动态变化，固定行高会裁内容，故不套用虚拟滚动。改为每批 60 条 + 显式「加载更多」，切项目自动重置。 |
| 真实模型矩阵测试 | ⏸ 阻塞 | agnes / unisound 仍返回 401，需用户确认密钥有效性。hcnsec 已实测通过。 |
| 打包体积 | ⏳ 未做 | `mermaid` 789KB / `WritingPage` 675KB，可继续按需加载。 |

额外修复：起草被禁用时不再触发自动配图（此前会产出「空正文 + 图表」的无意义产物）。

---

## 6. 技术债清算（本轮）

审计与自查发现的结构性问题，逐条处理：

| 项 | 问题 | 处理 |
|---|---|---|
| 用量统计被工具污染 | 工具调用与 LLM 调用共用 `llm_call_log`，无 token 的工具调用拉低平均 token、抬高调用次数 | 新增 `kind` 列（`llm`/`tool`）；用量看板只统计 `kind='llm'`，另给 `tools` 汇总（次数/失败/平均耗时/按工具分布）。实测：真实模型触发 1 次工具调用 → `usage.tools.calls=1`，`byCaller` 无 `tool:` 前缀 |
| 回归断言脆弱 | 「正文不含 `## 参考文献`」依赖模型永不写该标题，真实模型会误报 | 改为只断言「正文含数字锚点」——引用闭环的真实契约 |
| BottomTabs 可访问性 | `aria-controls` 指向不渲染的面板；无键盘漫游 | 面板 id 固定 + `aria-labelledby`；补 ←/→/Home/End 漫游与 roving tabIndex |
| ShellDrawer 无焦点管理 | 打开不聚焦、关闭不归还、Tab 可跑出抽屉 | 打开聚焦首元素、Tab 循环、Esc 关闭、关闭归还焦点 |
| AppShell 死接口 | `aside` / `noScroll` 无调用方 | 删除（需要时再加，避免空壳 API） |
| `isNetworkError` 未使用 | 定义了却没人用 | 接入项目加载失败提示：区分「后端没起」与「查询出错」 |

**验证**：165/165 回归、21+29 单测、双端 typecheck、eslint、双端 build 全通过。

---

## 7. 工程一致性收尾（本轮）

版本升级到 0.6.0 时暴露出三处「改了 dist 结构但脚本没跟」的遗留问题——它们都在同一轮 rootDir 改动时埋下：

| 位置 | 问题 | 后果 |
|---|---|---|
| `scripts/final_acceptance.py:85` | 启动路径还是 `dist/main.js` | 验收脚本自身跑不起来 |
| `scripts/final_acceptance.py:173-177` | CLI 路径 `dist/cli.js` 不存在 | F1/F2/F3 三项 CLI 验收全部失败 |
| `scripts/openapi-gen.mjs:45` | dump 脚本路径过期 | `pnpm openapi:gen` 直接报错退出 |

修复后重新生成 `openapi.json`：版本 0.4.2 → **0.6.0**，路径 111 → **114**（多出的 3 个是 0.5.0 就新增但从未重新生成的：`/references/{id}/verify-doi`、`/web/config`、`/documents/{id}/citation-audit`）。

其它一致性修正：
- 版本号全链路统一 0.6.0（root / server / web / desktop / core / db / CLI / Swagger / openapi.json）。
- README 中英文、development.md 的测试计数与回归项数同步为实际值（21 / 29 / 165）。
- `docs/deployment.md` 的启动命令与 .env 加载说明改正。
- CHANGELOG 补 0.6.0 条目；ARCHITECTURE 补 §2.10「v0.6 新增契约」。

**CLI 输出质量**：`sciflow --help` 此前会连带初始化数据库（建表 + 加载 sqlite-vec）并往 stdout 打日志。
把 `AppModule` 改为动态 import 后，纯命令行帮助不再触碰数据库，输出干净。

**验收**：`final_acceptance.py` **21/21 通过**（eslint / 双端 typecheck / 双端单测 / 双端构建 / 健康检查 / 安全头 / pino 日志 / 165 项回归 / 流水线 e2e / MCP 握手 / CLI 三项）。

---

## 8. 测试真实性审计（本轮重点）

用户指出「很多测试是假的」。逐文件核查 + **变异测试**（故意破坏产品代码，看测试是否失败）后确认：**9 个测试文件里 3 个是假测试**。

### 假测试清单（已全部重写）

| 文件 | 问题 | 证据 |
|---|---|---|
| `apps/server/src/eval/autoevals.spec.ts` | **完全不 import 任何产品代码**，只测 autoevals 库本身 | 自己拼 `'总分 87/100'`、自己写正则解析、断言等于自己写的 87；`Levenshtein({ output: mockTitle, expected: mockTitle })` 恒为 1.0 |
| `apps/web/src/pages/WorkspacePage.test.tsx` | 4 条全是「元素存在」断言，`streamChat` 被 mock 成空函数，从不触发回调 | 这正是 D1（流式平方膨胀）能躲过测试的直接原因 |
| `apps/web/src/api/client.msw.test.ts` 第 3 条 | 只 `fetch` 后断言状态码 500，**没有走 `request()`**，测不到错误翻译层 | 注释自己写着"改为直接 fetch 断言" |

### 另一个更隐蔽的问题

`apps/server/vitest.config.ts` 的 `include` 只写了 `src/**/*.spec.ts`——**`packages/` 下的测试从未被执行**。
任何写在那里的测试都是"写了等于没写"。已改为同时扫描 `../../packages/*/src/**/*.spec.ts`。

### 重写后的测试

新增/重写共 **28 条**真实用例：

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `autoevals.spec.ts` | 5 | 质量门文案从产品函数取值；mock 大纲结构与相似度 |
| `WorkspacePage.test.tsx` | 8（+4 行为） | 发送调用、流式累积、推理累积、错误呈现 |
| `client.msw.test.ts` | 5（重写 1 条） | 500 翻译走真实 `request()`，且带 status |
| `tail-blocks.spec.ts` | 10 | 尾部块识别（含本轮新增的「研究资料」） |
| `citation-renderer.spec.ts` | 8 | 编号规则、不内嵌列表、研究资料块、回填、幂等 |
| `projection.spec.ts` | 13 | PCA 聚簇可分离、确定性、边界情况 |

配套把两处硬编码抽成产品常量，避免"测试自己写一份期望值"：
- `QUALITY_GATE_LABEL()`（`pipeline.graph.ts`）
- `MOCK_OUTLINE`（`mock-gateway.ts`）

### 变异测试结果（证明测试有效）

| 注入的缺陷 | 失败用例数 |
|---|---|
| `applyStreamDelta` 改为追加（还原 D1） | 4 |
| `HBar` 高度写死 100（还原 D7） | 1 |
| `request()` 还原字符类正则（还原 D2） | 1 |
| citations 同一毫秒（还原编号错位） | 1 |
| 500 不再翻译 | 1 |
| Button loading 不再禁用 | 1 |
| 尾部块漏掉「研究资料」 | 2 |
| 引用编号改为全池编号 | 2 |
| 质量门文案改为「得分」 | 2 |

**全部 9 个测试文件现已通过变异验证**（注入 bug 必须失败）。测试总数：server 54 / web 33。

---

## 9. 路线图剩余项（F-2.2 ~ F-2.6 已完成）

### F-2.2 知识库语义地图 ✅

- **后端**：`GET /api/knowledge/:projectId/map` —— 读分块 embedding → PCA 降到 2D → 归一化。只读已有向量，**不调用嵌入模型**（无 Key 也能用）。超过 5000 块自动确定性下采样。
- **算法**：`packages/retrieval/src/projection.ts`，~60 行幂迭代 PCA（不引 umap-js：依赖重且结果有随机性，图表每次刷新会跳）。
- **前端**：`pages/knowledge/SemanticMap.tsx` 自绘 SVG 散点，按文档着色、悬停/点击看块文本、图例、下采样提示。默认折叠，展开才拉数据。
- **重叠点处理**：投影后同坐标的点做确定性环形偏移（实测 15 个点从 3 个可见位置变为 15 个）。
- **实测**：注入 3 簇共 15 个合成向量 → 接口返回 15 点、3 簇清晰分离（中心 0.00/0.50/1.00）；浏览器渲染 15 个圆点 + 3 条图例。

### 仍未做

| 项 | 状态 |
|---|---|
| F-2.3 引用网络增强（社区着色/搜索定位） | 待做 |
| F-2.4 成本仪表盘（日堆叠柱 + 预算线 + Top10） | 待做 |
| F-2.5 质量雷达多版本叠加 | 待做 |
| F-2.6 文献矩阵热力图 | 待做 |
| B-5.3 arXiv 镜像聚合 | 待做（合规红线：opt-in、不自动轮询） |

---

### F-2.3 引用网络增强 ✅

- **社区着色**：`literature/community.ts` 实现 label propagation（~40 行，不引 louvain：单图视觉分簇不需要精度）；节点颜色从「按期刊」改为「按研究社区」，社区内节点略微放大。
- **搜索定位**：左上搜索框按标题模糊匹配，点击结果把镜头对准该节点并高亮它的一跳邻域（其余节点置灰、隐藏标签）。
- **实现细节**：sigma v4 的 `nodeReducer` 是构造函数顶层选项（不在 settings 里）；`refresh` 为私有，属性改动后靠 `setSetting` 触发重绘。
- **测试**：`community.test.ts` 8 条（两个三角形分离、桥接边、孤立节点、确定性、编号连续、星形图、分组排序）。
- **实测**：切到「引用网络」后搜索框存在、WebGL canvas 渲染、图例显示「研究社区」。

### F-2.4 成本仪表盘 ✅

- **预算使用率**：进度条显示 `总消耗 / 任务预算上限`，超限转红。
- **单任务成本 Top 10**：按 `caller` 聚合 token 的横向条形，带调用次数/平均延迟/成功率提示。
- **工具调用统计**：独立展示 `kind='tool'` 的次数/失败/平均耗时与工具分布（不与模型成本混算）。
- **顺手消除类型漂移**：`platform.ts` 里重复定义的 usage 结构改为引用 `UsageSummary`，两处不再各写一份。

### F-2.5 质量雷达多版本叠加 ✅

- 默认显示「当前最新 vs 上一版」的叠加：当前版实线填充，对比版灰色虚线。
- 图例标注两版总分与对比日期；选中历史版本时自动改为「所选版本 vs 最新版本」。
- **踩坑记录**：`QualityPage` 的 `useEffect` 在加载历史后会自动把 `h[0]` 设为 `selectedHist`，导致 `report` 永远为 null。对比基准必须以 `history[0]` 判定「谁是最新」，不能依赖 `report`。

### F-2.6 文献矩阵热力图 ✅

- `literature/ExtractionHeatmap.tsx`：行=编码字段、列=文献，绿色=已填、灰色=待补录，顶部显示覆盖率。
- 悬停显示「文献标题 · 字段：值」，为后续点击补录预留 `onPick` 回调。
- 自绘 SVG（字段×文献通常 <20×100，不需要重型图表库）。

### B-5.3 arXiv 镜像聚合 ⏸ 未做

原因：涉及第三方 API 依赖与合规边界（需 opt-in、禁止启动链路依赖与自动轮询），且在无外网环境下无法真实验证。留作独立批次，避免引入未经真跑验证的网络代码。

---

## 9.5 全模块复审批次（2026-10-20 第二轮）

D1–D12 修完之后，又对全部源码做了一次模块化复审（server / web / packages / desktop / scripts），
本批次是在真实运行 + 真实截图下确认的增量缺陷，均已修复并配红绿验证的测试。

| # | 缺陷 | 触发条件 | 根因 | 修复 | 验证 |
|---|---|---|---|---|---|
| B1 | 鉴权在 AUTH_MODE=jwt 下被绕过：agent 轨迹与 token 用量对任何调用方开放 | 企业模式启动 | `agent-trace.controller.ts` 类级 `@UseGuards` 同时给三个方法标了 `@Public()`；全局守卫读到 metadata 直接放行，类级守卫形同虚设 | 移除这些 `@Public()`（保留 auth/health 两个真正的公开面）；新增 `auth-surface.spec.ts` 白名单契约 | 红绿：恢复 `@Public()` → 2 条测试红；修复后 3 条全绿 |
| B2 | 删除项目留下孤儿行 | 删除含流水线/对话的项目 | 数据库零外键，级联全靠 `ProjectsService.remove` 手写，漏了 `agent_execution` / `agent_step` / `chat_session` | 增加三段级联（step 先于 run）；新增 `projects-cascade.spec.ts` 用真实 SQLite 断言 8 张表归零 | 红绿：移除级联 → 1 条测试红 |
| B3 | 环境变量填非数字导致并发闸门失效 | `AI_RPM_CAP=abc` 等 | `Number(env)` → NaN 静默穿透到 `pLimit()` / `setTimeout()` | 新增 `packages/core/src/env.ts`（`envInt`/`envFloat`：非法值回落默认 + 区间夹取 + 一次性告警），6 处调用点替换 | 9 条单测，红绿：改回 `Number(raw)` → 5 条红 |
| B4 | 环形图唯一非零分段取到第 N 个系列色 | 4 个草稿状态里只有 1 个非零 | Recharts 为 0 值分片仍分配配色槽位 | `normalizeDonutData` 过滤零值分段；全零时不画空环而给占位 | 实拍：由紫色变品牌 teal；2 条单测，红绿有效 |
| B5 | 质量页「最需改进的维度」三根柱看似全部顶满 | 分数 84–90（都接近满分） | 未指定 `max`，Recharts 按数据最大值自适应；且配色未 token 化 | 固定 `max={100}`，配色改语义 token | 实拍：坐标轴 0–100，柱长真实反映 84/85/86 |
| B6 | 流水线 DAG 行被整段大纲 JSON 撑爆 | 大纲步骤完成 | `step.output` 是原始 JSON，直接渲染且父链缺 `overflow-hidden` | 新增 `summarizeStepOutput`（大纲→标题+章数、质量门→总分、其他→单行截断）+ `overflow-hidden` + `title` 全量提示 | 实拍：JSON 变为「…（5 章）」；6 条单测，红绿有效 |
| B7 | promptfoo 外部网关脚本必然启动失败 | 按 README 跑 `mock-openai-http.mjs` | require 路径仍是旧 dist 布局 `dist/ai/mock-gateway.js`（实际为 `dist/apps/server/src/ai/`） | 双候选路径 + 明确报错；实跑 `curl /v1/models` 返回 mock-model | 实测启动成功，promptfoo 2/2 通过 |
| B8 | 桌面打包前置检查必然报「缺少后端构建产物」 | `pnpm desktop:dist` | `prepare-server.mjs` 仍检查 `dist/main.js` | 改为 `dist/apps/server/src/main.js` | 静态核对 + 与 server-manager 入口一致 |
| B9 | `--help` 之外的 CLI 路径、验收脚本路径陈旧 | — | 旧 dist 布局残留 | 同步 CONTRIBUTING / playwright.config / e2e 注释 | grep 全仓无残留 |
| B10 | 设计 token 被引用但未定义 | 主题切换 / 指标卡图标 | `--rose-500` 等 4 个 token 在组件里用 `var()` 引用，`index.css` 从未定义，取色静默失效 | 亮/暗两套补齐；新增脚本级校验（26 used / 47 defined / 0 missing） | 全量 token 校验通过 |
| B11 | README 承诺的 GitHub Actions 三 job CI 不存在 | 打开 badge | `.github/` 只有 dependabot.yml | 新增 `.github/workflows/ci.yml`，命令与本机实测逐条对齐 | 本地逐条跑通（lint/typecheck/test/build/回归/Playwright/promptfoo） |
| B12 | 文档数字系统性失真 | 阅读文档 | Electron 38（实际 41）、测试 21/29（实际 68/50）、回归 161（实际 165）、111 路由（实际 114） | 全部按实测更新，`.env.example` 补齐 20+ 个实际可用变量 | grep 复核无残留 |

| B13 | server 单测随机红（`SqliteError: disk I/O error`） | 并行跑门禁 | 多个 vitest worker 共用 `apps/server/data/sciflow.db`；WAL 层并发写会抛错，`busy_timeout` 救不了 | `vitest.config.ts` 给每个进程分配临时库 + `fileParallelism: false`（串行） | 连跑 3 次均 68/68；此前两次复现失败 |

**B11 的边界说明**：GitHub 三个镜像仓会执行同一套 workflow；GitCode / Gitee 不提供 Actions，该文件在其上是惰性的，README 已明确这一点。

---

## 10. 复现与验收

```bash
# 依赖（Electron 会 EPERM，过滤安装）
pnpm install --frozen-lockfile --filter @sciflow/server --filter @sciflow/web --filter sciflow

# 后端（mock，无 Key 可跑）
cd apps/server && AI_MOCK=1 AI_RPM_CAP=200 PORT=3311 DATABASE_PATH=./data/run.db \
  node dist/apps/server/src/main.js

# 后端（真实模型）
AI_BASE_URL=https://api.hcnsec.cn/v1 AI_API_KEY=<key> \
AI_MODEL=Qwen3.8-Flash-Next AI_MODEL_FAST=Qwen3.8-Flash-Next AI_MODEL_STRONG=Qwen3.8-Flash-Next \
PORT=3311 DATABASE_PATH=./data/real.db node dist/apps/server/src/main.js

# 前端
VITE_API_TARGET=http://127.0.0.1:3311 pnpm --filter @sciflow/web dev --port 5311

# 门禁
pnpm --filter @sciflow/server test && pnpm --filter @sciflow/web test
pnpm --filter @sciflow/server typecheck && pnpm --filter @sciflow/web typecheck
npx eslint .
SCIFLOW_BASE=http://127.0.0.1:3311 AI_MOCK=1 python scripts/full_regression.py   # 必须全新库
```

> 回归脚本**必须用全新数据库**：脏库会让指纹去重、抽取字段唯一性等用例误报失败（本轮实测踩过一次）。
