# SciFlow 企业级封装方案

> 日期：2026-10-09（执行状态更新：2026-10-10）
> 基于：仓库当前 HEAD `e606167`，74 commits，v0.1.9 → **本轮已交付 v0.2.0**

---

## 0. 执行状态（2026-10-10 第一轮交付）

### ✅ 已落地

| 交付项 | 位置 | 验证 |
|---|---|---|
| 品牌 Logo 体系（一笔流线 S + 品牌渐变） | `docs/brand/`（icon-master / logo-mark ×2 / logo-horizontal） | 侧栏/登录门/favicon/apple-touch-icon 同源 |
| 品牌指南 | `docs/BRAND.md` | 色板 token 与 index.css 一一对应 |
| 桌面端 Electron（完整骨架） | `apps/desktop/`（main / preload / server-manager / auto-updater） | 主进程 tsc 编译通过 |
| 后端内嵌 + 数据隔离 | `ELECTRON_RUN_AS_NODE` + userData + 自动空闲端口 | 设计定型（打包链路见 desktop README） |
| electron-builder 三平台配置 | `apps/desktop/electron-builder.yml` | NSIS/DMG/AppImage/deb |
| 企业认证（JWT，默认旁路） | `apps/server/src/auth/` + `user` 表 + AuthGate 登录门 | **端到端冒烟 6/6 通过**（401 拦截/注册 admin/登录/Bearer/业务端点/错误密码） |
| 健康检查增强 | `/api/health` 返回 db/uptime/authMode/desktop | 冒烟验证 |
| 生产部署编排 | `docker-compose.prod.yml`（healthcheck + 备份 sidecar） | 配置定型 |
| SQLite 在线备份脚本 | `scripts/backup-db.mjs`（官方 backup API，不锁库） | 脚本就绪 |
| nginx 生产增强 | gzip / immutable 缓存 / SSE 关缓冲 / 64M 上传 | 配置定型 |
| 图标生成工具 | `scripts/generate-icons.mjs`（resvg，`pnpm icons`） | 4 张位图已生成 |
| 引用样式崩溃修复（真实缺陷） | csl-register + csl-templates + zh-CN locale | **单测 7/7 全绿** |

### 🎯 本轮顺手修复的存量缺陷（v0.1.9 遗留）

1. **6 种引用样式运行时崩溃**：citation-js 0.8.x 仅内置 apa/vancouver/harvard1，上次重构后 IEEE/GB-T 7714/Nature/Chicago/Springer/ACS 渲染即抛 "Cannot find style"；GB-T 7714 还因缺 zh-CN locale 崩溃。→ 注册官方样式 + 官方中文 locale 修复。
2. **顺序编码制双编号**（`[3] [1] …`）→ 官方样式编号为准。
3. **单测 5/5 失败**（spec 断言已删除的手写渲染行为）→ 更新为 CSL 标准行为 + 防回归测试。
4. **Web 幽灵依赖**（unified/remark-parse/@types/mdast 未声明）→ 显式声明，构建恢复全绿。

### 📌 数据库路线决策（ADR）

**v1 维持 SQLite（WAL）+ 在线备份/Litestream 流复制，PostgreSQL 双方言改造推迟到 v2**。理由：

1. 数据层深度绑定 SQLite 生态：better-sqlite3 同步 API、sqlite-vec vec0 虚拟表、启动时 DDL + 反射自检（reconcileSchema）；双方言改造需触及全部 20 个模块的 import 与测试，无法在本轮完成可验证的交付；
2. 本产品单库定位（科研个人/小团队工作台），SQLite WAL 在该量级（GB 级以下）性能与可靠性完全够用；
3. 企业可用性由**备份 + 恢复**保证：`backup-db.mjs`（每日在线备份，保留 N 份）已就绪，Litestream 实时复制配置样例见下；
4. v2 若确需多租户/多写者，再整体迁移（drizzle 双 schema + node-postgres + pgvector 评估），一次性做完整回归。

