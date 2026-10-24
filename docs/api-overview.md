# SciFlow 后端 API 概览

> 本文基于 `apps/server/src` 当前代码（HEAD `49bdff0`）整理，所有路由、方法、请求体均与实际 controller 一一对应。
> 后端为 NestJS 单体应用，统一挂在 `/api` 前缀下；默认仅监听 `127.0.0.1:3000`。

## 1. 通用约定

| 约定 | 说明 |
| --- | --- |
| 全局前缀 | 所有路由统一加 `/api`（`main.ts` 中 `app.setGlobalPrefix('api')`） |
| 数据格式 | 请求 / 响应均为 `application/json`（`GET` 除外）；少数导出类端点返回文本 / 文件流 |
| 字符编码 | UTF-8；错误文案一律中文 |
| 流式接口 | `POST /api/chat/stream` 为 **SSE**（`text/event-stream`），详见下文 |
| 输入校验 | 全局 `InputValidationPipe`：仅要求 `@Body()` 为普通 JSON 对象（拒绝数组 / 字符串），不做白名单剥字段 |
| 超时 | 前端默认 60s 兜底；nginx 反代 `proxy_read_timeout 300s` |
| 跨域 | 由 `CORS_ORIGIN` 控制，默认仅放行 `http://localhost:5173,http://127.0.0.1:5173` |

### 错误响应格式

由全局 `HttpExceptionFilter` 统一兜底，结构与 Nest 默认一致：

```json
{ "statusCode": 400, "message": "中文业务错误说明", "error": "Bad Request" }
```

- 业务错误的 `message` 为中文原样返回（前端依赖该文案直接展示），超过 300 字符截断。
- 未捕获异常只对客户端返回通用 `500 { message: "Internal server error" }`，完整堆栈仅落服务端日志，不外泄。
- 常见语义：AI 未配置时 `GET /api/settings/check` → `503`、`POST /api/pipeline` → `400`（这是预期行为，不是缺陷）。

### 认证说明

- **无任何登录 / Token 机制**。SciFlow 定位为「单用户本地工作台」，不建多租户。
- 安全边界是网络层：后端默认只绑定回环地址 `127.0.0.1`，局域网不可达。
- 确需对外暴露时显式设置 `HOST=0.0.0.0`（opt-in），此时请自行确保前置网关有鉴权。
- 因此所有 curl / 示例都**不需要**携带 `Authorization` 头。

## 2. 模块与端点总表

> 路径中的 `:id` 等为路径参数。「职责」为一句话概括。

### projects —— 项目管理（`/api/projects`）
科研项目的增删改查，是所有文档 / 文献 / 流水线的归属根。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 项目列表 |
| GET | `/api/projects/:id` | 项目详情 |
| POST | `/api/projects` | 新建项目，body `{ name, description? }` |
| PATCH | `/api/projects/:id` | 更新，body `{ name?, description?, preface?, templates? }` |
| DELETE | `/api/projects/:id` | 删除项目（级联清理其下文档/文献/流水线） |

