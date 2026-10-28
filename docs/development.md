# SciFlow 开发者指南

> 面向想在 SciFlow 上新增功能的开发者。内容基于当前代码结构（HEAD `49bdff0`）。
> 提交规范、PR 流程另见根目录 `CONTRIBUTING.md`；本文聚焦「怎么加一个后端模块 / 前端页面」与「合并前要跑哪些检查」。

## 1. 目录结构

### 1.1 后端 `apps/server/src`（NestJS 模块地图）

| 目录 | 职责 | 是否有 controller |
| --- | --- | --- |
| `main.ts` | 启动入口：CORS、`/api` 前缀、监听、checkpoint 断点续跑 | — |
| `app.module.ts` | 根模块，注册全部子模块与全局异常过滤器 | — |
| `ai/` | 统一 LLM 服务（OpenAI 兼容）+ Prompt 模板 + 零依赖 mock 网关 + 令牌桶限流 | 否（被注入） |
| `db/` | Drizzle schema + SQLite 连接 + 建表/轻量迁移 + schema 自检 | — |
| `common/` | 全局输入校验 Pipe、全局异常过滤器等公共件 | — |
| `projects/` | 项目 CRUD | 是 `/api/projects` |
| `documents/` | 文档 / 大纲 / 分章 / 润色 / 翻译 / 引用 / 导出 | 是 `/api/documents` |
| `references/` | 文献库 / PRISMA 筛选 / 编码矩阵 / 引用网络 / 综述 | 是 `/api/references` |
| `knowledge/` | RAG 知识库（BM25 + 向量混合检索） | 是 `/api/knowledge` |
| `pipeline/` | 流水线状态机 + 断点续跑 | 是 `/api/pipeline` |
| `agent/` | Agent 执行轨迹（agent_execution / agent_step 记录与查询） | 是 `/api/agent-trace` |
| `research/` | 研究设计、模拟评审、审稿意见（`research.controller`） | 是 `/api/research` |
| `research/quality.controller.ts` | 7 维质量评分 | 是 `/api/quality` |
| `research/submission.controller.ts` | 选刊 / Cover Letter / 投稿状态跟踪 | 是 `/api/submission` |
| `judgment/` | 意图判断 / 评审闭环 | 是 `/api/judgment` |
| `experiments/` | 实验沙箱（本机 Python spawn） | 是 `/api/experiments` |
| `chat/` | 科研问答（含 SSE 流式） | 是 `/api/chat` |
| `memory/` | 情景 / 程序记忆 | 是 `/api/memory` |
| `mcp/` | MCP 工具协议化 | 是 `/api/mcp` |
| `settings/` | 设置 / 模型连通自检（`settings.controller`） | 是 `/api/settings` |
| `settings/customization.controller.ts` | 自定义意图 / 步骤开关 / 质量权重 / prompt | 是 `/api/customization` |
| `settings/usage.controller.ts` | token 成本统计 | 是 `/api/usage` |
| `dashboard/` | 工作台聚合 | 是 `/api/dashboard` |
| `health.controller.ts` | 健康检查 | 是 `/api/health` |

> 单个功能模块的标准三件套：`xxx.controller.ts` + `xxx.service.ts` + `xxx.module.ts`（如 `projects/`）。

### 1.2 前端 `apps/web/src`

| 路径 | 内容 |
| --- | --- |
| `App.tsx` | Hash 路由壳、侧栏导航分组（`NAV_GROUPS`）、项目区、⌘K 命令面板、全局 Toast/主题 |
| `main.tsx` | 入口挂载 |
| `api/client.ts` | 唯一的 fetch 封装 + 全部 API 方法（`api.projects.*` / `api.documents.*` …） |
| `types.ts` | 全量 TS 类型 |
| `components/ui.tsx` | Button/Input/Modal/Spinner/ErrorBox/Toast 等基础组件 |
| `components/charts.tsx` | **Recharts 封装**（雷达图、柱线饼图、历史对比）；引用网络用 `pages/literature/ForceGraph.tsx`（sigma.js + graphology，WebGL） |
| `pages/` | 页面组件：`DashboardPage` `WritingPage` `LiteraturePage` `KnowledgePage` `PipelinePage` `QualityPage` `ExperimentsPage` `MemoryPage` `ChatPage` `SubmissionPage` `SettingsPage` |
| `pages/` 辅助件 | `ChatPanel` `DocExporter` `VersionDiffModal` `CiteReorderButton` |

