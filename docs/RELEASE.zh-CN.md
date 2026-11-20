# 发布流程

[English](RELEASE.md) · **简体中文**

本仓库遵循 [Semantic Versioning](https://semver.org/)，并在 `CHANGELOG.md` 维护 [Keep a Changelog](https://keepachangelog.com/) 风格的历史。

## 版本规则

`MAJOR.MINOR.PATCH`

- **MAJOR**——公开 API、数据库 schema 或配置契约的破坏性变更，需要用户采取行动。
- **MINOR**——向后兼容的新能力。
- **PATCH**——缺陷修复、安全修复、文档或依赖维护。

所有 workspace 包与根 `package.json` 保持同一版本。发布在 `main` 上打附注标签 `vX.Y.Z`。

## 镜像与 CI

GitHub Actions 是唯一的 CI。Gitee 与 GitCode 是 `main` 镜像：保持从 GitHub 快进同步，不在那边再搭一套 CI。

## 发版步骤

1. **冻结代码树。** 确认 `main` 的 CI 全绿，工作树干净。

2. **更新 changelog。** 在 `CHANGELOG.md` 把未发布段落改名为新版本并写上日期，再在上方新开一个 `## [Unreleased]`。条目按 `Added`、`Changed`、`Fixed`、`Removed`、`Security` 分组。写给用户看，不写给 reviewer 看：说行为变了什么，不说改了哪个文件。

3. **升版本。** 下面这些必须一致：

   ```bash
   node scripts/bump-version.mjs X.Y.Z   # 若脚本存在，否则手工修改
   ```

   需要同步：`package.json`、`apps/server/package.json`、`apps/web/package.json`、`apps/desktop/package.json`，以及所有 `packages/*/package.json`。

4. **重建派生文件。**

   ```bash
   pnpm build
   pnpm openapi:gen
   ```

5. **跑完整门禁。** 每一行都必须绿，把输出贴进 release notes。

   ```bash
   pnpm lint
   pnpm -r typecheck
   pnpm --filter @sciflow/server test
   pnpm --filter @sciflow/web test
   pnpm -r build
   AI_MOCK=1 DATABASE_PATH=/tmp/release.db PORT=3000 node apps/server/dist/apps/server/src/main.js &
   SCIFLOW_BASE=http://127.0.0.1:3000 AI_MOCK=1 python scripts/full_regression.py
   SCIFLOW_BASE=http://127.0.0.1:3000 python scripts/route_probe.py
   node scripts/monitor_config_center.mjs --base http://127.0.0.1:3000
   node scripts/verify-jwt-access.mjs
   pnpm audit --registry=https://registry.npmjs.org --audit-level high
   ```

6. **提交并打标签。**

   ```bash
   git add -A
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --follow-tags
   ```

7. **同步镜像。** 把同一个提交推到所有镜像，让五个平台提供完全一致的代码树。镜像表见 `README.md`。

8. **发布说明。** 用 changelog 对应段落作为 release 正文。如实写验证结果与已知缺口。

## 热修复

从发布标签切分支，做最小修复并补回归测试，升 PATCH，跑完整门禁。不要把无关改动塞进热修复。

## 绝不允许发布

- 把失败或跳过的测试说成通过。
- README 或 changelog 里出现不是本轮命令产出的数字。
- 密钥、token 或填好的 `.env` 文件。
- 包之间版本不一致。
