# SciFlow Project Baseline (Four Modules)

> Baseline anchor: version `v1.19.18`; `main` contains product commit `b9e7a05` (verified 2026-11-25; this baseline update follows as a docs-only commit).
> This is the team's single source of truth for product and engineering status, fixed to four modules: **current core state, delivered capabilities, backlog, roadmap**.
> The document follows `main`: after this file merges, the anchor advances to the merge commit. A capability is never marked delivered without evidence.

## 0. Change discipline

| Rule | Requirement |
| --- | --- |
| Single source | Capabilities, versions and test numbers live here; the roadmap page only indexes |
| Evidence first | “Delivered” must point to code, a test, a CI run, acceptance screenshots, or a release asset |
| Status vocabulary | `Delivered` / `In progress` / `Backlog` / `Blocked`; no vague “mostly done” |
| Version anchor | Root `package.json` and `git describe --tags`; currently `1.19.18` / `v1.19.18` |
| Remote parity | All five Git remotes must share the same `main` commit; community publishing is tracked separately from code mirrors |

## 1. Current core state

### 1.1 Positioning

SciFlow is a **local-first, auditable, end-to-end automated research workbench**: research question → literature evidence → hypothesis and protocol → sandbox experiment → critic loop → deterministic quality gates → submission package. Data stays in one local SQLite file; the model endpoint belongs to the user.

### 1.2 Release and repository state

| Item | Value | Evidence |
| --- | --- | --- |
| Version | `1.19.18` (root/server/web/desktop) | four `package.json` files |
| Code HEAD (verified) | `b9e7a05` | `git log -1`; later doc commits do not change product code |
| Tag | `v1.19.18` (annotated `1277112` → `b9e7a05`) | `git show-ref --tags` |
| Five remote `main` | all contain `b9e7a05` | `git ls-remote` × 5 |
| CI | run `45443174785`, three jobs green (`b9e7a05`) | GitHub Actions |
| Desktop installer | tag `v1.19.18` triggered run `45457644913`, succeeded; release assets `SciFlow-Setup-x64.exe`, `SciFlow-Setup-1.19.18-x64.exe`, `latest.yml` | GitHub Actions |
| Release body | `docs/RELEASE-NOTES.md`; `generate_release_notes` disabled | `.github/workflows/desktop-installer.yml` |

### 1.3 Runtime and code map

```text
React Web UI ──HTTP/SSE──> NestJS API ──> one SQLite file (WAL)
      │                        │
      │                        ├─ LangGraph pipeline (single DAG)
      │                        └─ LangGraph research-cycle (multi-round loop)
      └─ Electron shell (embedded server + auto-update plumbing)
```

| Layer | Location | State |
| --- | --- | --- |
| API | `apps/server/src` | 38 controllers across projects / documents / references / knowledge / pipeline / agent / research / submission / experiments / settings |
| Web | `apps/web/src` | React + Vite, hash router, SSE, PWA |
| Desktop | `apps/desktop` | Electron main process, packaging, auto-update |
| Shared types | `packages/core` | single source for pipeline steps and DTOs |
| Model layer | `packages/ai` | OpenAI-compatible / Anthropic / Gemini transports, prompts, mock gateway |
| Data | `packages/db` | Drizzle + SQLite, migration ledger |
| Retrieval | `packages/retrieval` | FTS5 + sqlite-vec + RRF + MMR |

### 1.4 Measured numbers

| Metric | Value | Scope |
| --- | --- | --- |
| Server tests | 972 passed / 1 skipped (140 test files) | Latest source gate |
| Web tests | 277 passed | same |
| Desktop tests | 5 passed | same |
| API regression | 237 PASS / 0 FAIL | `scripts/full_regression.py` (fresh DB + AI_MOCK=1) |
| Search P95 | service docs 1.26 ms; all types 3.90 ms; HTTP docs 4.44 ms | 10k rows |
| Tokens per run | 8,158 | matched against `llm_call_log` |
| PWA | 168 precache entries / 8,706.62 KiB; real update clears legacy cache | build `2026-11-23T18:37:54.791Z` |
| Real-model closed loop | one question → PI → expert gate → sandbox → critic → `synthesize`, `supported` twice, 22,199 / 16,681 tokens | cycle `230db717…`; see `docs/verification/assets/research-cycle-real-model-2026-11-24.md` |
| Real export | PDF 367,596 bytes; share token full journey incl. anonymous comment / soft delete / revoke | F-round browser acceptance |

### 1.5 Known gaps and blockers

