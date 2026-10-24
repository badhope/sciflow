# 运维手册（Operations / SRE）

> 适用：本地单机部署、桌面端、以及企业模式（`AUTH_MODE=jwt`）内网部署。
> 所有数字与命令均来自本机实测（2026-10-21/22），不含推测值。

## 1. 服务拓扑

| 组件 | 进程 | 默认端口 | 依赖 |
|---|---|---|---|
| 后端 API | `node dist/apps/server/src/main.js` | 3000 | SQLite 文件、可选 Python（实验沙箱） |
| 前端（开发） | `vite` | 5173 | 后端 |
| 前端（生产） | 静态文件（`apps/web/dist`）由 nginx/同源托管 | 80/443 | 后端 |
| 桌面端 | Electron 主进程 + 内嵌后端 | 随机回环端口 | 同上 |

**硬依赖**：Node ≥ 20、SQLite 文件可写。缺任一 → 拒绝启动（doctor 会先报）。
**软依赖**：Python 3（实验沙箱）、本地嵌入模型 GGUF（语义检索）、SearXNG/商业搜索 Key（联网搜索）。缺失均降级，不影响主流程。

## 2. SLI / SLO（当前只有可观测项，没有历史数据支撑的正式 SLO）

| SLI | 采集方式 | 现状 | 建议 SLO |
|---|---|---|---|
| API 可用性 | `/api/health` 返回 `status=ok` | 本机实测持续 200 | 99.5% / 30 天 |
| 请求成功率 | `llm_call_log.success` 聚合（设置页「LLM 用量与成本」） | 空库为 0 次，有调用后真实统计 | ≥ 99%（LLM 调用） |
| 请求延迟 | `llm_call_log.latency_ms`（`/api/usage/summary` 的 `avg_latency_ms`） | 本机 mock 27ms；真实网关取决于厂商 | p95 < 30s（长文生成除外） |
| 错误率 | 后端日志 `level=error` 计数 | 无告警接线 | < 1% |

> **诚实说明**：项目目前没有正式的 SLO 文档、错误预算策略与告警通道。这是「单机自托管工具」的合理取舍，但企业部署必须补。见第 7 节。

## 3. 健康检查与自检

```bash
curl -s http://127.0.0.1:3000/api/health
# {"status":"ok","db":true,"ai":{...},"capabilities":{"vectorSearch":true,"embeddingModel":false}}
```

- `status=degraded`：数据库 `SELECT 1` 失败 → 检查磁盘/权限。
- `capabilities.vectorSearch=false`：sqlite-vec 未加载 → 检索降级为全文，功能可用但语义检索失效。
- `capabilities.embeddingModel=false`：未配置 `EMBEDDING_MODEL_PATH` → 同上。

环境全量自检：

```bash
pnpm doctor          # 人类可读
pnpm doctor --json   # 机器可读（CI/桌面启动自检）
pnpm doctor --fix    # 自动修复安全项（建目录、清理孤儿 WAL）
```

### 深度探针 `GET /api/health/deep`（v1.0）

三探针只读巡检，供监控/桌面托盘消费；单项失败不互相阻断，不发起真实模型请求：

- `checks.db`：`SELECT 1` 往返时延（`latencyMs`）
- `checks.vector`：sqlite-vec 扩展加载态与已嵌入块计数（未加载时 `ok=false`，属正常降级）
- `checks.ai`：AI 端点配置形态（configured/model/baseUrl；连通性实测走设置页「测试模型」）

## 4. 日志

| 位置 | 内容 | 保留 |
|---|---|---|
| stdout（pino JSON） | 所有请求（health/usage 除外）、错误、启动阶段 | 由进程管理器决定 |
| `apps/server/data/sciflow.db` → `llm_call_log` | 每次 LLM 调用的 caller/model/tokens/latency/success | 永久（随库备份） |
| `agent_execution` / `agent_step` | Agent 工具调用轨迹 | 随项目删除级联清理 |
| 桌面端 `%APPDATA%/@sciflow/desktop/logs/server.log` | 内嵌后端 stdout/stderr | 由用户清理 |

