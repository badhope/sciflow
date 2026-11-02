# SciFlow 部署与运维指南

> 本文基于 `docker-compose.yml`、`Dockerfile`、`apps/server/.env.example` 与代码中 `process.env` 的实际读取整理（HEAD `49bdff0`）。
> SciFlow 为**单用户本地优先**应用：SQLite 单文件、无外部数据库依赖、无鉴权。

## 1. 端口与进程一览

| 端口 | 进程 | 何时出现 | 监听 |
| --- | --- | --- | --- |
| `3000` | 后端 API（NestJS） | 始终（手动 / Docker） | 默认 `127.0.0.1` |
| `5173` | 前端 Vite 开发服务器 | 仅本地开发 | localhost |
| `8080` | 前端 nginx 静态托管 | 仅 Docker 部署 | 宿主对外（反代 `/api` → server:3000） |
| `5099` | 内置 mock AI 网关 | 仅 `AI_MOCK=1` | **仅回环**，不对外 |

> 后端默认只绑定 `127.0.0.1`，局域网不可达。需要对外暴露时显式设置 `HOST=0.0.0.0`（opt-in）。

## 2. Docker 部署（推荐）

### 2.1 服务构成（`docker-compose.yml` 实际内容）

| 服务 | 构建目标 | 端口映射 | 卷 | 说明 |
| --- | --- | --- | --- | --- |
| `server` | `Dockerfile` 的 `target: server` | `3000:3000` | `./apps/server/data:/app/apps/server/data` | SQLite 数据持久化；`restart: unless-stopped` |
| `web` | `Dockerfile` 的 `target: web` | `8080:80` | 无 | nginx 静态托管前端 + `/api` 反代；`depends_on: server` |

- 镜像**不内置 `.env`**，AI 配置全部通过环境变量注入（Dockerfile 注释明确要求）。
- nginx（`apps/web/nginx.conf`）把 `/api/` 反代到 `http://server:3000/api/`，SPA 回退到 `index.html`，超时 300s。

### 2.2 启动步骤

```bash
# 1. 准备环境变量（在仓库根目录放 .env，compose 会自动读取）
cp apps/server/.env.example .env
#    编辑 .env：至少填 AI_API_KEY；按需要改 AI_BASE_URL / AI_MODEL

# 2. 构建并后台启动
docker compose up -d --build

# 3. 浏览器访问
#    http://localhost:8080
#    容器部署需让后端放行该来源：.env 中设 CORS_ORIGIN=http://localhost:8080
```

### 2.3 compose 注入的环境变量（`docker-compose.yml` 实际值）

| 变量 | compose 默认 |
| --- | --- |
| `PORT` | `3000` |
| `AI_BASE_URL` | `${AI_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}` |
| `AI_API_KEY` | **必填**（`${AI_API_KEY:?...}`，未设置则 compose 直接报错） |
| `AI_MODEL` | `${AI_MODEL:-agnes-3.0-flash}` |
| `AI_MODEL_FAST` | `${AI_MODEL_FAST:-}`（空） |
| `AI_MODEL_STRONG` | `${AI_MODEL_STRONG:-}`（空） |
| `AI_RPM_CAP` | `${AI_RPM_CAP:-8}` |
| `CORS_ORIGIN` | `${CORS_ORIGIN:-http://localhost:8080}` |

> 注意：compose 只注入上表变量。`DATABASE_PATH` 未设置时，容器内落到默认 `/app/apps/server/data/sciflow.db`，正好对应挂载卷 `./apps/server/data`，数据因此持久化到宿主。

## 3. 非 Docker 手动部署

适合本地开发或无 Docker 环境。要求 **Node ≥ 20（CI 锁定 22）、pnpm ≥ 9（仓库锁定 `pnpm@11.7.0`）**。

```bash
# 1. 安装依赖
pnpm install

# 2. 配置 AI
cp apps/server/.env.example apps/server/.env
#    编辑 apps/server/.env：至少填 AI_BASE_URL / AI_API_KEY / AI_MODEL

# 3. 编译后端
pnpm --filter @sciflow/server build

# 4. 启动后端（:3000）
node apps/server/dist/apps/server/src/main.js
#    首次启动自动建表；日志见 [SciFlow] API 已启动: http://localhost:3000/api/health

# 5. 另起终端启动前端开发服务器（:5173）
pnpm --filter @sciflow/web dev
#    浏览器打开 http://localhost:5173
```

**生产态前端**（非 dev）：

```bash
pnpm --filter @sciflow/web build     # 产物在 apps/web/dist，纯静态文件
# 用任意静态服务器托管 dist，并把 /api 反代到后端 :3000（可参考 apps/web/nginx.conf）
```

> 后端 `main.ts` 会显式加载 `apps/server/.env`（多路径探测（cwd 的 apps/server/.env、.env，以及从 __dirname 逐级向上）），因此即使从仓库根目录执行 `node apps/server/dist/apps/server/src/main.js` 也能正确读到配置，不会漏读。