| Priority | Gap | Fact | Handling |
| --- | --- | --- | --- |
| P0 | Research-cycle restart recovery | 1.19.17 had no `OnModuleInit`; in-memory `running` lock could survive a restart and leave a cycle non-terminal forever | Implemented in this stage (§3.1) |
| P0 | Full-auto stress coverage | `full_regression.py` covers API behaviour, not cycle concurrency/approval/budget/stagnation | New `scripts/research_cycle_stress.py` (§3.2) |
| P1 | Code debt hotspots | `packages/db/src/database.ts` migration logic; long `ResearchCycleService` / `PipelineService` methods; large `WorkspacePage` / `WritingPage` | Refactor backlog (§3.3) |
| P1 | Vector KB incremental upgrade | sqlite-vec ANN + FTS5 + RRF + MMR already exist; reranker eval, embedding versioning and dimension migration are missing | Incremental, not rebuild |
| P1 | Real-model long-run stability | The real model produced a domain-specific protocol (0.73 overlap) and triggered an actionable expert rejection; the gateway intermittently returns empty/timeout and can exhaust 3 structured retries | Fixed `pRetry` being short-circuited by `throw err` and tightened JSON key constraints; still need a fallback or local model at the gateway layer |
| P2 | Feishu connector credentials | No real webhook/app credentials; report marked BLOCKED with handover paths | Wait for user credentials |
| P2 | Five content communities | Five **Git remotes** are aligned; Zhihu/Juejin/CSDN/Cnblogs/Bilibili need login or API credentials | Never claim published without credentials |
| P2 | Real mobile PWA | Verified only on desktop Chromium | Add to acceptance |
| P3 | Version policy | `1.19.x` conflicts with the user's `0.0.x` preference | Product decision; do not renumber silently |

## 2. Delivered capabilities

> All items are `Delivered`. Only user-visible capabilities are listed; evidence is in parentheses.

### 2.1 Workspace

- Project create/archive/delete, project settings, research brief (`projects`, `research-brief`).
- Research dashboard: progress, activity, tasks, quality trend, usage (`dashboard`).
- Global search across documents/references/knowledge/chats; 10k P95 measured (`search`).
- Unified navigation and page shell, light/dark themes, project context bar.

### 2.2 Literature and evidence

- OpenAlex / Crossref / arXiv search and DOI enrichment (`references.service.ts`).
- Reference library, metadata editing, BibTeX/RIS import/export, citation graph.
- Single-paper deep read (three-pass prompt), cross-paper comparison, gap discovery.
- Zotero kept as a user-owned reference API; data still local.
- Citation jump-back and paragraph-level anchors; claim/evidence links.

### 2.3 Knowledge base and retrieval

- PDF, Word, Markdown, text, web, EPUB ingestion; inline `text` upload no longer hijacked by `.pdf` extension.
- Parsing, chunking, provenance, knowledge Q&A with source markers.
- FTS5 trigram + sqlite-vec `FLOAT[384]` + RRF + MMR + cross-chunk passage expansion.
- Local GGUF or remote OpenAI-compatible `/embeddings`; graceful fallback to full-text.
- UI shows vector degradation instead of silently degrading.

### 2.4 Research design and autonomous loop

- Objects: program → cycle → question → hypothesis → protocol → run → claim → evidence.
- Research-plan gates and deterministic `research.plan_audit` shared by REST, writing page and document quality gate.
- LangGraph loop: `plan(PI) → gate → execute → evaluate(Critic) → decide → revise / synthesize / end`.
- `human` approval via interrupt; `ai` approval by an independent expert with fail-closed errors.
- `L3+` auto-approval; `maxIterations` 1–10; `maxTokens` budget; `STAGNATION_LIMIT=2`.
- Repair: one compressed PI retry; one experiment repair with stderr; literature failure degrades to empty.
- Python sandbox with timeout/memory/output truncation/env allowlist; empty stdout is failure.
- **New**: restart recovery, cycle watchdog, manual checkpoint recovery API, health/metrics.
- **New**: mock gateway covers PI / expert / critic / experimenter; full-auto is no longer a concept demo.

### 2.5 Writing and review

- Long-form outline, section drafting, continuation, rewrite, academic polish, translation.
- Document versions, paragraph checkpoints, undo/restore.
- Citation audit: no references without a pool; anchor jump-back; residual citation hard fail.
- Paragraph-level reviewer anchors and revision queue.
- Writing page coupled to research-plan audit.

### 2.6 Quality

- Seven-dimension review: literature, logic, citation, language, novelty, figures, format.
- Project-level quality standard with global fallback.
- Deterministic objective checks separated from LLM review.
- Quality reports persisted; trend visualisation; release gate.

