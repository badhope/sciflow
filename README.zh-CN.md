# SciFlow

**本地优先的多智能体科研工作台：从研究主题一路做到可投稿的成稿 —— 每一步可观测，每一条引用可溯源，每一版草稿都要通过确定性的质量门。**

[![CI](https://github.com/Morningstar202604/sciflow/actions/workflows/ci.yml/badge.svg)](https://github.com/Morningstar202604/sciflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520%20(CI%2022)-339933.svg)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-11.7.0-f69220.svg)](package.json)
[![版本](https://img.shields.io/badge/version-1.11.0-black.svg)](CHANGELOG.md)

[English](README.en.md) · **简体中文**

---

## 为什么选它

多数写作工具停在「把文字生成出来」。SciFlow 跑完整个科研闭环，并且拒绝交回一份过不了检验的稿子。

| 你能得到什么 | 实际意味着什么 |
| --- | --- |
| **一条流水线直通投稿** | 选题验证 → 文献调研 → 大纲确认 → 分章起草 → 质量门 → 润色 → 引用格式化 → 期刊投稿跟踪 |
| **确定性的质量门，不是感觉打分** | 七个维度按规则计分，同一份文本必然同分；低于阈值自动定向修订，最多三轮 |
| **引用真的能查到那一篇** | 正文 `[n]` 锚点 → citation 表 → references 表三级追踪；幽灵锚点、孤儿引用、断号、重复 DOI 都定位到具体编号 |
| **过程不藏在黑盒里** | 每步执行轨迹、Token 用量、耗时甘特图，以及深度健康探针 |
| **密钥始终是你自己的** | 本地 SQLite、可选本地嵌入模型、自带模型端点，不需要注册账号 |

## 界面截图

以下截图均取自真实运行的界面与种子演示数据。

<img src="docs/screenshots/workspace.png" alt="SciFlow 工作台：项目、文档预览与 AI 对话" width="100%">

| 项目驾驶舱 | 全自动流水线 |
| --- | --- |
| <img src="docs/screenshots/dash.png" alt="项目驾驶舱" width="100%"> | <img src="docs/screenshots/pipeline.png" alt="全自动流水线" width="100%"> |

| 质量评分：七维打分 | 深色主题（墨夜配色） |
| --- | --- |
| <img src="docs/screenshots/quality.png" alt="质量评分" width="100%"> | <img src="docs/screenshots/settings-dark.png" alt="深色主题" width="100%"> |

| 文献调研 | 知识库：基于资料的问答 |
| --- | --- |
| <img src="docs/screenshots/literature.png" alt="文献调研" width="100%"> | <img src="docs/screenshots/knowledge.png" alt="知识库" width="100%"> |

| 投稿辅助：选刊、Cover Letter、跟踪 | 实验记录与沙箱 |
| --- | --- |
| <img src="docs/screenshots/submission.png" alt="投稿辅助" width="100%"> | <img src="docs/screenshots/experiments.png" alt="实验记录" width="100%"> |

| 记忆中心 | 设置：模型、扩展、快捷键 |
| --- | --- |
| <img src="docs/screenshots/memory.png" alt="记忆中心" width="100%"> | <img src="docs/screenshots/settings.png" alt="设置" width="100%"> |

## 核心能力

**科研流水线。** LangGraph 编排，大纲处保留人工确认。选题验证、递归文献调研（深度 1–3）、带反共识变体的大纲、并行分章起草、带自动回炉的质量门、润色、引用格式化。每个环节结束后写检查点，服务重启可续跑。

**确定性质量门。** 七个维度 —— 结构、篇幅、引用闭环与强度、可读性、修辞、诚信、信息密度 —— 全部由规则计算并带稳定指纹。五档可选标准从草稿迭代到顶刊投稿，各自约束篇幅、引用数与及格线。正文低于标准下限 90% 直接判硬伤封顶，不靠形式分救回体量不足的稿子。

**引用完整性。** 从正文锚点到 citation 再到 reference 的三级追踪。七类体检覆盖幽灵锚点、孤儿条目、重复 DOI 与元数据冲突。文献池为空时起草提示词直接禁用引用标记，模型无从编造。

**能离线工作的检索。** sqlite-vec 近似最近邻加 FTS5 trigram 全文，用 RRF 融合、MMR 去冗余。嵌入可走本地 GGUF 模型，也可走你已配置厂商的 `/embeddings` 接口。学术检索直连 OpenAlex、Crossref 与 arXiv，带 TTL 缓存。

**模型自由。** 支持 OpenAI 兼容、Anthropic Messages、Google Gemini 三种协议。可指向 DeepSeek、智谱、Kimi、通义、OpenRouter、本地 Ollama，或任何兼容端点。快慢双档路由，附端点探测与连接测试。

**MCP 双向。** 把文献、检索与流水线能力暴露给 Claude 或其他 MCP 客户端；也能接入外部 MCP 服务器作为额外工具。

**无界面运行。** `sciflow run --topic "…" --auto --out ./paper/` 不打开窗口也能出稿。

**Agent harness（智能体基础设施）**。编程智能体需要的那套底座，用在科研上：模型自己维护的任务清单让长任务可核对而不是黑盒；上下文压缩在窗口溢出前把早期轮次折叠成结构化摘要；`@` 提及把指定文献/文档/资料拉进当前这一轮；工具审批在产生副作用的操作（跑代码、改正文、改全局配置）前暂停，并给出人能读懂的理由而不是一个工具名。

**证据链**。写作视图把论证的来路画成一条链——研究问题、文献依据、正文锚点、引用记录、可溯源条目——并直接标出断在哪里。22 篇文献但正文零锚点，会报"2 处断点"而不是一个绿勾。

## 快速开始

需要 Node ≥ 20（CI 使用 22）与 pnpm 11.7.0。

```bash
git clone https://gitcode.com/badhope/sciflow.git
cd sciflow
pnpm install
pnpm doctor
cp apps/server/.env.example apps/server/.env
# 在 apps/server/.env 填写 AI_BASE_URL、AI_API_KEY、AI_MODEL
pnpm build
pnpm start
```

打开 `http://localhost:3000`，或用 `pnpm dev:web` 单独启动前端开发服务器。

### 没有 API Key 也能跑通

确定性 mock 网关可在本地跑完整条流水线：

```bash
AI_MOCK=1 DATABASE_PATH=/tmp/sciflow_demo.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js
node scripts/seed-demo.mjs
```

### Docker

```bash
docker compose up --build                              # 开发
docker compose -f docker-compose.prod.yml up --build    # 生产
```

### 桌面端

```bash
pnpm build && pnpm icons
pnpm desktop:dev     # 开发
pnpm desktop:dist    # 安装包输出到 apps/desktop/release/
```

## 配置

全部配置位于 `apps/server/.env`。设置页提供同样的选项，并带连接测试与模型探测，交互使用时可不必手写该文件。

| 变量 | 用途 |
| --- | --- |
| `AI_BASE_URL` · `AI_API_KEY` · `AI_MODEL` | 主模型端点 |
| `AI_PROTOCOL` | `openai-compatible`（默认）、`anthropic` 或 `gemini` |
| `AI_MODEL_FAST` · `AI_MODEL_STRONG` | 快慢档路由 |
| `AI_RPM_CAP` | 每分钟请求上限 |
| `DATABASE_PATH` | SQLite 文件位置 |
| `AUTH_MODE` | 本地用 `none`，共享部署用 `jwt` |
| `ALLOW_PRIVATE_OUTBOUND` | 放行回环与内网地址，用于本地模型服务 |

按场景的配置说明见 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)。

## 验证

下表中的每个数字都来自在当前代码树上实际执行的命令。

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 服务端单测与集成 | `pnpm --filter @sciflow/server test` | 47 文件，376 项 |
| 前端单测 | `pnpm --filter @sciflow/web test` | 21 文件，135 项 |
| 类型检查 | `pnpm -r typecheck` | 通过 |
| 代码规范 | `pnpm lint` | 0 error |
| 构建 | `pnpm -r build` | 成功 |
| 黑盒回归 | `python scripts/full_regression.py` | 240 通过，0 失败 |
| 全路由探针 | `python scripts/route_probe.py` | 96 条路由，0 失败 |
| 配置巡检 | `node scripts/monitor_config_center.mjs` | 25/25 |
| 权限边界 | `node scripts/verify-jwt-access.mjs` | 28/28 |
| 依赖审计 | `pnpm audit --registry=https://registry.npmjs.org` | 无已知漏洞 |

## 架构

```
apps/server      NestJS 11 · Drizzle ORM · better-sqlite3（WAL）· Vercel AI SDK · LangGraph · MCP SDK
apps/web         React 19 · Vite 6 · Tailwind v4 · TanStack Query/Table · Recharts · sigma.js · CodeMirror 6
apps/desktop     Electron 41 · 内嵌服务端 · electron-builder
packages/core    共享领域逻辑：质量审计、引用审计、地址策略、流水线步骤
packages/ai      传输层、模型目录、受控出站请求、mock 网关
packages/db      Schema、迁移、密钥加密
packages/retrieval  向量与全文检索、MMR、嵌入
```

数据链为 `Project → Document（多版本）→ Citation → Reference`，`PipelineTask`、`AgentExecution`、`ReflexionLog`、`MemoryLog`、`LlmCallLog` 记录状态、轨迹、回炉轮次、记忆与成本。

更细的说明见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 模块边界、数据流、契约与决策记录 |
| [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) | 按场景的模型、检索、鉴权与 CLI 配置 |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | 健康探针、备份恢复、故障模式 |
| [`docs/deployment.md`](docs/deployment.md) | Docker、桌面打包与生产部署说明 |
| [`docs/development.md`](docs/development.md) | 本地开发流程 |
| [`docs/BRAND.md`](docs/BRAND.md) | 视觉识别与设计令牌 |
| [`docs/product-roadmap.md`](docs/product-roadmap.md) | 能力矩阵与后续规划 |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | 分支、提交、评审与发布流程 |
| [`SECURITY.md`](SECURITY.md) | 威胁模型与漏洞披露 |
| [`CHANGELOG.md`](CHANGELOG.md) | 版本历史 |

## 项目状态

当前版本：**1.11.0**。完整历史见 [`CHANGELOG.md`](CHANGELOG.md)，后续规划见 [`docs/product-roadmap.md`](docs/product-roadmap.md)。

已知缺口：真实模型端到端需要你自己的 API Key；Docker 与 Playwright 套件在 CI 中执行，未在每台开发机上验证；Windows 下桌面安装包需要 C++ 工具链。

## 许可证

MIT，见 [`LICENSE`](LICENSE)。