### documents —— 文档 / 润色 / 翻译 / 引用 / 版本 / 导出（`/api/documents`）
论文正文的核心模块：大纲、分章起草、三段式润色、中英翻译、引用管理与导出。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/documents` | 列表（按 projectId 查询） |
| GET | `/api/documents/:id` | 文档详情 |
| POST | `/api/documents` | 新建，body `{ projectId, title }` |
| PATCH | `/api/documents/:id` | 保存，body `{ title?, content?, outline?, status? }` |
| PATCH | `/api/documents/:id/version-name` | 为历史版本命名 |
| DELETE | `/api/documents/:id` | 删除文档 |
| POST | `/api/documents/:id/outline` | 生成研究计划 / 章节大纲 |
| POST | `/api/documents/:id/section` | 分章起草（Agentic RAG） |
| POST | `/api/documents/:id/abstract` | 生成摘要 |
| POST | `/api/documents/:id/polish` | 学术润色 / 翻译 / 降重 |
| GET | `/api/documents/:id/polish-records` | 润色历史记录 |
| POST | `/api/documents/:id/citations` | 为文档写入引用 |
| GET | `/api/documents/:id/citations` | 文档引用列表 |
| DELETE | `/api/documents/:id/citations/:citationId` | 删除单条引用 |
| GET | `/api/documents/:id/export-citations` | 导出格式化参考文献列表 |
| POST | `/api/documents/:id/render-citations` | 按 8 种样式渲染引用 |
| GET | `/api/documents/:id/export` | 导出 Markdown / HTML / LaTeX |
| GET | `/api/documents/:id/export-docx` | 导出 Word(.docx) |

### references —— 文献库 + 综述（`/api/references`）
文献元数据管理、PRISMA 筛选、编码矩阵、引用网络、BibTeX/RIS 导入、综述分析。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/references/search` | 检索文献（写库前的服务端检索） |
| GET | `/api/references` | 文献列表 |
| GET | `/api/references/screen` | 筛选队列查询 |
| POST | `/api/references/screen` | 单条纳入 / 排除 |
| POST | `/api/references/screen/bulk` | 批量筛选 |
| GET | `/api/references/extraction/fields` | 编码字段列表 |
| POST | `/api/references/extraction/fields` | 新建编码字段 |
| DELETE | `/api/references/extraction/fields/:id` | 删除编码字段 |
| GET | `/api/references/extraction/table` | 编码矩阵（行文献 × 列字段） |
| PUT | `/api/references/extraction/values` | 写入编码取值 |
| GET | `/api/references/graph` | 引用网络数据（力导向图） |
| GET | `/api/references/export` | 导出文献库 |
| GET | `/api/references/:id` | 文献详情 |
| POST | `/api/references` | 手动新增，body `{ projectId, hit: { title, ... } }` |
| POST | `/api/references/import` | 批量导入 |
| POST | `/api/references/import-bibtex` | 导入 BibTeX 文本（指纹去重） |
| POST | `/api/references/citations` | 关联引用 |
| POST | `/api/references/verify-dois` | 校验 DOI |
| PATCH | `/api/references/:id` | 更新文献 |
| DELETE | `/api/references/:id` | 删除文献 |
| POST | `/api/references/summarize` | 文献综述小结 |
| POST | `/api/references/extract` | 元信息抽取 |
| POST | `/api/references/deep-dive` | 单篇深读 |
| POST | `/api/references/gap` | 研究空白分析 |
| POST | `/api/references/evidence` | 证据合成 |

### knowledge —— RAG 知识库（`/api/knowledge`）
NotebookLM 式本地知识库：上传资料 → 分块 → BM25+向量混合检索。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/knowledge/upload` | 上传 / 写入知识资料 |
| GET | `/api/knowledge` | 资料列表 |
| POST | `/api/knowledge/query` | 混合检索问答（带来源） |
| POST | `/api/knowledge/search` | 仅检索命中块 |
| GET | `/api/knowledge/:id` | 资料详情 |
| PATCH | `/api/knowledge/:id/bind` | 与文献双向绑定 |
| DELETE | `/api/knowledge/:id` | 删除资料（连同分块） |

### pipeline —— 全自动流水线状态机（`/api/pipeline`）
顺序流水线状态机（主题验证→文献→大纲→人工确认→起草→质量门→润色→引用）+ 断点续跑。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/pipeline` | 创建并启动一条流水线 |
| GET | `/api/pipeline` | 流水线列表 |
| GET | `/api/pipeline/:id` | 流水线详情（含步骤状态） |
| POST | `/api/pipeline/:id/confirm-outline` | 大纲人工确认点继续 |
| POST | `/api/pipeline/:id/stop` | 停止运行中的流水线（置 `cancelled`；停止后可删除） |
| DELETE | `/api/pipeline/:id` | 删除任务记录（运行中需先 stop） |