### 2.7 Experiment and verification

- Experiment / web / browser verification consolidated into one workbench.
- Python experiment execution with stdout/stderr/runtime/code snapshot.
- Playwright browser verification and screenshot evidence; remote-control page.
- Failed runs preserved; repair round overwrites the final result.

### 2.8 Submission and delivery

- Submission readiness check (structured checklist + pure functions).
- Journal matching, cover letter, submission email parsing, response letter.
- Submission ZIP: manuscript, figures, attachments, template, cover letter, metadata.
- Exports: PDF / DOCX / PPT / Excel; public read-only share, anonymous comments, soft delete, revoke.
- PWA offline reconnection shell; desktop installer and auto-update.

### 2.9 Agent and collaboration

- Agent tools, built-in academic MCP, external MCP, on-demand skills.
- Plan-level authorization, tool budgets, agent metrics, traces.
- Server-side chat sessions, pin/archive/search, branching, answer versions, attachments and multimodal input.
- Background jobs / subagent executor, scheduler, notifications and retries.
- Read-only shared conversation comments; cross-project session guard.

### 2.10 Operations and release

- SQLite WAL + busy timeout; migration ledger replaces `ensureColumn`.
- `/health`, `/health/deep`, `/metrics`; new research-cycle active / awaiting / blocked gauges.
- GitHub Actions: types / unit / build, E2E + prompt evals, full mock regression, desktop installer.
- Five Git remotes synced; `docs/RELEASE-NOTES.md` as the only release body source.
- OpenAPI 268 paths; chunk budget; lint / typecheck / build gates.

## 3. Backlog

> Order: fix reliability gaps that can lose long-running work, then capability upgrades, then brand and release. Every item needs an acceptance check.

### 3.1 P0 research-cycle reliability

| ID | Task | Acceptance | Status |
| --- | --- | --- | --- |
| R-01 | Startup recovery: scan non-terminal cycles; resume when checkpoint exists | Unit tests for resumed / blocked / awaiting; real restart continues | **Accepted**: unit + real restart PASS |
| R-02 | No checkpoint → blocked, preserve existing claims | No fake resume; UI offers one-click retry | Implemented |
| R-03 | Cycle heartbeat watchdog | No heartbeat over threshold → blocked, release lock, close trace; never kill `awaiting_approval` | Implemented + unit tests |
| R-04 | Manual recovery API + UI | `POST /research-cycles/:id/recover`; blocked panel shows “Resume from checkpoint” | Implemented |
| R-05 | Budget gate before execution | If plan already exceeded budget, do not run experiment | Implemented + graph test |
| R-06 | Real process restart integration | Human-approval pending → kill server → restart → still awaiting → resume completes | **Accepted**: five-node restart matrix all PASS |
| R-07 | Mid-execution restart recovery | Kill during execute → restart auto-resumes; needs controllable slow mock | **Accepted**: PASS; `runs=1`, replay does not duplicate the run |
| R-07b | Plan/evaluate/revise restart | Kill at plan, evaluate or revise; claims, evidence and runs must not duplicate | **Accepted**: matrix PASS; evaluate rebuilds evidence (`evidence=2`), revise ends `claims=2/runs=2` |
| R-08 | Idempotent and concurrent start | One active cycle per program; duplicate start creates no second cycle | **Accepted**: 8 concurrent → 1×201 / 7×400, cycles=1, active=0 |
| R-09 | Protocol rewrite after expert rejection | Rejection feeds the PI; at most 2 rewrites; stop only after repeated rejection | **Implemented**: graph tests cover reject-then-approve and reject-to-limit |

### 3.2 P0 full-auto stress

| ID | Task | Acceptance | Status |
| --- | --- | --- | --- |
| S-01 | Stress script | `scripts/research_cycle_stress.py`: concurrency, human approve/reject, expert reject, budget, stagnation | Implemented, 11/11 PASS; latest build 25/25 PASS |
| S-02 | Repair-path stress | SyntaxError → repair success; repeated failure → blocked/failed | **Accepted**: API-level PASS; attempt1 fail → attempt2 ok, claims=1/runs=1 |
| S-03 | Soak test | 20–50 cycles, low concurrency, no deadlock / lock leak / DB busy | **Accepted**: 20 autos + 5 edge cases, 25/25 PASS, active=0/blocked=0 at end |
| S-04 | Restart matrix | Kill at plan/gate/execute/evaluate/revise, verify recovery or blocked | **Accepted**: 5/5 PASS (gate covered by human-approval hang) |

### 3.3 P1 refactor

