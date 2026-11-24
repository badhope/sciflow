# Real-model research-cycle trial — 2026-11-24

Environment: isolated copy of the user's configured OpenAI-compatible provider
(`deepseek-v4.1-flash` via `api.qs.al`), `AUTH_MODE=none`, `SCIFLOW_NO_VEC=1`,
fresh server process, real SQLite, real sandbox.

This is an engineering trial, not a marketing claim. Every cycle below is a real
HTTP run; no mock gateway and no generated chat text.

## Results

| Attempt | Question | Outcome | Evidence |
| --- | --- | --- | --- |
| 1 | 2D lattice, isotope mass defects vs κ_L | PI produced a protocol with 0.73 topic overlap; Experimenter generated a generic error/uncertainty proxy; Critic flagged severe topic deviation; stopped `max_iterations`, claims=1, runs=1, 7,866 tokens | `research_cycle` / `research_run` in the isolated DB |
| 2 | same | PI protocol accepted by human gate; AI expert rejected it for missing falsifiability thresholds and confidence intervals; stopped `approval_rejected` before the gate-rewrite feature, 6,113 tokens | same |
| 3 | same | AI expert structured-output call exhausted retries with empty upstream responses; blocked `agent_error`, 4,981 tokens | `llm_call_log` + server log |
| 4 | same | After fixing the retry short-circuit and tightening the experimenter/JSON prompts: expert rejected protocol v1 with actionable changes; gate rewrote protocol v2; expert rejected v2 for a remaining gray zone; protocol v3 was started, then the upstream gateway stalled on repeated empty responses; the trial was stopped manually | `server4.log`, cycle `1a37ba11…` |
| 5 | same | After adding explicit English-key JSON constraints: expert returned a real rejection; gate auto-rewrote v2; expert rejected v2; v3 plan call stalled on upstream empty responses; stopped manually | `server5.log`, cycle `2d834fd5…` |

## What this proves

- The real model can produce domain-grounded hypotheses and protocols, not only chat text.
- The AI expert gate really rejects weak protocols, and its reasons are actionable.
- The gate→plan rewrite path executes in a real process, not only in a unit test.
- The remaining blocker is upstream gateway availability: empty responses and
  timeouts can exhaust structured-output retries. The product fails closed
  (`blocked`/`agent_error`) instead of fabricating a result.

## What remains

- Add a fallback model or local model for structured roles when the primary
  gateway returns empty responses.
- Run a full real-model cycle to `synthesize` once the gateway is stable.
- The mock 20+5 stress remains the deterministic regression gate: 25/25 PASS.

Logs and databases are under `/tmp/sciflow-real/` on the test VM and are not
committed; this file records the reproducible facts without credentials.