> 多智能体编排（`graph/`，LangGraph）按 ARCHITECTURE.md §5 P2 交付。

### research —— 研究设计 / 模拟评审 / 审稿意见（`/api/research`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/research/design-review` | 研究设计评审 |
| POST | `/api/research/comparison` | 论文对比 |
| POST | `/api/research/review` | 模拟审稿 |
| POST | `/api/research/review-comments` | 写入审稿意见 |
| GET | `/api/research/review-comments` | 审稿意见列表 |
| PATCH | `/api/research/review-comments/:id` | 更新审稿意见 |
| DELETE | `/api/research/review-comments/:id` | 删除审稿意见 |
| POST | `/api/research/response-letter` | 生成逐条回复信 |

### quality —— 7 维质量评分（`/api/quality`，位于 `research/` 目录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/quality` | 对文档做 7 维打分 |
| GET | `/api/quality` | 历史评分列表 |
| GET | `/api/quality/latest` | 最新一次评分 |
| POST | `/api/quality/export-comments` | 导出评分意见 |
| GET | `/api/quality/:id` | 单份评分详情 |

### submission —— 投稿辅助（`/api/submission`，位于 `research/` 目录）
选刊匹配、Cover Letter、投稿状态跟踪。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/submission/journals` | 主题选刊推荐 |
| GET | `/api/submission/journals` | 期刊库 |
| POST | `/api/submission/journals-lib` | 自建期刊 |
| DELETE | `/api/submission/journals-lib/:id` | 删除自建期刊 |
| POST | `/api/submission/journals-match` | 选刊匹配打分 |
| POST | `/api/submission/cover-letter` | 生成 Cover Letter |
| POST | `/api/submission/reply-review` | 生成修回回复 |
| POST | `/api/submission/track` | 新建投稿记录 |
| GET | `/api/submission/track` | 投稿记录列表 |
| POST | `/api/submission/track/parse-email` | 从邮件文本解析状态 |
| POST | `/api/submission/track/:id/event` | 追加一条状态流水 |
| PATCH | `/api/submission/track/:id` | 更新投稿记录 |
| DELETE | `/api/submission/track/:id` | 删除投稿记录 |

### judgment —— 意图判断 / 评审闭环（`/api/judgment`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/judgment/intent` | 判断用户意图（是否调用某能力） |

### experiments —— 实验沙箱（`/api/experiments`）
隔离 `spawn` 执行本机 Python 脚本，记录 stdout/图。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/experiments/run` | 运行 Python 脚本 |
| GET | `/api/experiments` | 实验列表 |
| GET | `/api/experiments/by-document/:documentId` | 按文档查实验 |
| GET | `/api/experiments/:id` | 实验详情 |
| PATCH | `/api/experiments/:id` | 更新（结论等） |
| DELETE | `/api/experiments/:id` | 删除实验 |

### chat —— 科研问答（`/api/chat`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/chat` | 一次性问答（JSON 返回完整答案） |
| POST | `/api/chat/stream` | **SSE 流式问答** |

**SSE 协议**（`POST /api/chat/stream`）：
- 响应头 `Content-Type: text/event-stream`。
- 正文前先推一条 RAG 来源事件：`data: {"sources": [...]}\n\n`（无命中则不发）。
- 随后按 token 增量推送正文；客户端断开（`req.on('close')`）时中止上游 fetch。
- 仅当请求体 `enableThinking: true` 时才透传推理型网关的 `reasoning_content / thinking` 增量。

### memory —— 记忆中心（`/api/memory`）
情景记忆（项目自动沉淀）+ 程序记忆（写作风格指令）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/memory` | 写入记忆 |
| GET | `/api/memory` | 记忆列表 |
| DELETE | `/api/memory/:id` | 删除记忆 |

### mcp —— MCP 工具协议化（`/api/mcp`）
把 AI 能力以标准 MCP 工具暴露，设置页可视化调用。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/mcp/info` | MCP 能力信息 |
| GET | `/api/mcp/tools` | 工具列表（含 JSON Schema） |
| POST | `/api/mcp/call` | 调用本地工具（Guardrail 校验参数） |
| GET | `/api/mcp/external` | 已配置的外部 MCP server |
| POST | `/api/mcp/external/discover` | 发现外部 server 工具 |
| POST | `/api/mcp/external/:id/call` | 调用外部工具 |

