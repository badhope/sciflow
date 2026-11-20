# 贡献指南 · Contributing to SciFlow

[English](CONTRIBUTING.md) · **简体中文**

> 中文完整版：保留更多实现细节与历史背景；如与英文主文冲突，以英文主文为准。



感谢你愿意为 SciFlow 出力！本项目是本地优先的单机科研 AI 助手，欢迎 Issue / PR / 文档补全与回归用例补充。

## 开发环境

- Node.js ≥ 20（CI 锁定 **Node 22**）、**pnpm 11.7.0**（仓库根 `package.json` 的 `packageManager` 字段锁定）。
- 仓库为 **pnpm workspace**：`apps/server`（NestJS）+ `apps/web`（React/Vite）。
- 首次准备：

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # 本地配置，不要提交
pnpm --filter @sciflow/server build
pnpm dev                                       # 后端 :3000 + 前端 :5173 同起
```

- 跑通 AI 相关功能需要在 `apps/server/.env` 填你自己的 OpenAI 兼容 Key；不想配 Key 时用 `AI_MOCK=1` 起后端，全链路可在无外网/无 Key 下端到端跑通。

## 分支与提交规范

- 从 `main` 切分支命名：`feat/<short-topic>`、`fix/<short-topic>`、`chore/<short-topic>`、`docs/<short-topic>`。
- 提交信息遵循约定式前缀，一行说清做了什么：
  - `feat: …` 新功能
  - `fix: …` 缺陷修复
  - `chore: …` 工程/依赖/杂项
  - `docs: …` 文档
  - `style: …` 纯样式/品牌，无逻辑改动
  - `perf: …` 性能优化
  - `refactor: …` 不改变行为的重构
- 涉及 AI 输出的改动，请在提交信息里注明走的是 mock 还是真实网关验证。

## 测试要求（PR 合入前必须全绿）

```bash
# 1. 双端类型检查（TS strict）
pnpm --filter @sciflow/server typecheck
pnpm --filter @sciflow/web typecheck

# 2. 单元测试（vitest；注意不要让 vitest 扫到 dist/）
pnpm --filter @sciflow/server test

# 3. 双端构建
pnpm --filter @sciflow/server build
pnpm --filter @sciflow/web build

# 4. 全量回归（mock 网关，FAIL 必须为 0）
AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_pr.db PORT=3000 node apps/server/dist/apps/server/src/main.js &
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py
```

CI（`.github/workflows/ci.yml`）会在每个 PR 上重复执行：install → typecheck×2 → vitest → build×2 → 校验 `.env` 未被跟踪。CI 红的 PR 不会合入。

## PR 流程

1. Issue 先讨论较大改动（避免返工）；小修小补可直接 PR。
2. PR 描述写清：改了什么、为什么、怎么验证的（贴 typecheck/test/回归结果关键行）。
3. 涉及新端点/新页面：同步更新 `scripts/full_regression.py` 用例与 `docs/product-roadmap.md` 能力矩阵。
4. 保持提交历史可读（squash 合并）。

## 代码风格与原则

- **TypeScript strict**：禁止 `any` 泛滥；AI 结构化输出一律走 zod schema 校验，坏 JSON 要有兜底。
- **前端**：Tailwind CSS v4；图表走 `components/charts.tsx`（Recharts），图谱走 sigma.js 组件，表格用 TanStack Table；**不在页面内手写图表/表逻辑**（见 `ARCHITECTURE.md` §7）。
- **零新增重型依赖原则**：每加一个运行时依赖，先问能否用标准库/现有依赖实现——本项目刻意保持轻量（mock 网关仅用 `node:http`，中文分词为零依赖 Bigram）。
- **安全红线**：
  - 不得把真实 API Key / token / 密码写进任何源码、测试或文档（占位符用 `sk-your-api-key-here`）。
  - 后端默认只监听 `127.0.0.1`；实验沙箱必须保持隔离 + 超时/资源上限。
  - SQL 一律走 Drizzle 参数化，禁止拼字符串。
- **AI 错误友好化**：网络错误 / 429 / 5xx / 超时统一转译中文提示，英文技术错误不直接裸露在界面上。

## 行为守则

参与本项目即同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。