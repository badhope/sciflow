# Quality baseline

**English** · [简体中文](QUALITY-BASELINE.zh-CN.md)

SciFlow uses a deterministic gate, not a model's opinion. The gate scores seven
dimensions with rules and a stable fingerprint:

- argument and logical flow
- evidence and traceability
- structure and section completeness
- citation integrity
- language and clarity
- novelty and positioning
- submission fit

A rule failure blocks the draft regardless of the model score. The model score is
shown as a reference only. A failed draft receives targeted revision items; it is
not rerolled indefinitely.

## Citation integrity

Each `[n]` marker must resolve to a citation row and then to a reference. The
gate reports ghost markers, orphan references, duplicate DOIs and broken
numbering. An empty reference library blocks citation markers.

## Release evidence for 1.19.9

These are the gates that actually ran for the current release, not coverage
percentages:

| Gate | Result |
|---|---|
| Server unit tests | 809 passed |
| Web unit tests | 240 passed |
| Playwright E2E | 10 passed, 1 skipped |
| Full mock regression | 238 passed, 0 failed |
| Route probe | 96 passed, 0 failed |
| Configuration centre | 25 passed |
| JWT permission assertions | 28 passed |
| OpenAPI paths | 227 |
| First-screen JS budget | 416.6 KB raw / 127.9 KB gzip |

Coverage is tracked as a diagnostic, not as a release condition. Behavioural
assertions and regression cases are the contract.

## Reproduce

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build

AI_MOCK=1 AI_RPM_CAP=120 DATABASE_PATH=/tmp/sciflow_quality.db PORT=3000 \
  node apps/server/dist/apps/server/src/main.js &
SCIFLOW_BASE=http://localhost:3000 AI_MOCK=1 python3 scripts/full_regression.py
```

The OpenAPI drift check and the first-screen budget are part of
`.github/workflows/ci.yml`.

## What this baseline does not claim

- It does not prove the absence of bugs.
- It does not replace a real-model acceptance run.
- It does not turn the Python runner into a security boundary.

The historical coverage and complexity snapshot is kept in the
[Chinese quality page](QUALITY-BASELINE.zh-CN.md).
