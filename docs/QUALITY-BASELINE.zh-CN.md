# 质量基线

[English](QUALITY-BASELINE.md) · **简体中文**

SciFlow 用确定性门禁判断稿件，不把决定权交给模型。七个维度由规则计分，并生成稳定指纹：

- 论证与逻辑推进
- 证据与可追溯性
- 结构与章节完整度
- 引用完整性
- 语言与清晰度
- 新颖性与定位
- 投稿匹配度

规则不通过时，无论模型打多少分都不能放行；模型分只作参考。未通过的稿件会收到定向修改项，而不是无限重抽。

## 引用完整性

正文每个 `[n]` 必须能指向一条 citation，再指向一条 reference。门禁会报告幽灵锚点、孤儿条目、重复 DOI 和断号。文献库为空时，禁止写入引用标记。

## 1.19.9 的发布证据

以下是 1.19.9 版本真实跑过的门禁，不是覆盖率百分比：

| 门禁 | 结果 |
|---|---|
| 服务端单测 | 809 通过 |
| Web 单测 | 240 通过 |
| Playwright E2E | 10 通过，1 跳过 |
| Mock 全量回归 | 238 通过，0 失败 |
| 路由探针 | 96 通过，0 失败 |
| 配置中心 | 25 通过 |
| JWT 权限断言 | 28 通过 |
| OpenAPI 路径 | 227 |
| 首屏 JS 预算 | 416.6 KB raw / 127.9 KB gzip |

## 1.19.11 查询缓存合并验证

1.19.11 清掉第二轮复查最后发现的重复读路径：阶段条与驾驶舱对同一接口共用一组 query key；记忆中心无筛选时不再重复请求全量列表。本地已验证：

| 门禁 | 结果 |
|---|---|
| ESLint | 通过 |
| 服务端 / Web typecheck | 通过 |
| 服务端单测 | 114 文件 / 809 通过 |
| Web 单测 | 45 文件 / 243 通过 |
| 全量 build | 通过 |
| OpenAPI 生成 | 227 paths，生成文件无 diff |

E2E 由 GitHub Actions 工作流执行；本补丁不额外声称跑过表中之外的完整回归。

覆盖率只作诊断指标，不作为发布条件。行为断言和回归用例才是契约。

## 1.19.10 合并改动验证

1.19.10 是导航与代码路径的合并补丁。本地已验证：

| 门禁 | 结果 |
|---|---|
| ESLint | 通过 |
| 服务端 / Web typecheck | 通过 |
| 服务端单测 | 114 文件 / 809 通过 |
| Web 单测 | 45 文件 / 243 通过 |
| 全量 build | 通过 |
| OpenAPI 生成 | 227 paths，生成文件无 diff |

E2E 由 GitHub Actions 工作流执行；本补丁不额外声称跑过表中之外的完整回归。

覆盖率只作诊断指标，不作为发布条件。行为断言和回归用例才是契约。

## 复现

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build

AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_quality.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js &
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py
```

OpenAPI 漂移检查和首屏预算检查在 `.github/workflows/ci.yml` 中执行。

## 这份基线不宣称

- 它不能证明没有缺陷。
- 它不能替代真实模型验收。
- 它不能把 Python 运行器变成安全边界。

历史覆盖率与复杂度快照不再作为当前发布口径。
