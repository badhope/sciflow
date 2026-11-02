# v0.7.0 实测记录（2026-10-21）

本文件记录本轮**真实运行**的验证过程与结论，供后续接手者复核。所有数字均来自本机实跑。

## 1. 独立审计（4 路，互相隔离）

| 审计方向 | 评分 | 关键结论 |
|---|---|---|
| 测试真实性（含 23 次突变实验） | 48 / 100 | 23 次源码突变仅捕获 14 次；鉴权守卫改成 `return true` 仍全绿；导出返回空串仍全绿 |
| 对话与全局体验（62 条问题，四档视口实机操作） | 42 / 100 | 问答页纯文本渲染；切项目串话；停止生成空壳；三处 AI 功能必失败；暗色白卡浅字 |
| 功能真实性 | 审计中断（模型限流） | 由本人按同一清单人工核查，结论并入下方修复项 |
| 环境韧性 | 审计中断（模型限流） | 同上 |

> 说明：两路审计因 Provider 限流未产出报告，对应结论由主执行者按同一检查表人工核对，**未编造评分**。

## 2. 复现 → 修复 → 复测

| # | 现象（修复前实测） | 根因 | 复测（修复后） |
|---|---|---|---|
| 1 | 设置页永久「加载配置…」 | `SettingsProvider` 只在刷新按钮里调 `load()` | 进入即加载，4 档视口实测正常 |
| 2 | Cover Letter / 审稿回复 / 文献综述全部「无法解析的数据」 | `request()` 对 `text/html` 文本响应做 `JSON.parse` | 三个功能实测返回正文（`Dear Editor,` 等） |
| 3 | 问答页代码块/表格/公式原样显示 | 用 `whitespace-pre-wrap` 直出 | 换 Streamdown + remark-math/rehype-katex；DOM 实测 `pre/table/.katex` 均存在 |
| 4 | 切项目后旧对话残留并写入新项目 | 页面未按项目重挂载 | `key={project.id}` + 会话按项目隔离；实测切换后为空会话 |
| 5 | 停止生成后气泡为空 | abort 后未置 `stopped`，Esc 监听挂在 disabled 输入框 | 保留文本 + 「已停止 · 继续生成」；window 级 Esc 实测生效 |
| 6 | 项目总览数字恒为 0 | SQL 用 `documents.id`（物理表 `document`），异常被整体 catch | 播种 1 文档 / 4 文献后实测回包 `docCount=1, refCount=4` |
| 7 | 用量统计显示 `null%` / `nullms` | 空表时 `AVG`/`ROUND` 为 NULL | `COALESCE`/`NULLIF` 后实测 `100%` / `27ms` / `0%` |
| 8 | 文献页 390 宽被裁到 828px | 网格子项 `min-width:auto` | 补 `min-w-0`；四档视口 `scrollWidth == clientWidth` 全部成立 |
| 9 | 暗色卡片白底浅灰字 | `Card` 固定 `bg-white` | 改 `var(--card)`；截图对比通过 |
| 10 | 写作编辑器长行不换行 | CodeMirror 未启用 lineWrapping | 已启用，390 宽实测换行 |

## 3. 门禁（本机实跑）

- `pnpm -r typecheck`：0 error
- `pnpm exec eslint .`：0 error（1 warning：TanStack Table 与 React Compiler 的已知不兼容提示）
- `pnpm --filter @sciflow/server test`：11 文件 / **74 passed**
- `pnpm --filter @sciflow/web test`：8 文件 / **57 passed**
- `python scripts/full_regression.py`（全新库 + AI_MOCK=1 + SCIFLOW_DB_PATH）：**PASS 167 / FAIL 0**
- `pnpm test:e2e`：**1 passed**（真实链路：建项目→发消息→等回复）；`real-chat` 仍按设计 skip（需真实 key）
- 后端断开时 E2E 实测 **失败**（验证不是假绿）
- `pnpm --filter @sciflow/web build` / `server build`：成功

## 4. 突变验证（本轮新增/加固的测试是否真的有牙）

| 突变 | 结果 |
|---|---|
| `jwt-auth.guard.ts` 的 `AUTH_MODE` 判断改为 `return true` | 新增 4 条用例变红 ✅ |
| `documents.service.exportMarkdown` 返回空串 | 回归「文档导出（内容非空且含标题）」变红 ✅（修复前该突变全绿） |
| `downsampleIndices` 只取前 N 个 | 收紧后的断言变红 ✅（并据此发现真实缺陷：末位只到 990） |

## 5. 视觉复核

12 个页面 × 4 档视口（1440/1024/768/390）+ 6 个页面暗色，共 54 张截图；`documentElement.scrollWidth > clientWidth` 检查 0 处溢出，浏览器 `pageerror` 0 条。产物在 `shots-verify/`（工作区根，未入库）。

## 6. 未验证项

- GitHub 三仓 CI 的真实运行（本地按同一命令复刻；GitHub Actions 需推送后触发）
- 真实模型端点的回答质量（本机仅 mock；`E2E_REAL=1` 需要用户自备 key）
- 桌面端打包（Electron 安装包未构建）
- 五仓推送（用户明确要求本轮先不推）
