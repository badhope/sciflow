# 安全说明（Security）

> 本文件记录 2026-10 全维度安全审计的**实测结论**与修复状态。所有 PoC 均为本机执行过的命令。
> 适用威胁模型：单用户本地/桌面部署为默认；企业模式（`AUTH_MODE=jwt`）为可选加固形态。

## 1. 威胁模型（明确边界）

| 场景 | 是否在威胁模型内 | 说明 |
|---|---|---|
| 本机单用户（默认，`HOST=127.0.0.1` + `AUTH_MODE=none`） | 部分 | 同机其他用户/恶意进程可访问回环端口，因此仍需防 SSRF、防路径穿越 |
| 内网多用户（`HOST=0.0.0.0` + `AUTH_MODE=jwt`） | 是 | 必须防 IDOR、越权、开放注册 |
| 公网暴露 | 不在（不推荐） | 未做 WAF/CC 防护；需前置反代 + TLS + 速率限制 |
| 恶意租户隔离（SaaS 多租户） | 不在 | 本项目不是多租户产品 |

## 2. 已修复问题（含 PoC）

### S-1 【Critical】默认 JWT 密钥可伪造管理员令牌

- 位置：`apps/server/src/auth/auth.module.ts:24`（修复前）
- 复现（已执行）：
  ```bash
  # 用代码里硬编码的默认密钥离线签发
  node -e "const {JwtService}=require('@nestjs/jwt'); \
    console.log(new JwtService({secret:'sciflow-local-secret-change-me'}).sign({sub:'attacker',email:'e@x',role:'admin'}))"
  # 服务以 AUTH_MODE=jwt 启动后（未设 JWT_SECRET）
  curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/api/projects -H "Authorization: Bearer <伪造token>"
  # → 200（完全绕过鉴权）
  ```
- 修复：`AUTH_MODE=jwt` 时 `JWT_SECRET` 缺失或 <32 字符 → **拒绝启动**；`AUTH_MODE=none` 用进程内随机密钥。
- 复测：无 secret 启动 → 进程退出；有 32+ 字符 secret → 未带 token 返回 401；用旧默认密钥伪造 → **401**。

### S-2 【High】SSRF：外部 MCP / SearXNG 地址可访问内网与云元数据

- 位置：`apps/server/src/mcp/mcp.service.ts`（`withExternalClient`）、`apps/server/src/websearch/websearch.service.ts`（`fetchJson`）
- 复现（已执行，修复前）：
  ```bash
  curl -X POST /api/mcp/external/discover -d '{"url":"http://127.0.0.1:3000/api/health"}'
  # → 502，但错误信息里带出内部 Nest 响应体（证明请求确实打到内网端口）
  curl -X POST /api/mcp/external/discover -d '{"url":"http://169.254.169.254/latest/meta-data/"}'
  # → fetch failed（本机无云环境，但请求已发出）
  ```
- 修复：新增 `apps/server/src/common/outbound-guard.ts`
  - 拒绝回环 / 私有 / 链路本地（含 `169.254.0.0/16`）/ CGNAT / 保留 / 组播 / `::1` / `fe80::/10` / `fc00::/7`
  - 域名先 `dns.lookup(all)` 再逐地址判定（防 DNS rebinding）
  - 拒绝内嵌凭据 URL（`http://user:pass@host`）
  - 需要本地自建服务时显式 `ALLOW_PRIVATE_OUTBOUND=1`
- 复测：内网地址 → **400「外部 MCP 地址被拒绝：禁止访问内网/保留地址」**；公网地址正常。
- 测试：`apps/server/src/common/outbound-guard.spec.ts`（11 条，全部通过）。

### S-3 【High】IDOR：按文档 id 可跨项目读取/改写

- 位置：`apps/server/src/documents/documents.controller.ts`（修复前无归属校验）
- 复现（已执行）：创建 A 项目文档 → 用另一个身份签发 token 请求 `GET /api/documents/{A的文档id}` → **200**，`PATCH` 同样 200。
- 修复：新增 `ProjectAccessService`（`apps/server/src/common/project-access.service.ts`）
  - `AUTH_MODE=jwt`：项目必须属于当前用户（`project.owner_id`），否则统一 404（不泄露存在性）
  - 文档访问经由其项目归属校验
  - `GET /api/projects` 只列本人项目；`GET /api/documents` 在 jwt 模式下必须带 `projectId`
  - `AUTH_MODE=none`：全部 no-op，保持本地/桌面行为不变