> 前端为「view 字符串 + Hash 路由」模式：`#/writing?doc=<id>` 深链直达；页面全部 `lazy` 懒加载。

## 2. 技术栈要点

| 端 | 选型 | 备注 |
| --- | --- | --- |
| 后端 | NestJS 11 · TypeScript（strict）· Drizzle ORM · better-sqlite3（WAL）· zod · Vercel AI SDK · LangGraph · MCP 官方 SDK | AI 走 OpenAI 兼容协议；编排只在 `pipeline/pipeline.graph.ts` |
| 前端 | React 19 · Vite 6 · Tailwind CSS v4 · TanStack Query/Table · Recharts · sigma.js + graphology · CodeMirror 6 · react-markdown + KaTeX | 图表一律走 `components/charts.tsx` 或既有图谱组件 |
| 工程 | pnpm workspace · vitest（server 68 / web 50）· Playwright · promptfoo · GitHub Actions（Node 22）· Python 3 回归脚本（165 项） | CI 三 job：类型/单测/构建 · 全量回归 · E2E+评测 |
| 数据 | SQLite 单文件（WAL、外键开、busy_timeout 5000ms） | 启动时 schema 自检自动建表/补列，幂等 |

## 3. 如何新增一个后端模块（5 步）

以新增一个 `notes` 模块为例，照 `projects/` 的三件套结构：

1. **写 Service** `apps/server/src/notes/notes.service.ts`：业务逻辑写这里；需要 AI 就注入 `AiService`，需要数据库就用 `db`（从 `../db/database` 导入）。
2. **写 Controller** `notes.controller.ts`：`@Controller('notes')` 声明前缀，用 `@Get/@Post/@Patch/@Delete` 标注端点；请求体直接内联类型（项目约定不用 class-validator），必要时用 zod 校验。
3. **写 Module** `notes.module.ts`：`@Module({ controllers: [NotesController], providers: [NotesService] })`，需要给别的模块复用就加 `exports: [NotesService]`。
4. **注册到根模块** `app.module.ts`：`import { NotesModule }` 并加入 `imports: [...]` 数组。
5. **建表**：在 `apps/server/src/db/schema.ts` 用 Drizzle 定义新表。**无需手写 DDL**——`db/database.ts` 启动时会以 schema 为事实来源做自检，自动 `CREATE TABLE IF NOT EXISTS` / 对旧库 `ALTER TABLE ADD COLUMN`（非破坏性）。需要主动推送可跑 `pnpm --filter @sciflow/server db:push`。

> 完成后按第 5 节跑一遍检查；新端点尽量在 `scripts/full_regression.py` 补一条断言，保证回归覆盖。

## 4. 如何新增一个前端页面（4 步）

以新增「笔记」页为例：

1. **写页面文件** `apps/web/src/pages/NotesPage.tsx`：导出命名组件 `export function NotesPage({ project }: { project: Project }) { ... }`（需读当前项目就接 `project` props）。
2. **接入路由壳** `App.tsx`：
   - `const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })))`
   - 把 `'notes'` 加进 `View` 类型与视图白名单数组；
   - 在 `main` 渲染区加分支 `{ view === 'notes' && currentProject && <SuspensePage><NotesPage project={currentProject} /></SuspensePage> }`；
   - `VIEW_LABELS` 加 `notes: '笔记'`。
3. **加 API client 方法** `apps/web/src/api/client.ts`：在 `api` 对象里加 `notes: { list: (projectId) => request(...) }` 等方法，沿用现有 `request()` 封装（自动 60s 超时 + 中文错误转译）。
4. **加入口** `App.tsx` 的 `NAV_GROUPS`：选一个分组（研究工具 / 自动化 / 辅助），加 `{ key: 'notes', label: '笔记', icon: <LucideIcon> }`，侧栏与 ⌘K 命令面板会自动出现。