**敏感数据**：不记录 API Key（DB 中加密存储，`listProviders` 只回掩码）；不记录用户密码（bcrypt 哈希）；请求体不落日志（pino-http 默认只记 method/url/status）。

## 5. 备份与恢复（已实测）

```bash
# 备份（在线安全备份，不锁库；默认保留 14 份）
node scripts/backup-db.mjs
DATABASE_PATH=/path/to/sciflow.db node scripts/backup-db.mjs --keep 7

# 恢复（实测步骤）
# 1) 停后端
# 2) cp backups/sciflow-<stamp>.db $DATABASE_PATH     ← 注意：同时删除同目录 -wal/-shm
# 3) 启动后端，/api/health 返回 ok
```

实测记录（2026-10-22）：备份 835KB / 45 张表 / 5 个项目；复制回 `DATABASE_PATH` 后重开，表与数据完整（`projects=5`）。**恢复测试通过**。
注意：Windows 下 `/tmp` 与 `C:\Users\...\Temp` 是同一目录的不同写法，用 git-bash 路径给 Node 打开可能失败 —— 用 Windows 原生路径。

## 6. 故障模式与处置

| 故障 | 表现 | 处置 |
|---|---|---|
| AI 端点不可达 | 对话报「无法连接服务器」/「上游模型超时」 | `pnpm doctor` 看 AI 段；检查 Base URL/Key；本地端点确认已启动 |
| AI 限流 429 | 请求失败并提示「请求过于频繁」 | 调低 `AI_RPM_CAP` 并发，或换端点 |
| 数据库被占用 | 写操作 500 / `SQLITE_BUSY` | 已设 `busy_timeout=5000`；确认没有第二个进程指向同一 DB |
| 端口被占用 | 启动即退出 | `PORT=3001` 重启；`pnpm doctor` 会报占用 |
| sqlite-vec 加载失败 | 日志 warning，检索降级 | 重装依赖 `pnpm rebuild sqlite-vec`；或设 `SCIFLOW_NO_VEC=1` 明确降级 |
| 嵌入模型缺失 | 语义检索不可用 | 配置 `EMBEDDING_MODEL_PATH`，或忽略（全文检索可用） |
| Python 缺失 | 实验沙箱不可用（有专门引导文案） | 安装 Python 3 |
| 磁盘满 | 写入失败、health degraded | 清理 `backups/`、日志；迁移 DB 到更大磁盘 |
| 后端崩溃重启 | WAL 残留 | 自动恢复；异常退出可用 `pnpm doctor --fix` 清理孤儿 WAL |

**重试策略**：前端 `request()` 60s 超时；AI 调用按 `AI_RPM_CAP` 限流 + `p-retry`（服务层）；流水线单步失败不整体崩溃（step 状态落库，可续跑）。**无无限重试**。

## 7. 企业模式（`AUTH_MODE=jwt`）上线检查表

- [ ] `JWT_SECRET` 已设置为 32+ 字符随机串（**未设置会拒绝启动**，2026-10 修复）
- [ ] `ALLOW_REGISTRATION` 未设置（默认关闭；只有空库首次注册可建管理员）
- [ ] `HOST=0.0.0.0` 且 `AUTH_MODE=jwt`（否则拒绝启动）
- [ ] 反向代理启用 TLS（本服务不终结 TLS）
- [ ] `CORS_ORIGIN` 设为实际前端域名（不要用 `*`）
- [ ] 备份任务已配置（cron / 任务计划）
- [ ] 项目归属：`project.owner_id` 由创建者写入；历史空归属项目在企业模式下**不可见**，需管理员显式迁移

## 8. 已知限制（诚实清单）

1. 无多副本/高可用：单进程 + 单 SQLite 文件。
2. 无正式告警通道（无 PagerDuty/邮件/Webhook 通知）。
3. 无分布式追踪（只有结构化日志 + LLM 调用记录）。
4. 无自动伸缩：并发上限 `AI_RPM_CAP`（默认值见 CONFIGURATION.md）。
5. 桌面端仅 Windows x64 实测通过打包；macOS/Linux 未验证。
6. `AUTH_MODE=jwt` 下项目隔离已实现，但**文档/文献等资源的 API 只做了项目级校验**，未做字段级审计日志。