| ID | Hotspot | Problem | Action |
| --- | --- | --- | --- |
| C-01 | `packages/db/src/database.ts` | Centralised imperative schema/migration logic | Split into migration modules + registry; keep idempotent |
| C-02 | `ResearchCycleService` | Recovery, watchdog and state projection in one long service | Split recovery / runner / projection |
| C-03 | `PipelineService` | Long methods and many branches | Extract command objects per step; keep SSE contract |
| C-04 | `WorkspacePage` / `WritingPage` | Large pages, data/view coupling | Container/view/hooks; tests before split |
| C-05 | Mock vs real prompt contract | Easy to pass mock but fail real model | Every mock rule must match a real prompt feature and have a contract test |
| C-06 | Dead code / dead branches | Typical AI-generated debt | Static scan + coverage + file-by-file audit; no evidence-free rewrite |

> Principle: low coupling, high cohesion, function/module extraction, behaviour unchanged, tests first.

### 3.4 P1 capability gaps

| ID | Capability | Current | Next |
| --- | --- | --- | --- |
| K-01 | Vector KB | sqlite-vec 384d + FTS5 + RRF + MMR | Reranker eval, embedding versioning, dimension migration, golden set |
| K-02 | Prompt coverage | PI / experimenter / critic / expert main chain | Branch matrix: drift, expert reject, experiment failure, budget, stagnation, empty literature |
| K-03 | OpenCode ecosystem | Tools / skills / MCP / approvals exist | Reuse mature primitives only: tool registry, permissions, sessions, diagnostics; no unrelated features |
| K-04 | Auditable evidence | claim/evidence/run persisted | Evidence coverage and hard gate for unsupported claims |
| K-05 | Project quality gate | Seven-dimension review | Auto-fix suggestions and quality regression |

### 3.5 P1 delivery and brand

| ID | Task | Acceptance |
| --- | --- | --- |
| D-01 | README capability matrix | Use the 24 existing screenshots for dashboard/pipeline/programs/knowledge/quality/writing/submission/settings |
| D-02 | Motion and empty states | Page transitions, loading, error, empty, recovery hints; no performance regression |
| D-03 | Onboarding | First-use guide, key-action explanations, destructive-action confirmation |
| D-04 | Friendly failure states | Blocked / lost checkpoint / missing model / vector degradation all give next action |
| D-05 | Mobile PWA acceptance | One real iOS and one Android device; offline shell and reconnect |

### 3.6 P2 release dependencies

| ID | Task | Blocker |
| --- | --- | --- |
| P-01 | Feishu real connector | Missing webhook/app credentials; never fake success |
| P-02 | Five content communities | Missing login/API credentials; prepare a launch kit, do not claim published |
| P-03 | Version policy | `1.19.x` vs `0.0.x` decision; change all four packages once |
| P-04 | Desktop signing | Windows installer exists; signing / SmartScreen pending |

## 4. Roadmap

> No date promises; only exit criteria. Every completed milestone updates §1/§2 with evidence links.

### M0 Baseline alignment (current)

**Goal**: four-module baseline, five remotes identical, 1.19.18 evidence reproducible.

**Exit**:
- This file merged and synced to five remotes;
- `docs/README` and root README link here;
- 1.19.18 metrics match the acceptance report.

### M1 Research-cycle reliability (in progress)

**Goal**: long-running work is not lost, stuck, or invisible.

**Exit**:
- R-01 ~ R-05 have unit tests;
- R-06 real restart evidence (logs + cycle JSON);
- S-01 25/25 PASS; S-03 20+ cycles with no lock leak;
- `/health/deep` and `/metrics` expose active / awaiting / blocked.

### M2 Code and prompt normalisation

**Goal**: remove structural AI-generated debt; prompts cover all branches.

**Exit**:
- C-01 ~ C-04 done with behaviour unchanged and full regression green;
- Every new branch prompt has a contract test;
- Static scan shows no new dead branches/duplicate modules; complexity hotspots have before/after numbers.

### M3 Capability depth and open-source integration

**Goal**: upgrade vector KB and evidence chain; absorb mature engineering primitives only where they serve the research loop.

**Exit**:
- K-01 golden set and reranker evaluation with baseline/improvement numbers;
- K-04 unsupported claims are hard-blocked;
- Every third-party capability has an explicit binding point to the research chain.

### M4 Product delivery and brand

**Goal**: deployable, demonstrable, publishable.

**Exit**:
- Full gates + stress + real/local model runs;
- README capability matrix and screenshots complete;
- Five Git remote releases synced; five community launch kits ready (publish only with credentials);
- Desktop installer installs/upgrades; mobile PWA accepted.
