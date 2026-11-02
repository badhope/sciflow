# SciFlow 开发续接指南（HANDOFF）
> 更新：2026-10-20 · 基线 `v0.6.0` · 本文件是**新环境/新会话接手的唯一入口**。
> 通读本文档 + `docs/master-plan.md`（唯一计划真理源）+ `ARCHITECTURE.md`（架构真理源）后即可无缝续接。

---

## 1. 项目是什么

**SciFlow** = 本地优先、单机部署的科研全流程 AI 助手（文献→规划→大纲→分章起草→质量门→润色→引用→投稿）。
- 技术栈：pnpm monorepo · NestJS+SQLite(better-sqlite3/drizzle/sqlite-vec) · React19+Vite+Tailwind4 · Electron 桌面端 · CLI · MCP（官方 SDK）
- 零内置原则：**产品不自带任何模型/Key/云服务**，全部用户自备（AI_BASE_URL/AI_API_KEY/AI_MODEL 三件套起步）
- 仓库拓扑：**GitHub/badhope = 唯一主仓**；Gitee/GitCode/X33834/Morningstar202604 四端为手动镜像（`git push <remote> main --force` 归一，镜像端**禁止本地提交**——会分叉）

## 2. 新环境 5 分钟起步

```bash
git clone https://github.com/badhope/sciflow.git && cd sciflow
pnpm install --frozen-lockfile
# 原生模块补齐（--ignore-scripts 主装后）：
#   better-sqlite3 → cd node_modules/.pnpm/better-sqlite3*/node_modules/better-sqlite3 && npx prebuild-install
#   electron      → 进包目录 ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node install.js
cp apps/server/.env.example apps/server/.env   # 填 AI 三件套
pnpm build && pnpm start                        # 或 pnpm dev（前后端并行）
```

**验证**：`/api/health` 200 → `SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py` 应 **PASS 238 / FAIL 0**；`python3 scripts/final_acceptance.py` 应 **23/23**。

## 3. 当前完成度（截至 v0.6.0）

| 里程碑 | 状态 | 内容 |
|---|---|---|
| M1 正确性 | ✅ | 审计 H1-H8 全修：Reflexion 定向回炉/并发互斥/SQL LIMIT/注入 800 字/尾部正则/预算器 300k |
| M2 检索与引用 | ✅ | RRF 双路融合（ANN+FTS5）/ citation-audit 引用体检 / 网搜五 provider / LLM 重排开关(默认off) / DOI 核验(Crossref) |
| M3 模块化 | ✅ | packages/{core,db,ai,retrieval} 物理拆分 + ESLint 依赖红线 + 桶过渡（统一编译模式贯穿） |
| 运行时修复 | ✅ | 实跑发现 D1–D12（12 个用户可见缺陷）+ 独立审计抓出 A1–A13（本轮引入回归），全部修复复测 → `docs/RUNTIME-FINDINGS.md` |
| Agent 工具链 | ✅ | `AgentToolBridge`：19 个 MCP 工具（11 科研能力 + 8 `config.*` 配置）可被模型自主调用，带项目作用域/次数上限（24）/超时/轨迹落库；v1.3 实测单轮 4 次配置工具调用 |
| 配置中心 | ✅ | 角色/约束/钩子/权限/审计；设置页 + `sciflow config` CLI + 对话工具三入口同源，见 `ARCHITECTURE.md` §2.17 |
| 扩展中心 | ✅ | 内置 87 条科研资产（20 MCP/31 技能/10 角色/10 约束/4 钩子/12 提示词，13 项私有优势工具）；四种添加入口 + 对话/CLI；见 `ARCHITECTURE.md` §2.18 |
| 可视化 | ✅ | DAG 实时图(回炉回边)/成本仪表盘(byModel+预算卡)/引用体检面板/语义地图(向量 PCA)/引用网络社区着色+搜索定位+抽取热力图 |
| 前端架构 | ✅ | `AppShell` 布局契约（侧栏/抽屉/断点/滚动收敛一处）、语义化 token、写作页五栏改主区+Tab+抽屉 |
| 深度调研 | 文档齐 | 幻觉引用闭环(F1)/反同质化(F2)/实验设计(F3) 已论证；B-5.3 arXiv 聚合因合规与离线不可验证**明确不做** |