### 🔜 下一轮（按优先级）

1. 桌面端真机打包验证（Windows NSIS 安装/卸载/升级闭环）；
2. 多租户行级隔离（`tenant_id` 全表迁移 + 拦截器）与 RBAC 细化（admin/member/viewer 已在 user.role 预留）；
3. SSO（OAuth2/LDAP）；
4. Litestream 实时复制接入（替代/叠加每日备份）；
5. i18n 英文界面。



## 一、核心策略：一码三端，API 不变

当前后端是标准 NestJS REST API（`/api/*`），前端是标准 React SPA。**所有业务逻辑都在 API 层**，前端只做展示和交互。这意味着：

- **API 层完全复用**：20 个 NestJS 模块一行不改，只加横切层（认证/租户/审计）
- **前端完全复用**：18 个页面组件一行不改，只换部署壳（Electron / nginx）
- **数据库适配**：Drizzle ORM 天然支持 SQLite ↔ PostgreSQL 切换，改 schema 方言即可
- **增量改造**：每次只加一层，不推翻重写

```
┌─────────────────────────────────────────────────────┐
│                    共享前端 (React 19)                │
│   apps/web/src/pages/*  (18 页面，零改动)             │
├─────────────────────────────────────────────────────┤
│                    共享后端 (NestJS 11)                │
│   apps/server/src/*  (20 模块，零改动)                │
│   + 横切层：Auth / Tenant / Audit / RateLimit        │
│   + 数据库适配层：SQLite(桌面) / PostgreSQL(Web)      │
├──────────────────┬──────────────────────────────────┤
│   Desktop 壳     │         Web 部署                   │
│   Electron       │   nginx + PM2 / Docker Swarm      │
│   本地 SQLite    │   PostgreSQL + Redis + 对象存储    │
└──────────────────┴──────────────────────────────────┘
```

---

## 二、桌面端封装（Electron）

### 方案选型

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| **Electron** | React 生态无缝、打包成熟、Windows/macOS/Linux 全支持 | 包体积大（~150MB）、内存占用高 | ✅ **选用**，科研用户对体积不敏感 |
| Tauri | 体积小（~10MB）、安全 | Rust 学习曲线、WebView 兼容碎片 | 备选 |
| NW.js | 老、社区小 | 维护不活跃 | ❌ |

### 架构

```
sciflow-desktop/
├── electron/
│   ├── main.ts          # 主进程：窗口管理、生命周期、IPC
│   ├── preload.ts       # 预加载脚本：安全隔离
│   ├── ipc.ts           # IPC 处理器：文件操作、窗口控制
│   └── auto-updater.ts  # 自动更新（electron-updater）
├── src/                 # 复用 apps/web 的 React 代码
├── build/               # electron-builder 打包配置
└── package.json
```

### 关键设计

1. **双模式架构**：桌面端默认走"本地模式"（内嵌后端进程 + SQLite），也支持切换到"云端模式"（连接远程 API Server）
2. **后端内嵌**：Electron 主进程 `spawn` Node.js 子进程跑 `apps/server/dist/apps/server/src/main.js`，窗口加载前端页面
3. **数据隔离**：每个用户实例独立 SQLite 文件（`~/.sciflow/data/sciflow.db`），互不干扰
4. **自动更新**：electron-updater + GitHub Releases / 自建更新源
5. **离线优先**：本地模式完全离线可用（AI 需要用户自配 Key，其他功能零网络依赖）

### 打包配置（electron-builder）

```yaml
# 三平台安装包
win:
  target: nsis          # Windows .exe 安装程序
  icon: build/icon.ico
mac:
  target: dmg           # macOS .dmg
  icon: build/icon.icns
linux:
  target: deb/rpm/AppImage
  icon: build/icon.png
```

### 开发流程

```
1. pnpm dev  → Electron 窗口启动，加载 Vite dev server (http://localhost:5173)
2. 后端自动 spawn → 监听 127.0.0.1:3000
3. 前端 API 请求自动指向本机后端
4. pnpm build → electron-builder 打包三平台安装包
```