## 4. 环境变量全表

> 下表逐个变量来自代码实际读取位置（`grep process.env`）与 `.env.example`。**未列出的变量代码不读取**。

| 变量 | 含义 | 默认值（代码内） | 读取位置 |
| --- | --- | --- | --- |
| `PORT` | 后端 HTTP 端口 | `3000` | `main.ts` |
| `HOST` | 监听地址；默认回环，对外暴露需设 `0.0.0.0` | `127.0.0.1` | `main.ts` |
| `DATABASE_PATH` | SQLite 数据库文件路径 | `apps/server/data/sciflow.db` | `db/database.ts` |
| `AI_BASE_URL` | OpenAI 兼容端点（国内厂商任选） | `https://ark.cn-beijing.volces.com/api/v3` | `ai/ai.service.ts` |
| `AI_API_KEY` | 你的 API 密钥 | 空（未配置 → AI 功能禁用并提示，不返回假数据） | `ai/ai.service.ts` |
| `AI_MODEL` | 默认模型 | 空（Compose 可另行指定默认值） | `packages/ai/src/ai-transport.service.ts` |
| `AI_MODEL_FAST` | fast 档（问答 / 润色 / 翻译 / 评审 JSON） | 空 → 回落 `AI_MODEL` | `ai/ai.service.ts` |
| `AI_MODEL_STRONG` | strong 档（规划 / 长文起草） | 空 → 回落 fast 档 | `ai/ai.service.ts` |
| `AI_RPM_CAP` | 用于推导 AI 并发上限的 RPM 参数 | `60`（并发上限按 RPM ÷ 6 计算；Compose 默认 `8`） | `packages/ai/src/ai-transport.service.ts` |
| `AI_MOCK` | 设为 `1` 启用进程内 mock 网关（MSW 拦截，不占端口） | 关闭 | `ai/ai.service.ts`、`ai/mock-gateway.ts` |
| `MOCK_HTTP_PORT` | mock HTTP 包装脚本端口（仅回环，供 promptfoo 等外部工具） | `5099` | `apps/server/scripts/mock-openai-http.mjs` |
| `CORS_ORIGIN` | 允许的前端来源，逗号分隔；`*` 全放行 | `http://localhost:5173,http://127.0.0.1:5173` | `main.ts` |
| `SANDBOX_PYTHON` | 实验沙箱解释器路径 | 空 → 自动探测 `python3` / `python` | `experiments/experiments.service.ts` |
| `SANDBOX_TIMEOUT_MS` | 沙箱单次执行超时（毫秒） | `10000` | `experiments/experiments.service.ts` |

兼容端点示例（格式均为 `base_url` + 模型名，任选其一）：火山方舟、DeepSeek `https://api.deepseek.com/v1`、通义、智谱、Kimi `https://api.moonshot.cn/v1`、Ollama 本地 `http://localhost:11434/v1`。

## 5. 日志与排障

- 后端日志直接输出到 stdout，带 `[SciFlow]` / `[DB]` 前缀：
  - 启动：`API 已启动: http://localhost:3000/api/health （仅监听 127.0.0.1）`
  - 建表 / 迁移：`[DB] 自检：自动建表 xxx`、`[DB] 迁移：table 新增列 xxx`
  - 断点续跑：`checkpoint 恢复完成：N 个中断任务已处理`
- 优雅关闭：收到 `SIGTERM` / `SIGINT` 时做 WAL checkpoint 后退出。
- 未捕获异常（含流水线 fire-and-forget 漏网）被全局兜底，不会崩进程，堆栈只落日志。
- 健康检查：`curl http://127.0.0.1:3000/api/health`，返回 `ai.configured` 可一眼判断 AI 是否就绪。

## 6. 数据备份

SciFlow **所有数据都在一个 SQLite 文件里**（WAL 模式），路径即 `DATABASE_PATH`，默认：

```
apps/server/data/sciflow.db
```

备份步骤：

```bash
# 1. 建议先停后端（WAL 模式下热拷贝可能拿到未合并的 wal）
#    Docker: docker compose stop server

# 2. 拷贝数据库文件；若同目录存在 sciflow.db-wal / sciflow.db-shm，一并拷贝
cp apps/server/data/sciflow.db  /备份路径/sciflow-$(date +%F).db
cp apps/server/data/sciflow.db-wal /备份路径/  2>/dev/null || true
cp apps/server/data/sciflow.db-shm /备份路径/ 2>/dev/null || true

# 3. 重启：docker compose start server  /  node apps/server/dist/apps/server/src/main.js
```

- **恢复**：停后端 → 用备份文件覆盖 `DATABASE_PATH` 指向的文件 → 启动即可。
- **回到干净状态**：删除 `DATABASE_PATH` 指向的 db 文件（及 `-wal` / `-shm`），下次启动自动重建空库并跑种子数据。
- Key 也落本地 SQLite（`model_provider` 表），因此备份 db 即连配置一起备份；**不要**把含真实 Key 的 db / `.env` 提交进版本库。