### settings —— 设置 / 模型连通自检（`/api/settings`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings` | 当前设置 |
| GET | `/api/settings/check` | 模型连通自检（未配 Key → 503） |
| POST | `/api/settings/test` | 测试一次连接 |
| GET | `/api/settings/providers` | 多厂商列表 |
| POST | `/api/settings/providers` | 新增厂商配置 |
| POST | `/api/settings/providers/:id/activate` | 激活某厂商 |
| DELETE | `/api/settings/providers/:id` | 删除厂商 |
| GET | `/api/settings/mcp-servers` | 外部 MCP server 列表 |
| POST | `/api/settings/mcp-servers` | 新增 MCP server |
| DELETE | `/api/settings/mcp-servers/:id` | 删除 MCP server |

### customization —— 个性化配置（`/api/customization`，位于 `settings/` 目录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/api/customization/intents` | 自定义意图列表 / 新建 |
| POST / DELETE | `/api/customization/intents/:id` | 更新 / 删除意图 |
| DELETE | `/api/customization/intents` | 清空自定义意图 |
| GET | `/api/customization/pipeline-steps` | 流水线步骤开关配置 |
| POST | `/api/customization/pipeline-steps/:stepKey` | 设置某步骤开关 |
| DELETE | `/api/customization/pipeline-steps` | 重置步骤配置 |
| GET / POST | `/api/customization/quality-weights` | 7 维权重读取 / 更新 |
| GET / POST | `/api/customization/judgment-mode` | 评审模式读取 / 更新 |
| GET | `/api/customization/prompts` | 自定义 prompt 列表 |
| POST / DELETE | `/api/customization/prompts/:toolKey` | 更新 / 删除某工具 prompt |

### usage —— token 成本统计（`/api/usage`，位于 `settings/` 目录）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/usage/summary` | LLM 调用 token / 成本汇总 |

### dashboard —— 工作台聚合（`/api/dashboard`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/dashboard/overview` | 项目总览聚合数据 |

### health —— 健康检查（无模块前缀）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | `{ status, time, ai: { configured, model } }` |

> `ai/` 目录不含 controller，是被各模块注入的统一 LLM 服务（OpenAI 兼容协议 + 令牌桶限流 + mock 网关）。

## 3. 调用示例（curl）

> 默认后端地址 `http://127.0.0.1:3000`，无需任何鉴权头。

```bash
# 0. 健康检查 + AI 是否已配置
curl http://127.0.0.1:3000/api/health

# 1. 新建项目
curl -X POST http://127.0.0.1:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"图神经网络综述","description":"GNN 综述写作"}'
# 返回 {"id":"<projectId>","name":"图神经网络综述", ...}，记下 id

# 2. 在该项目下新建一份文档
curl -X POST http://127.0.0.1:3000/api/documents \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<projectId>","title":"第1章 绪论"}'
# 返回 {"id":"<docId>", ...}

# 3. 手动新增一条文献（hit 至少含 title）
curl -X POST http://127.0.0.1:3000/api/references \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<projectId>","hit":{"title":"Graph Neural Networks: A Review","year":2021}}'

# 4. 一次性问答（非流式）
curl -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"什么是注意力机制？","projectId":"<projectId>"}'

# 5. SSE 流式问答（浏览器 / curl 均可看到逐块 data）
curl -N -X POST http://127.0.0.1:3000/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我拟一个大纲","projectId":"<projectId>","enableThinking":false}'
```

> 完整端点（约 66 个路由）可由 `python3 scripts/full_regression.py` 自动回归覆盖，见 `docs/development.md`。