## 5. 合并前必跑的检查（CI 等价）

```bash
# 1. 类型检查（双端，CI 强制 ×2）
pnpm --filter @sciflow/server typecheck
pnpm --filter @sciflow/web typecheck

# 2. 单元测试（vitest；引用格式化等核心纯逻辑）
pnpm --filter @sciflow/server test
pnpm --filter @sciflow/web test

# 3. 构建（双端）
pnpm --filter @sciflow/server build && pnpm --filter @sciflow/web build

# 4. 全量回归（覆盖全部路由 + 一条流水线端到端产物断言）
#    先以 mock 模式起后端：
AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_regression.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js
#    另一终端：
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py
```

- 回归基线（本机实测 v1.7–v1.8）：mock 网关 **PASS 221 / FAIL 0 / KNOWN 0**（KNOWN 机制保留，当前空集；含 v1.7 新增学术库发现检索 3 项）。
- 配置中心另有 19 项只读巡检（已接入 CI regression job）：
  `node scripts/monitor_config_center.mjs --base http://localhost:3000 --log /tmp/server.log`
- 完整验收矩阵：`python scripts/final_acceptance.py`（**23 项**，含 CLI `config status/preview` 冒烟）。
- 扩展中心测试：`apps/server/src/extensions/extensions.service.spec.ts`（18）+ `apps/web/src/pages/settings/ExtensionCenter.test.tsx`（11）。
- 主题风格包：`apps/web/src/lib/theme.test.ts`（6 条，含两维正交与非法值回落）；改 `styles/themes.css` 后必须跑一次 `pnpm --filter @sciflow/web test`。
- 单测基线（v1.8）：server **280** / web **117** / desktop **5**。
- mock 模式跑端到端流水线时务必把 `AI_RPM_CAP` 调大（如 120），否则默认令牌桶会等待导致超时。

### 企业模式（AUTH_MODE=jwt）验证

权限边界改动必须做一次真机验证，不能只跑单测（单测里 AUTH_MODE 默认 none，容易全绿但线上 403/404 打脸）：

```bash
# 独立库 + 独立端口，避免污染开发库
AUTH_MODE=jwt ALLOW_REGISTRATION=1 JWT_SECRET=<32+ 随机串>   DATABASE_PATH=/tmp/jwt.db PORT=3102 node apps/server/dist/apps/server/src/main.js

# 首个注册用户 = admin，第二个 = member（ALLOW_REGISTRATION=1）
# 断言清单见 apps/server/src/common/project-access-subresources.spec.ts 与 docs/CONFIGURATION.md
```

必查六项：① 无 token → 401；② member 读他人项目 → 404；③ member 改实例配置 → 403；
④ member 读自己项目 → 200；⑤ 无 projectId 聚合 → 403/400；⑥ 提权（改权限档）→ 403。

## 6. 代码风格红线

1. **零新增重型依赖**：不为图表面、不为表单、不为校验随意引大包。校验用 zod，基础组件优先在 `components/ui.tsx`；图片表用 `components/charts.tsx`（Recharts），表格用 TanStack Table——先查 `ARCHITECTURE.md` §2/§7 有没有现成件。
2. **禁止页面内手写图表/表逻辑**：图表一律扩 `components/charts.tsx`，图谱用 sigma.js 组件，排序筛选用 TanStack Table（§7 守则）。
3. **不引入国外 API / 外部云**：AI 只通过 OpenAI 兼容协议对接**用户自己的 Key**（默认国内厂商端点）；检索、分词、向量化全部本地；不上传用户数据到第三方。
4. **安全基线**：后端默认只绑 `127.0.0.1`；新增对外能力不要擅自改监听地址；错误响应不回显堆栈（全局异常过滤器已兜底）；`.env` / 真实 Key 不进镜像、不进版本库。
5. **单用户本地定位**：不建多租户、不做账号体系；新功能的数据落本地 SQLite，沿用现有表结构与 `db/database.ts` 的自检迁移机制。
6. **无 Key 也要能跑**：本地功能（项目/文献/RAG）在未配 AI 时照常可用；AI 功能缺失时给明确配置提示，**不返回假数据**。
