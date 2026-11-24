# AI Research Assistants: Competitive Landscape, Scope Boundaries and Feasibility

> Baseline: `v1.19.17` / `d9dc71b` (verified 2026-11-24).
> This document answers three questions: where SciFlow differs from general AI apps, what open-source research tools do well and poorly, and why an end-to-end autonomous research loop is feasible.
> Vendor claims and independent evidence are labelled separately.

## 1. Conclusions first

1. **General AI apps are strong at find–read–write, not at finishing research.** OpenAI Deep Research, NotebookLM, Elicit, Consensus and SciSpace mostly stop at retrieval, synthesis and writing/presentation. Experiment design, sandbox execution, critic loops, deterministic quality gates and submission packages are absent or partial.
2. **Open-source research tools are strong on self-hosting, model choice and ingestion, weak on closed loop, auditability and delivery.** Open Notebook is a knowledge/notebook layer, GPT Researcher is deep reporting, PaperQA2 is literature QA, AI Scientist is a narrow paper generator. None combines local-first, evidence chain, experiment execution, quality gates and submission.
3. **SciFlow's differentiation is not another paper summariser. It is local-first + auditable evidence chain + multi-round research loop + deterministic quality gates + submission delivery.** The loop already exists in 1.19.17 with real LangGraph and a real Python sandbox; the gaps are reliability, observability and prompt coverage, not missing concepts.
4. **“Fully autonomous” must be graded and braked.** Support L2 (human approves protocol) and L3 (AI expert approval + audit). L4 unattended is not a current promise. Without budget gates, stagnation detection, restart recovery and evidence coverage, autonomy only hallucinates faster.

## 2. Landscape

### 2.1 General AI apps