## 4. 下一步待办（按优先级）

1. **真实模型人工验收**：mock 全链路已闭环；真实端点建议逐页再走一遍（成本与排队受外部影响，未纳入 CI）
2. **B-5.3 arXiv 镜像聚合**：评估后不做（合规红线 + 离线无法验证），如要做须先定数据源授权
3. **generateObject 迁移评估**：AI SDK 已标 deprecated（`packages/ai/src/ai-transport.service.ts`），当前 `generateText + zod 解析` 已可替代，待上游给出稳定迁移路径
4. 全部细节见 `docs/product-roadmap.md` 与 `docs/master-plan.md` §14 需求追溯矩阵

## 5. 踩坑清单（前人血泪，必读）

1. **JS 正则 `\b` 对中文永不匹配**（\w 不含汉字）——中文文本禁用 \b
2. **tsconfig include 收录外部源码会撑大 rootDir**（dist 结构变化连锁断启动脚本）——用 paths 拉入 import 图即可，rootDir 显式固化 `../..`
3. **tsc 增量缓存会掩盖 dist 未更新**——验证构建必须 `rm -rf dist *.tsbuildinfo` 重建
4. **dist 入口 = `dist/apps/server/src/main.js`**（不是 dist/main.js！scripts/Dockerfile/desktop 已同步）
5. **better-sqlite3 无 postinstall 产物需手动 prebuild-install**；electron 走 npmmirror
6. **回归必须全新库**（脏库指纹去重类 7 case 必挂）；脚本是基线守门员：新失败一律 FAIL 不许进 KNOWN_GAPS
7. **镜像端禁止本地提交**（分叉后只能 force 归一）
8. **documents POST 契约只收 title**，content 走 PATCH
9. CI 为 `.github/workflows/ci.yml` 三 job（类型/单测/构建 · 全量回归 · E2E+评测）；镜像仓无 Actions 时该文件为惰性，不影响主仓

## 6. 关键文档地图

| 文档 | 用途 |
|---|---|
| `docs/master-plan.md` | 开发主计划 v2（七视角框架/施工项编号/需求追溯矩阵 22 项） |
| `ARCHITECTURE.md` | 架构真理源（§2.9 模块化布局/§7 禁止造轮子守则） |
| `docs/CONFIGURATION.md` | 场景化配置指南（用户向） |
| `docs/audit-report.md` | 深度审计报告（H1-H8/W 系列问题溯源） |
| `docs/archive/audit-notes.md` | 76 项原始疑点笔记（审计过程全记录） |
| `docs/product-roadmap.md` | 产品定位与合规红线（2026-09-30 决策依据） |
| `docs/RUNTIME-FINDINGS.md` | v0.6 实测缺陷 D1–D12 / 回归 A1–A13 / 测试真实性审计 / 设计契约 |
| `docs/RUNTIME-FINDINGS-v0.7.md` | v0.7 四路独立审计结论、10 项 P0 复现→修复→复测、门禁实数、突变验证 |
| `docs/enterprise-transformation-plan.md` | 桌面端封装方案（已落地，含踩坑记录） |
| `CHANGELOG.md` | 版本历史（0.6.0 起含运行时修复与 Agent 工具链） |
| `SECURITY.md` / `CONTRIBUTING.md` | 安全披露 / 贡献流程 |

## 7. 提交纪律

- 提交信息引用 master-plan 编号：`feat(B-3.2): ...`
- 主分支 `main` 要求**签名提交**（新环境先配 `git config gpg.format ssh` + 签名 key 并登记 GitHub ssh_signing_keys）
- 推送顺序：主仓 → 四镜像 force 归一
- 每个里程碑结束：跑 §2 七视角自查 + 更新 master-plan §14