---

## 三、Web 端 SaaS 化

### 架构演进

```
当前：  前端(nginx) → 后端(NestJS:3000) → SQLite

目标：  前端(nginx/CDN) → API 网关(Nginx/Kong) → 后端(NestJS 集群) → PostgreSQL
                                  → Redis(缓存/限流)
                                  → 对象存储(MinIO/S3，存 PDF/图片)
```

### 分阶段演进

#### 阶段 A：单机部署增强（最小改动，先能用）

- 后端 `HOST=0.0.0.0` 暴露到局域网/公网
- 新增 `apps/server/src/auth/` 模块：JWT 登录 + 用户表
- 新增 `apps/server/src/tenant/` 模块：租户隔离（所有表加 `tenantId` 字段）
- SQLite → PostgreSQL 切换（Drizzle 方言改 `pg`，schema 加 `tenantId`）
- Docker Compose 一键部署（已有 docker-compose.yml，加 Redis + PostgreSQL）

#### 阶段 B：生产级部署（企业能用）

- NestJS 集群（PM2 或 Docker Swarm），多实例 + 负载均衡
- PostgreSQL 主从复制 + 自动备份
- Redis 缓存（RAG 检索结果缓存、会话状态）
- 对象存储（文献 PDF、实验图片、导出文件）
- HTTPS 终止（Nginx / Caddy）
- 健康检查 + 优雅关闭（已有 SIGTERM 处理）

#### 阶段 C：企业特性（企业级产品）

- SSO（OAuth2 / SAML / LDAP）
- RBAC 权限模型（管理员/研究员/访客）
- 审计日志（所有写操作落 `audit_log` 表）
- 用量计费（LLM token 成本追踪已有 `llm_call_log`，扩展为配额管理）
- 数据导出/迁移（整项目打包导出，BibTeX/RIS 已有）
- 多语言（i18n，当前仅中文）

---

## 四、数据库适配层设计

### 核心问题

当前所有表都是 SQLite 方言（Drizzle `sqliteTable`），需要让同一代码跑 PostgreSQL。

### 方案：Drizzle ORM 双方言

```
apps/server/src/db/
├── schema-sqlite.ts    # 当前 schema（保留，桌面端用）
├── schema-pg.ts        # PostgreSQL 方言 schema（Web 端用）
├── database.ts         # 根据 DATABASE_TYPE 动态选择方言
└── migrate.ts          # 迁移工具
```

### 需要适配的差异

| 特性 | SQLite | PostgreSQL | 处理 |
|------|--------|-----------|------|
| `integer` | 有 | 有 | ✅ 一致 |
| `real` | 有 | `real` | ✅ 一致 |
| `blob` | 有 | `bytea` | ⚠️ Drizzle 自动映射 |
| `text` | 有 | `text` | ✅ 一致 |
| `autoincrement` | `integer` | `serial` | Drizzle 方言处理 |
| `WAL 模式` | ✅ | N/A | 仅 SQLite 需要 |
| `sqlite-vec` | ✅ | `pgvector` | ⚠️ 向量检索需替换 |
| 迁移 | `drizzle-kit push` | `drizzle-kit migrate` | 工具切换 |

### 向量检索适配（关键难点）

| 场景 | 当前方案 | PostgreSQL 方案 |
|------|---------|---------------|
| TF 向量余弦 | JSON 存 `vector` 字段，内存计算 | `pgvector` 扩展，SQL 内计算 |
| embedding | `sqlite-vec` 虚拟表 | `pgvector` 向量列 + `hnsw_index` |
| BM25 | 内存计算 | `pg_search` (ParadeDB) 或应用层 |

**建议**：先保持"应用层计算"（TF 向量 JSON + 内存余弦），不依赖数据库扩展。PostgreSQL 仅做结构化存储，向量计算仍在 NestJS 内存中完成。等数据量大了再上 `pgvector`。

