# Contributing to SciFlow

**English** · [简体中文](CONTRIBUTING.zh-CN.md)

Thanks for taking the time to improve SciFlow. Issues, pull requests, docs and
regression cases are all welcome.

## Setup

- Node.js 20 or newer. CI uses Node 22.
- pnpm 11.7.0, pinned by the `packageManager` field.
- The repo is a pnpm workspace: `apps/server` (NestJS) and `apps/web` (React +
  Vite).

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # local only; never commit it
pnpm --filter @sciflow/server build
pnpm dev                                       # API :3000 and web :5173
```

AI features need your own OpenAI-compatible key in `apps/server/.env`. To work
without a key or network, start the server with `AI_MOCK=1`; the full pipeline
runs against the in-process mock gateway.

## Branches and commits

Branch from `main` using `feat/<topic>`, `fix/<topic>`, `chore/<topic>` or
`docs/<topic>`.

Use a conventional one-line prefix:

- `feat:` new capability
- `fix:` bug fix
- `chore:` tooling or dependencies
- `docs:` documentation
- `style:` visual or brand-only change
- `perf:` performance
- `refactor:` behaviour-preserving restructure

If a change touches model output, say in the commit message whether it was
verified against the mock gateway, a real endpoint, or both.

## Checks before a pull request

All of these must pass:

```bash
pnpm --filter @sciflow/server typecheck
pnpm --filter @sciflow/web typecheck
pnpm --filter @sciflow/server test
pnpm --filter @sciflow/server build
pnpm --filter @sciflow/web build
```

Then run the full mock regression:

```bash
AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_pr.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js &
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py
```

CI repeats install, both typechecks, unit tests, both builds, the OpenAPI drift
check and the secret guard. A red pull request is not merged.

## Pull request flow

1. Open an issue first for a large change; small fixes can go straight to a PR.
2. Describe what changed, why, and how you verified it. Paste the key check lines.
3. New routes or pages need a matching case in `scripts/full_regression.py` and
   an update to the capability table in `docs/product-roadmap.md`.
4. Keep the history readable; pull requests are squash-merged.

## Style and engineering rules

- TypeScript strict. Avoid `any`; validate model output with a zod schema and
  handle malformed JSON explicitly.
- Tailwind CSS v4. Charts go through `components/charts.tsx`, graphs through the
  sigma.js component, tables through TanStack Table. Do not hand-roll chart or
  table logic inside a page.
- Prefer the standard library or an existing dependency over a new heavy package.
  The mock gateway uses only `node:http`; the Chinese tokenizer is a zero-dependency
  bigram implementation.
- Never commit API keys, tokens or passwords. Use placeholders such as
  `sk-your-api-key-here`.
- Keep the API on `127.0.0.1` by default. The experiment runner must keep its
  working-directory and timeout isolation.
- Use Drizzle parameterised queries. Never concatenate SQL strings.
- Turn network, 429, 5xx and timeout failures into readable messages instead of
  exposing raw provider errors in the UI.

## Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