- 复测（已执行）：第二个身份 `GET /api/projects` → `[]`；`GET/PATCH` A 的文档 → **404**。
- 回归：本地模式 `169/169` 全绿（确认没破坏单用户行为）。

### S-4 【High】开放注册：任何人都能自助开户，空库首位即管理员

- 位置：`apps/server/src/auth/auth.service.ts`
- 复现：`POST /api/auth/register`（`@Public()`）在已有用户时仍返回 201 + token。
- 修复：已存在用户后默认 403；仅 `ALLOW_REGISTRATION=1` 时放开。空库首次注册仍允许（初始化管理员）。
- 复测：第一个账号 201；第二个 → **403「注册已关闭」**。

### S-5 【Medium】引用体检「无锚点 = 满分」假绿

- 位置：`apps/server/src/documents/documents.service.ts`（`citationAudit`）
- 复现：正文不含任何 `[n]` → `score=100`、`issues=[]`。
- 修复：无锚点时 `score` 封顶 60 并给出「未检测到引用」提示；同时锚点识别扩展为 `[n]` / `[Ref:n]` / `【n】`（此前只认 `[n]`，正文用 `[Ref:1]` 会误判 0 锚点）。
- 回归：新增 27.4 / 27.5 两条断言（含突变验证：把识别改回只认 `[n]` 会红）。

### S-6 【Medium】备份脚本完全不可用

- 位置：`scripts/backup-db.mjs:44`
- 复现：`node scripts/backup-db.mjs` → `TypeError: Database is not a constructor`
- 根因：`const { default: Database } = require('better-sqlite3')` —— CJS 包 require 直接返回构造函数，没有 `.default`。
- 修复：兼容两种导出形态。复测：备份 835KB / 45 表 / 5 项目；恢复回 `DATABASE_PATH` 后数据完整。

## 3. 未修复 / 已接受的风险

| 项 | 等级 | 状态 | 理由 |
|---|---|---|---|
| 依赖 CVE 扫描 | ✅ | 已执行 | 2026-11-01 使用官方 npm registry：生产依赖与全量依赖均无 high/critical，`pnpm audit --registry=https://registry.npmjs.org --audit-level high` 返回 `No known vulnerabilities found`；剩余低/中危也已通过定点 overrides 清除 |
| 无 TLS 终结 | Medium | 设计如此 | 由反代负责；单机回环部署不需要 |
| 无审计日志（谁改了什么） | Medium | 未实现 | 单用户场景价值低；企业模式建议补 `audit_log` 表 |
| `project.owner_id` 历史数据为空 | Low | 已定义行为 | 企业模式下不可见，需管理员显式迁移；不做「先到先得」认领 |
| 沙箱不是安全边界 | Medium | 设计如此 | 威胁模型是「LLM 生成的 buggy 代码卡死自己」，不是恶意代码；已有超时/临时目录/env 白名单/数组参数 |
| 速率限制只按 IP | Low | 未改 | 单机足够；多用户场景建议按 user 维度 |

## 4. 安全相关的运行配置

```bash
# 企业模式最小配置
HOST=0.0.0.0
AUTH_MODE=jwt
JWT_SECRET=<32+ 随机字符>      # 未设置 → 拒绝启动
CORS_ORIGIN=https://your.domain
# ALLOW_REGISTRATION=1        # 一般不设置
# ALLOW_PRIVATE_OUTBOUND=1    # 仅当 SearXNG/MCP 在内网时
```

## 5. 验证命令（可复跑）

```bash
# 鉴权行为
pnpm --filter @sciflow/server exec vitest run src/auth/jwt-auth.guard.spec.ts
# SSRF 防护
pnpm --filter @sciflow/server exec vitest run src/common/outbound-guard.spec.ts
# 级联删除（21 张表）
pnpm --filter @sciflow/server exec vitest run src/projects/projects-cascade-full.spec.ts
# 全量回归
AI_MOCK=1 SCIFLOW_DB_PATH=/tmp/x.db python scripts/full_regression.py
```
