# Development guide

**English** · [简体中文](development.zh-CN.md)

This page is for adding a backend module or a frontend page. Contribution and
pull-request rules live in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Setup

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev
```

Node 20+ and pnpm 11.7.0 are required. `pnpm dev` starts the API on 3000 and the
Vite UI on 5173. Use `AI_MOCK=1` when you do not have a model key.

## Layout

```text
apps/server/src   NestJS modules, one folder per domain
apps/web/src      React pages, shared components, API client
apps/desktop      Electron main process and packaging
packages/core     shared types, step definitions, env helpers
packages/ai       model transport, prompts, timeout and mock gateway
scripts           regression, route probe, screenshot and release checks
```

Backend domains include `projects`, `documents`, `references`, `knowledge`,
`pipeline`, `agent`, `research`, `submission`, `experiments`, `chat`, `memory`,
`mcp` and `settings`. Each owns its controller, service and tables.

## Add a backend module

1. Create `apps/server/src/<domain>/` with a module, service and controller.
2. Register the module in `app.module.ts`.
3. Add DTOs and validation. If the route is public, use the existing public
   decorator only for auth and health; everything else stays guarded.
4. Add a service test with a real temporary SQLite database where persistence is
   involved.
5. Add a case to `scripts/full_regression.py` and regenerate OpenAPI with
   `pnpm openapi:gen`.

Keep cross-domain writes inside the owning service. Do not import another
domain's repository or table directly.

## Add a frontend page

1. Create the page under `apps/web/src/pages/`.
2. Add the view key to `VIEW_KEYS` and its label to `VIEW_LABELS`.
3. Add an entry to `NAV_GROUPS` in `App.tsx`; the sidebar and the ⌘K palette pick
   it up automatically.
4. Reuse `api/client.ts` for requests and the shared UI components for layout.
   Do not create a second fetch wrapper.
5. Add a route probe or Playwright smoke case when the page has a critical path.

Charts use `components/charts.tsx`; the citation graph uses the sigma.js
component; tables use TanStack Table. Page components should not hand-roll
chart or table logic.

## Checks

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Full mock regression:

```bash
AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_dev.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js &
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py
```

Raise `AI_RPM_CAP` for an end-to-end mock run; the default token bucket can
otherwise queue long enough to look like a timeout.

For JWT mode, set `AUTH_MODE=jwt` and a 32+ character `JWT_SECRET`, then run the
route probe with a bearer token.

## Style

- TypeScript strict. Validate model output with zod.
- Parameterised SQL only. No string concatenation.
- Keep secrets out of source, tests and fixtures.
- Prefer an existing dependency or the standard library over a new runtime
  package.
- A new endpoint needs OpenAPI coverage; a new page needs a regression or
  Playwright case.
