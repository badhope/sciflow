## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- The problem this solves. Skip if obvious from the title. -->

## Verification

<!-- Paste the actual commands you ran and their result lines. Do not claim a check you did not run. -->

- [ ] `pnpm --filter @sciflow/server typecheck` — clean
- [ ] `pnpm --filter @sciflow/web typecheck` — clean
- [ ] `pnpm --filter @sciflow/server test` — __ files / __ tests
- [ ] `pnpm --filter @sciflow/web test` — __ files / __ tests
- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm -r build` — success
- [ ] `python scripts/full_regression.py` — __ passed / 0 failed

## Checklist

- [ ] Behaviour is covered by a test that fails without this change
- [ ] No secret, token or `.env` value is included
- [ ] Docs updated when behaviour or configuration changed
- [ ] AI-facing changes state whether they were verified against the mock gateway or a real endpoint
