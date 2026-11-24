# Research-cycle prompt branch matrix

> Purpose: turn “fully autonomous research” into a checkable branch list. Every branch answers three questions: **who triggers it, what the prompt contract is, and which test proves it was exercised.**
> Baseline: `v1.19.17` / `d9dc71b` plus the uncommitted changes in this stage.

## 0. Engineering rules

1. **Prompts describe roles and decision criteria, not orchestration.** LangGraph owns the flow; prompts own reasoning.
2. **All structured output uses `generateObject + zod`.** No hand-written JSON extraction or regex repair; parse failure becomes `agent_error`, never a silent fallback.
3. **Mock rules must match real prompt features.** Match explicit markers in the last user message (`【研究问题】`, `【协议设计】`, etc.), not guesses about the system prompt.
4. **A new branch needs a graph test + mock rule (when mocked) + a row here.** Code without evidence is not done.

## 1. Branch table

| Branch | Trigger | Prompt / contract | Deterministic behaviour | Evidence |
| --- | --- | --- | --- | --- |
| First plan | Cycle starts, `iteration=0` | PI: echo the question verbatim, falsifiable hypothesis, executable protocol; ≤120s and ≤2000 simulated records | Creates hypothesis/protocol; enters gate | `research-cycle.graph.spec.ts` supported case |
| Revision | Prior `refuted`, under max iterations | PI receives `priorFeedback + priorVerdict`; must change the design, not rephrase it | `iteration+1`, new protocol | `refuted → revise → second round` |
| Human approve | `approvalMode=human`, gate interrupt | Gate performs approval only; no side effects before interrupt | `resume(approved=true)` continues | `human approve resumes and completes` |
| Human reject | Same, `approved=false` | Rejection reason not fed back; terminate this cycle | `stopReason=approval_rejected`, no experiment | `human reject stops` |
| AI expert approve | `approvalMode=ai`, L3+ | Expert independently judges executability/scope; fail-closed | Enters execute | `AI expert approves, no human interrupt` |
| AI expert reject | Expert returns `approved=false` | Same; mock rejects when the question contains “拒批” | `approval_rejected`, no experiment | `AI expert reject stops` |
| Expert unavailable | Expert throws / structured output fails | Failure must not default to approve | `agent_error` → blocked | `expert unavailable is fail-closed` |
| Experiment success | Sandbox `status=ok`, non-empty stdout | Experimenter translates protocol to Python and prints statistics | Run completed; enters evaluate | `supported ends in one round` |
| Script too short / no print | Code <40 chars or no `print(` | Repair prompt: complete script + statistics | First attempt failed; one repair | `import-only script fails and repairs` |
| Execution failure | stderr / timeout / non-zero | Experimenter receives `previousError`, repairs once | Second failure → `runFailed=true`; Critic sees insufficient evidence | Graph spec; S-02 API stress pending |
| Critic supported | `verdict=supported` | Critic quotes must exist in stdout; no invented evidence | Claim + evidence; decide terminates | `supported` case; mock critic |
| Critic refuted | `verdict=refuted` | Same; feedback/revisionHint required | Revise; repeated design+verdict triggers stagnation | `refuted loop`; `stagnation` |
| Critic inconclusive | Critic throws / invalid output | Do not invent a verdict | `inconclusive`, then decide | `critic.agent.spec.ts`; graph failure case |
| Budget after plan | `tokensSpent >= maxTokens` at gate | Budget gate before experiment; no “run first, judge later” | `budget_exceeded`, 0 runs | `plan over budget never executes` |
| Budget after experiment | Experiment done but budget exceeded | Decide prioritises budget over rounds/stagnation | `budget_exceeded` | `budget exhausted terminates` |
| Max iterations | `iteration >= maxIterations` | Explicit reason priority | `max_iterations` | `max iterations terminates` |
| Stagnation | Two consecutive rounds with same design fingerprint and verdict | Fingerprint normalises wording; rephrasing is not a change | `stagnation` | `same design + same verdict stagnates` |
| Literature failure | OpenAlex/Crossref throws | Literature is background only, never experiment evidence | Degrades to empty references; loop continues | `literature failure degrades` |
| Restart: awaiting | Restart with `awaiting_approval` | Do not auto-run; preserve checkpoint | Stays awaiting until human resume | `research_cycle_restart_test.py` human PASS |
| Restart: executing | Restart with `execute` and checkpoint | Auto `invoke(null)`; execute replay finds run by cycle+protocol+iteration | Completed run reused; unfinished run reuses same record | restart test PASS; `replay reuses completed run` |
| Restart: no checkpoint | Non-terminal but no checkpoint | Never fake a resume | Blocked; keep claims/runs | recovery spec `no checkpoint → blocked` |
| Watchdog timeout | Active and no heartbeat beyond `RESEARCH_CYCLE_WATCHDOG_MINUTES` | Every node reports heartbeat | Blocked, release lock, close trace; ignore late return | recovery spec `watchdog active` |
| Watchdog orphan | Non-terminal DB row, no process lock, stale `updatedAt` | Never kill awaiting | Blocked | recovery spec `watchdog DB orphan` |
| Manual recovery | Blocked with checkpoint | Only non-executing states; reject without checkpoint | `POST /recover` resumes | recovery spec + UI blocked case |

## 2. Stop-reason priority

`gate budget` → `human/expert rejection` → `post-experiment budget` → `max iterations` → `stagnation` → `completed`.

> Why budget precedes supported: the old order checked `supported` first, so `maxTokens=1` still ran the experiment and synthesized. Budget must gate before new cost.

## 3. Known gaps

- **Real-model prompt eval does not cover all branches.** Mock branches are green; real models only verified the main path. Rejection, stagnation and budget branches remain deterministic-mock only.
- **S-02 API-level repair-path stress is missing.** Graph unit covers “SyntaxError → repair”, but not real HTTP + sandbox failure injection.
- **S-04 restart matrix only covers gate/execute.** Kill at plan/evaluate/revise remains.
- **Prompts have no independent version.** Add `promptVersion` to run manifest for reproducibility.

## 4. Next actions

1. Run real-model rejection/budget/stagnation branches and record outputs + stop reasons.
2. Add `MOCK_EXPERIMENT_FAIL_ONCE` failure injection for S-02.
3. Extend restart test to plan/evaluate/revise for S-04.
4. Version prompts into run manifests and quality reports.