---

## 五、认证与多租户设计

### 用户模型

```sql
-- 新增表
user {
  id, email, password_hash, name, role, 
  tenant_id, created_at, updated_at
}

tenant {
  id, name, plan (free/pro/enterprise),
  ai_base_url, ai_api_key (加密存储),
  ai_model, ai_rpm_cap,
  storage_limit_mb, created_at
}

session {
  id, user_id, token_hash, expires_at
}

audit_log {
  id, user_id, tenant_id, action, resource, 
  detail, ip, created_at
}
```

### 多租户隔离策略

**方案**：行级隔离（所有业务表加 `tenant_id` 字段）

```typescript
// NestJS 拦截器，自动注入 tenantId 到所有查询
@TenantInterceptor()
class TenantGuard implements NestInterceptor {
  intercept(context, next) {
    const tenantId = context.switchToHttp()
      .getRequest().user.tenantId;
    // 所有 Repository.find() 自动加 .where('tenant_id', tenantId)
  }
}
```

### 适配策略

1. **桌面端**：跳过认证（单机本地模式），自动创建 `tenant_id = local`
2. **Web 端**：JWT 认证 + 租户隔离
3. **迁移路径**：`ALTER TABLE xxx ADD COLUMN tenant_id TEXT DEFAULT 'local'`

---

## 六、配置管理

### 分层配置

```
1. 环境变量（.env）— 基础设施配置（端口、数据库路径、AI Key）
2. 数据库（app_setting 表）— 运行时配置（用户偏好、功能开关）
3. 代码默认值 — 业务逻辑默认行为
```

### 新增配置项

```env
# 数据库类型：sqlite | postgres
DATABASE_TYPE=sqlite
# POSTGRES_URL=postgres://user:pass@host:5432/sciflow

# 认证模式：none | jwt | sso
AUTH_MODE=none
# JWT_SECRET=your-secret

# 存储模式：local | s3
STORAGE_MODE=local
# S3_ENDPOINT=...
# S3_BUCKET=...

# 限流
RATE_LIMIT_RPM=100
```

---

## 七、分阶段实施路线图

### 阶段 1：桌面端封装（2-3 周）

**目标**：SciFlow 变成可安装的桌面应用，离线可用

| 任务 | 工作量 | 说明 |
|------|--------|------|
| 搭建 Electron 项目骨架 | 2d | main/preload/renderer 三进程，复用 apps/web |
| 后端进程内嵌 | 2d | main.ts spawn Node.js 跑 server，IPC 管理生命周期 |
| 数据目录隔离 | 1d | `~/.sciflow/` 存放 SQLite + 配置 + 日志 |
| 自动更新 | 2d | electron-updater + CI 打包 Release |
| 打包配置 | 2d | electron-builder 三平台配置 + 图标 |
| 安装包测试 | 2d | Windows/macOS/Linux 安装、卸载、升级 |
| 文档 | 1d | 安装指南、使用手册 |

**交付物**：Windows .exe / macOS .dmg / Linux .AppImage 安装包

---

### 阶段 2：Web 端生产化（3-4 周）

**目标**：SciFlow 可部署为 Web 服务，多人可用

| 任务 | 工作量 | 说明 |
|------|--------|------|
| PostgreSQL 适配 | 3d | Drizzle schema 双方言，DATABASE_TYPE 切换 |
| 认证模块 | 3d | JWT 登录/注册/密码重置 |
| 多租户隔离 | 3d | 所有表加 tenantId，拦截器自动注入 |
| Docker Compose 增强 | 2d | 加 PostgreSQL + Redis，一键启动 |
| Nginx 配置 | 2d | HTTPS、反向代理、静态资源缓存 |
| 数据备份 | 2d | pg_dump 定时备份 + S3 存储 |
| 健康检查增强 | 1d | /api/health 返回数据库/AI/存储状态 |
| 文档 | 2d | 部署指南、运维手册 |

