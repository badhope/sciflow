# Release process

This repository follows [Semantic Versioning](https://semver.org/) and keeps a
[Keep a Changelog](https://keepachangelog.com/) history in `CHANGELOG.md`.

## Version scheme

`MAJOR.MINOR.PATCH`

- **MAJOR** — a breaking change to the public API, the database schema, or the
  configuration contract that requires user action.
- **MINOR** — new capability, backwards compatible.
- **PATCH** — bug fix, security fix, documentation or dependency maintenance.

Every workspace package carries the same version as the root `package.json`.
Releases are tagged `vX.Y.Z` on `main` and are annotated.

## Cutting a release

1. **Freeze the tree.** Confirm `main` is green on CI and the working tree is clean.

2. **Move the changelog.** In `CHANGELOG.md`, rename the unreleased section to the
   new version with today's date, and open a fresh `## [Unreleased]` section above it.
   Group entries under `Added`, `Changed`, `Fixed`, `Removed`, `Security`.
   Write entries for users, not for reviewers: say what changed in behaviour, not
   which file was edited.

3. **Bump versions.** All of these must match:

   ```bash
   node scripts/bump-version.mjs X.Y.Z   # if present, otherwise edit by hand
   ```

   Files to keep in sync: `package.json`, `apps/server/package.json`,
   `apps/web/package.json`, `apps/desktop/package.json`, and every
   `packages/*/package.json`.

4. **Regenerate derived artifacts.**

   ```bash
   pnpm build
   pnpm openapi:gen
   ```

5. **Run the full gate.** Every line must be green; paste the output into the
   release notes.

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

6. **Commit and tag.**

   ```bash
   git add -A
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main --follow-tags
   ```

7. **Mirror.** Push the same commit to every mirror so all five platforms serve
   an identical tree. See the mirror table in `README.md`.

8. **Publish notes.** Use the changelog section as the release body. State the
   verification numbers and any known gaps honestly.

## Hotfix

Branch from the release tag, apply the minimal fix with a regression test, bump
PATCH, and run the full gate. Do not bundle unrelated changes into a hotfix.

## What never ships

- A failing or skipped test presented as passing.
- A number in the README or changelog that was not produced by a command in this
  release cycle.
- Secrets, tokens or filled `.env` files.
- A version mismatch between packages.
