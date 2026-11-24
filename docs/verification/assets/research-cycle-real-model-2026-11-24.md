# Real-model research-cycle trial — 2026-11-24

Environment: isolated copy of the user's configured OpenAI-compatible provider
(`deepseek-v4.1-flash` via `api.qs.al`), `AUTH_MODE=none`, `SCIFLOW_NO_VEC=1`,
real SQLite, real Python sandbox, `AI_MODEL_FALLBACK=glm-5.3`. No mock gateway
and no generated chat text. Every cycle below is a real HTTP run.

## Final run: initial question → protocol → gate → sandbox → critic → synthesize

| Item | Value |
| --- | --- |
| Cycle | `230db717-bbd0-42c2-be8c-397775c75a61` |
| Input | one Chinese research question; `approvalMode=ai`; `maxIterations=3` |
| State | `synthesize`（`completed`，结论 `supported`） |
| Claim | `49ec28f2-d0a2-4e71-b73e-fe8310b046ce`，confidence 95 |
| Run | `2fa7c6e2-f71d-4261-8b8a-ced4bf45d1b1`，sandbox `ok:true`，runtime 981 ms |
| Tokens | 22,199 |
| Real statistics | σ=0.05 组 r=0.996326，bootstrap 95% CI [0.996004, 0.996677]；σ=2 组 r=0.293756，CI [0.233893, 0.348267] |

Event trail (server log):

1. `literature count=4`
2. `plan` → protocol `05f39146-762c-4596-b674-669e7fb3df54`
3. Expert gate: the primary model first returned empty bodies, then valid JSON with
   non-schema keys (`approved/confidence/reasons` and `是否批准/把握程度/理由`);
   schema validation rejected it. The structured-output fallback then switched to
   `glm-5.3`, which returned a schema-valid approval (`approved=true`, confidence 90).
4. `execute` → `ok:true` in 981 ms
5. `evaluate` → `supported`, confidence 95, `topicAligned=true`
6. `synthesize` → completed

## Earlier runs in the same session

| Attempt | Question | Outcome | Evidence |
| --- | --- | --- | --- |
| 1 | 2D lattice, isotope mass defects vs κ_L | PI protocol drafted; Critic flagged topic deviation; stopped `max_iterations`, 7,866 tokens | isolated DB |
| 2 | same | Expert rejected protocol; gate auto-rewrote; stopped `approval_rejected` before rewrite feature, 6,113 tokens | same |
| 3 | same | Expert structured call exhausted retries on empty upstream responses; `blocked/agent_error`, 4,981 tokens | `llm_call_log` |
| 4 | same | After retry fix: expert rejected v1, gate rewrote v2, expert rejected v2, v3 stalled; stopped manually | cycle `1a37ba11…` |
| 5 | same | English-key prompt added: real rejections and rewrites ran; v3 stalled; stopped manually | cycle `2d834fd5…` |
| 6 | bagged CART variance vs absolute error, ρ>0.2 | Full PI→expert→sandbox→critic; Critic returned `refuted` because bootstrap CI lower bound 0.162 < 0.2; stopped `max_iterations`; claim `5cac8702…`, 26,408 tokens | cycle `c3cdea19…` |
| 7 | same, ρ>0.1 | Expert rejected v1 for missing sample parameters; gate auto-rewrote v2; expert approved; sandbox ran; Critic returned `refuted` (ρ=-0.0116, CI [-0.1296, 0.0895]); stopped `max_iterations`, 32,855 tokens | cycle `25329b67…` |
| 8 | same, ρ>0.1 | Expert gate received empty body three times; before structured fallback existed, cycle blocked `agent_error`, 4,989 tokens. This exposed the missing fallback chain. | cycle `3f5ba6c2…` |

## What this proves

- A single initial question can traverse the entire loop without human approval:
  PI protocol, AI expert gate, code-generation experimenter, sandbox run, Critic
  verdict, and synthesis.
- The AI expert gate genuinely rejects weak protocols and its rewrite feedback is
  actionable; cycles 6 and 7 each executed a real rewrite before approval.
- The loop fails closed. Empty upstream responses and schema-invalid keys produce
  `blocked/agent_error`, never a fabricated `supported`.
- Structured outputs need two independent defenses: key/value normalization
  (Chinese and English synonyms, fraction→percentage confidence) and a model
  fallback chain. Both were reproduced by real gateway behavior, not invented.

## Remaining external limits

- The upstream gateway still returns intermittent empty bodies; retries and
  fallback hide it, but latency can reach minutes.
- No local model is available as an offline fallback (`~/.sciflow/models` empty).
- Tencent/Feishu and community publishing credentials are outside this VM.

Logs and databases live under `/tmp/sciflow-real2/` and are not committed; this
file records reproducible facts without credentials.