**交付物**：Docker Compose 一键部署的 Web 服务

---

### 阶段 3：企业特性（3-4 周）

**目标**：SciFlow 成为企业级科研协作平台

| 任务 | 工作量 | 说明 |
|------|--------|------|
| RBAC 权限模型 | 3d | 管理员/研究员/访客，API 级权限控制 |
| SSO 集成 | 3d | OAuth2（GitHub/Google）+ LDAP |
| 审计日志 | 2d | 所有写操作落 audit_log，可查询/导出 |
| 用量配额 | 2d | 基于 llm_call_log 的 token 成本统计 + 配额限制 |
| 对象存储 | 3d | S3/MinIO 存储 PDF/图片/导出文件 |
| 数据迁移工具 | 2d | 项目级导出/导入（JSON + 资源文件） |
| 监控面板 | 3d | 系统指标（CPU/内存/DB）、业务指标（活跃用户/LLM调用） |
| 多语言 | 3d | i18n 框架 + 英文翻译 |

**交付物**：企业级科研协作 SaaS 平台

---

### 阶段 4：打磨与发布（2 周）

| 任务 | 工作量 | 说明 |
|------|--------|------|
| 端到端测试 | 3d | 桌面端安装/升级/数据迁移、Web 端部署/备份/恢复 |
| 性能优化 | 3d | 大数据集（1000+ 文献）查询优化、RAG 检索缓存 |
| 安全审计 | 2d | 依赖扫描、依赖审查、渗透测试 |
| 文档完善 | 2d | API 文档（Swagger）、架构文档、运维手册 |
| 发布打包 | 2d | Release 打包、安装包签名、CDN 部署 |

---

## 八、总工作量估算

| 阶段 | 周期 | 核心交付 |
|------|------|---------|
| 阶段 1：桌面端 | 2-3 周 | 可安装的桌面应用 |
| 阶段 2：Web 端 | 3-4 周 | 可部署的 Web 服务 |
| 阶段 3：企业特性 | 3-4 周 | 企业级协作平台 |
| 阶段 4：打磨发布 | 2 周 | 正式发布 |
| **合计** | **10-13 周** | 完整产品 |

---

## 九、关键决策点

### 1. 数据库切换时机

**建议**：阶段 2 一起做 PostgreSQL 适配，不拖到阶段 3。原因：Drizzle 双方言改造越早成本越低，等功能加多了再改 schema 方言风险大。

### 2. 认证模式选择

**建议**：
- 桌面端：`AUTH_MODE=none`（单机本地，无认证）
- Web 端：`AUTH_MODE=jwt`（标准 JWT，够用）
- 企业版：`AUTH_MODE=sso`（OAuth2/SAML/LDAP，阶段 3）

### 3. 向量检索方案

**建议**：先保持应用层计算（内存余弦），不依赖数据库扩展。等单租户数据量 > 10 万 chunk 时再上 `pgvector`。

### 4. AI Key 管理

**建议**：
- 桌面端：用户在设置页填自己的 Key，存本地 SQLite（`app_setting` 表，AES 加密）
- Web 端：管理员在租户配置中填 Key，存数据库（AES 加密），用户不感知

### 5. 开源 vs 商业

**建议**：保持 MIT 开源（当前是 MIT），桌面端免费，Web 端提供免费层（单用户）+ 付费层（多用户、高配额）。

---

## 十、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| Drizzle 双方言兼容问题 | 中 | 高 | 阶段 2 前置做 POC，验证核心 CRUD + RAG |
| sqlite-vec → pgvector 迁移 | 中 | 高 | 先用应用层计算兜底，pgvector 作为优化项 |
| Electron 打包体积过大 | 低 | 低 | 科研用户对体积不敏感，150MB 可接受 |
| 多租户改造遗漏表 | 中 | 高 | 写迁移脚本逐个加 tenantId，回归测试覆盖 |
| AI API 限流 | 已有 | 已有 | 已有令牌桶限流，阶段 3 加配额管理 |