| Product | Verified capability | Boundary | Source |
| --- | --- | --- | --- |
| OpenAI Deep Research | Reasons over web/files, plans multi-step research, uses Python, outputs structured reports with citations and source lists; plan can be reviewed/edited | Web/file research, not local experiment execution, research object model, quality gates or submission; cloud-hosted | [Help centre](https://help.openai.com/en/articles/10500283-deep-research), [API](https://developers.openai.com/api/docs/guides/deep-research) |
| Google NotebookLM | Source-grounded Q&A with exact quotes/citations; PDF/web/YouTube/audio/Google Docs; Audio/Video Overviews, mind maps, study guides | Knowledge/understanding tool, no academic corpus search, no experiments, no submission; cloud | [Product](https://notebooklm.google), [Education](https://edu.google.com/ai-notebooklm/) |
| Elicit | 138M+ papers, 545k clinical trials; Research Agent across databases/journals/public data/uploads; reports, tables, figures, bioinformatics, slides; systematic-review screening and extraction; sentence-level citations; API/MCP | Retrieval and evidence synthesis; no experiment execution, no local deployment, no full submission package; extraction still needs human verification | [Elicit](https://elicit.com/) |
| Consensus | 200M+ academic documents from Semantic Scholar, OpenAlex and own crawl; search-before-synthesis; citations per answer; Consensus Meter, Deep Review, Citation Graph; API/MCP | Evidence Q&A / review; no experiment design/execution, full writing or submission; cloud | [Consensus libraries](https://consensus.app/home/resources/consensus-for-university-libraries/) |
| SciSpace | 280M+ multi-database corpus (Google Scholar/PubMed/arXiv/OpenAlex/Semantic Scholar); PDF chat, cross-paper extraction, systematic review, AI Writer + reference management, 500+ agents | Covers search–read–write; no local experiment execution or deterministic quality gates; cloud | [SciSpace vs Elicit](https://scispace.com/compare/elicit) |

### 2.2 Open-source research tools

| Project | Strengths | Gaps | Source |
| --- | --- | --- | --- |
| Open Notebook | MIT; self-hosted; 20+ providers incl. Ollama/LM Studio/OpenAI-compatible; PDF/video/audio/web/Office ingestion; full-text + vector search; cited chat; REST API/MCP; FastAPI + Next.js + SurrealDB | NotebookLM replacement: knowledge, notes, chat, podcasts; no hypothesis, protocol, Python sandbox, quality gates or submission | [GitHub](https://github.com/lfnovo/open-notebook) |
| GPT Researcher | Planner/executor/publisher agents; web + local docs; cited reports; recursive deep research; MCP; PDF/Word export; per-report cost | Report is the endpoint; no experiment execution, research object graph, deterministic gates or submission | [GitHub](https://github.com/assafelovic/gpt-researcher) |
| PaperQA2 | Scientific RAG agent; full-text index, paper search, evidence gathering, citation graph; dense retrieval + LLM rerank/contextual summarisation (RCS); local docs, citation tracing; authors report superhuman LitQA2 performance | Literature QA/synthesis; no experiments, full manuscript pipeline or submission; “superhuman” is a specific benchmark claim | [FutureHouse](https://www.futurehouse.org/research-announcements/wikicrow), [paper](https://arxiv.org/pdf/2409.13740v2) |
| The AI Scientist | End-to-end idea → experiment → paper → review; NanoGPT/2D Diffusion/Grokking templates; LaTeX papers and LLM reviews | GPU/template-bound; executes LLM-written code and officially requires containerisation/network restriction; no broad research scope, quality gates or submission | [GitHub](https://github.com/SakanaAI/AI-Scientist) |

### 2.3 Engineering reference: OpenCode

OpenCode is an open-source coding agent with CLI, desktop, web and Docker forms, multiple providers, config, plugins, MCP, commands and permissions ([docs](https://opencode.ai/docs/)). SciFlow should absorb the engineering skeleton, not the coding UI:

- tool registry and permission boundaries;
- session/task lifecycle, background work, cancellation;
- MCP/plugin ecosystem loaded on demand;
- diagnostics, tool traces and context budgets.

Do **not** absorb: general IDE features, coding-specific UI, plugin-market bloat.

## 3. Capability matrix

> `●` full; `◐` partial/limited; `○` absent or unverified. “Experiment execution” means real code/data execution, not generating a protocol.

| Dimension | SciFlow | Elicit | Consensus | SciSpace | NotebookLM | Deep Research | Open Notebook | GPT Researcher | PaperQA2 | AI Scientist |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Academic corpus search | ● OpenAlex/Crossref/arXiv | ● 138M+ | ● 200M+ | ● 280M+ | ○ | ◐ web/files | ◐ own sources | ● web+local | ● local index | ◐ Semantic Scholar/OpenAlex |
| Sentence/paragraph citations | ● | ● | ● | ● | ● | ● | ● | ● | ● | ◐ |
| Systematic review/extraction | ◐ evidence + claim/evidence | ● PRISMA/screen/extract | ◐ Deep Review | ● | ○ | ○ | ○ | ○ | ◐ | ○ |
| Deep read/cross-paper compare | ● | ● | ● | ● | ● | ◐ | ● | ◐ | ● | ◐ |
| Hypothesis/protocol generation | ● PI agent | ◐ research questions/report | ○ | ◐ agent | ○ | ◐ research plan | ○ | ○ | ○ | ● template-bound |
| Sandbox experiment execution | ● Python sandbox | ○ | ○ | ○ | ○ | ◐ Python tool | ○ | ○ | ○ | ● GPU/container |
| Multi-round critic loop | ● Critic→decide→revise | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◐ one generate-review pass |
| Deterministic quality gates | ● seven dims + objective checks | ◐ citation check | ◐ citation jump | ◐ | ○ | ○ | ○ | ○ | ◐ | ○ |
| Full manuscript/format | ● longform + export | ◐ report | ○ | ● AI Writer | ◐ study material | ◐ report | ○ | ◐ report | ○ | ● LaTeX template |
| Submission package/journal match | ● readiness + ZIP + cover letter | ○ | ○ | ◐ format/citation | ○ | ○ | ○ | ○ | ○ | ○ |
| Local-first/self-host | ● single SQLite/desktop | ○ cloud | ○ cloud | ○ cloud | ○ cloud | ○ cloud | ● Docker | ◐ self-hostable | ● local index | ● local code |
| Model freedom | ● local/remote multi-protocol | ○ | ○ | ○ | ○ | ○ | ● 20+ | ● multi-LLM | ● configurable | ● multi-model |
| Restart recovery/watchdog | ● new in this stage | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| Cost/budget control | ● token budget + usage | ◐ subscription quota | ◐ | ◐ | ○ | ◐ | ◐ | ● cost tracking | ◐ | ◐ |
| Auditable evidence chain | ● claim→evidence→run→code/stdout | ◐ citations | ◐ citations | ◐ citations | ◐ citations | ◐ source list | ◐ citations | ◐ sources | ● citations | ◐ paper |

### 3.1 Scope boundary: general AI vs research assistant

| Job | General AI | What SciFlow should own |
| --- | --- | --- |
| “What is new in this field?” | Strong: search + synthesis | Do it, but persist evidence and citation anchors |
| “Find 20 papers and extract variables” | Strong: Elicit/SciSpace | Do it with local retention and claim binding |
| “Is this hypothesis true? Design an experiment that can test it.” | Weak: proposes only | **Core difference**: protocol → sandbox code → real stdout → Critic verdict |
| “The result refutes it. What next?” | Weak: one-shot answer | **Core difference**: multi-round revision + stagnation + feedback |
| “Can this manuscript be submitted, where, and is the package complete?” | Weak: advice only | **Core difference**: deterministic readiness + journal match + ZIP + cover letter |
| “Data cannot leave this machine.” | Cloud products fail | **Core difference**: local SQLite + local model endpoint |
| “I need to reproduce this conclusion in three months.” | Weak: chat history is not evidence | **Core difference**: run/code/stdout/evidence persisted |

### 3.2 Open-source strengths and gaps

**Absorb**

- Self-hosting and model freedom: Open Notebook's provider matrix; PaperQA2's configurable LLM/embedding/vector store; AI Scientist's multi-model support.
- Ingestion breadth: PDF/video/audio/web/Office (Open Notebook), PDF/Office/code/figures (PaperQA2).
- Retrieval quality: PaperQA2's dense retrieval + LLM rerank + contextual summarisation (RCS).
- Deep-research orchestration: GPT Researcher's planner/executor/publisher and recursion; AI Scientist's idea→experiment→paper→review.
- Engineering skeleton: OpenCode's tools/permissions/sessions/MCP/plugins.

**Do not copy**

- Most projects stop at knowledge/report/Q&A and lack a research object model (hypothesis/protocol/run/claim/evidence), so they cannot audit a multi-round loop.
- AI Scientist is a loop, but template/GPU-bound and executes LLM code; it is not a general research workbench.
- Open-source citations are answer-level, not conclusion→evidence→experiment-output verification.
- Self-hosting is not safety: local models hallucinate and sandboxes can be escaped; deterministic gates and permissions are mandatory.

## 4. Differentiation path

### 4.1 Irreplaceable points

1. **Local data sovereignty**: one SQLite file for projects, references, knowledge, experiments, manuscripts, submission packages; user-owned model endpoint.
2. **Auditable evidence chain**: every claim points to evidence, evidence points to run code/stdout; unsupported claims are hard-blocked.
3. **A real research loop**: protocol → sandbox execution → Critic verdict → revision → re-execution; human or AI expert approval, fail-closed.
4. **Deterministic quality gates + submission delivery**: seven-dimension review plus objective checks; readiness, journal match, ZIP, cover letter.
5. **Long-run reliability**: checkpoint recovery, heartbeat watchdog, budget gate, stagnation detection, traces. This is what makes “autonomous” real.

### 4.2 Learn / do not learn

| Source | Learn | Do not learn |
| --- | --- | --- |
| Elicit | Systematic-review screening/extraction, sentence citations, API/MCP | Cloud-only, no experiments, no local sovereignty |
| Consensus | Search-before-synthesis, Consensus Meter, citation jump, retraction exclusion | Evidence Q&A only |
| SciSpace | Multi-database search, PDF chat, cross-paper extraction, writer + references | Cloud-only, writing as endpoint |
| NotebookLM | Source grounding, exact quotes, multimodal ingestion, audio/video expression | Understanding only, no research loop |
| OpenAI Deep Research | Reviewable plan, source list, long-report structure, Python tool | Cloud-only, no research objects/quality gates/submission |
| Open Notebook | Self-hosting, provider matrix, ingestion, REST/MCP | Knowledge/notes/podcasts only |
| GPT Researcher | Planner/executor/publisher, recursive depth, cost tracking | Report as endpoint |
| PaperQA2 | RCS rerank, citation graph, retraction checks, local index | Literature QA only |
| AI Scientist | Idea→experiment→paper→review, template reproducibility | Fixed templates/GPU, no general gates or submission |
| OpenCode | Tool registry, permissions, sessions, MCP, diagnostics | General IDE/plugin bloat |

## 5. Feasibility of releasing AI research potential

### 5.1 Why it can work now

1. **Infrastructure is mature**: LangGraph provides persistent checkpoints, interrupt/resume and multi-round graphs; SQLite + sqlite-vec + FTS5 gives usable hybrid retrieval on one machine; Python sandboxes execute real statistical experiments.
2. **The product skeleton exists**: 1.19.17 already has program/cycle/question/hypothesis/protocol/run/claim/evidence, four agent roles, human/AI approval, budget/stagnation/repair branches.
3. **Real chain tested**: this stage's stress run used real HTTP + real Python sandbox + real LangGraph under `AI_MOCK=1`; 11/11 passed, covering concurrent autonomy, human approve/reject, expert reject, budget exhaustion and stagnation.
4. **Risks can be engineered**: budget gates, stagnation, fail-closed expert review, restart recovery, watchdog and deterministic gates are testable artifacts, not model self-discipline.

### 5.2 Autonomy levels

| Level | Definition | Human role | Use case | Current |
| --- | --- | --- | --- | --- |
| L0 | Q&A / summarisation | Human does research | Quick orientation | Supported |
| L1 | Workflow automation | Human gives steps | Extraction, format checks | Supported |
| L2 | Loop with protocol approval | Human approves protocol | Most real research | Supported (default) |
| L3 | AI expert approval + audit | Human reviews terminal state/exceptions | High-throughput low-risk exploration | Supported (configurable) |
| L4 | Unattended long-run | Human only on exceptions | Future, not promised | Not promised |

> The barrier to L3 is not a stronger model; it is stronger audit and brakes.

### 5.3 Three paths

**Path A — reliability first (current)**

- R-01~R-08: startup recovery, watchdog, manual recovery, budget gate, real restart, soak.
- Acceptance: kill → resume or explicit blocked; 20+ cycles without lock leak; `/metrics` exposes state.

**Path B — evidence chain and quality gates**

- claim must bind evidence; evidence must point to run code/stdout; unsupported claims hard-blocked.
- Seven-dimension + deterministic checks + project standard; submission readiness reuses the same gate.
- Acceptance: any conclusion can be clicked back to experiment output; deleting evidence demotes/blocks the claim.

**Path C — ecosystem and depth**

- Absorb PaperQA2 RCS, Open Notebook provider matrix, OpenCode tool/permission skeleton.
- Vector KB incremental upgrade: reranker, embedding versioning, dimension migration, golden set; do not rebuild existing RRF/MMR.
- Acceptance: reproducible improvement on a golden set; every third-party capability bound to the research chain.

### 5.4 Risks and brakes

| Risk | Symptom | Brake |
| --- | --- | --- |
| Citation hallucination | References that do not exist | No citations without a reference pool; sentence jump; citation audit |
| Synthetic overreach | Proxy experiment presented as real finding | Sandbox goal marked “proxy simulation”; Critic must state limits |
| p-hacking / trial-and-error | Tweaking thresholds until significant | Budget/round/stagnation caps; design hash; no best-only reporting |
| Unsafe code execution | LLM code deletes files or calls network | Container/sandbox, env allowlist, timeout/memory/output caps, no network |
| Cost runaway | Infinite loop burning tokens | Budget gate before execution, usage reconciliation, watchdog |
| Irreproducibility | Lost chat history, model drift | run/code/stdout/evidence persisted; checkpoints; version anchor |
| Fake autonomy | Pipeline finishes but nobody can audit | Evidence coverage, traces, human/AI approval points |

### 5.5 Success metrics

| Metric | Direction | Scope |
| --- | --- | --- |
| Autonomous completion rate | ≥ 95% in mock/controlled cases | Reaches synthesize or explicit stop reason |
| Recovery success | 100% with checkpoint | Kill → restart → resume or explicit blocked |
| Evidence coverage | 100% claims have evidence | Zero unsupported claims |
| Budget overrun | 0 | Plan over budget never executes |
| Soak without lock leak | 20+ cycles, 0 stuck | Locks, heartbeat, DB busy |
| Cost per cycle | Within configured cap | Token reconciliation |
| Human intervention | Only exceptions at L3 | Approvals, rejects, recovery |

## 6. Recommendations

### This quarter (reliability + baseline)

1. Real restart acceptance (R-06) and soak (S-03).
2. Expose research-cycle metrics in desktop tray and ops docs.
3. Merge the four-module baseline and sync five remotes.
4. Add README capability screenshots using existing assets.

### Next quarter (evidence + refactor)

1. Hard gate claim→evidence→run and UI traceability.
2. Split `ResearchCycleService` / `PipelineService`; modularise DB migrations.
3. Prompt branch matrix and contract tests; mock rules must match real prompt features.
4. Vector KB golden set and reranker evaluation.

### Quarter after (ecosystem + delivery)

1. OpenCode-style tool permissions/sessions; PaperQA2-style RCS rerank.
2. Real-user acceptance of submission package and journal matching.
3. Desktop signing and mobile PWA acceptance.
4. Launch kits for five content communities (publish only with credentials).

## 7. Sources

- Elicit: <https://elicit.com/>
- Consensus: <https://consensus.app/home/resources/consensus-for-university-libraries/>
- SciSpace vs Elicit: <https://scispace.com/compare/elicit>
- OpenAI Deep Research: <https://help.openai.com/en/articles/10500283-deep-research>, <https://developers.openai.com/api/docs/guides/deep-research>
- NotebookLM: <https://notebooklm.google>, <https://edu.google.com/ai-notebooklm/>
- Open Notebook: <https://github.com/lfnovo/open-notebook>
- GPT Researcher: <https://github.com/assafelovic/gpt-researcher>
- PaperQA2: <https://www.futurehouse.org/research-announcements/wikicrow>, <https://arxiv.org/pdf/2409.13740v2>
- AI Scientist: <https://github.com/SakanaAI/AI-Scientist>
- OpenCode: <https://opencode.ai/docs/>
