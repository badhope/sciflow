# Product roadmap

Last reviewed: 2026-11-02 · Current release: **1.9.5**

This document states what exists today, what is deliberately out of scope, and
what is planned next. It is the single source of truth for product scope; the
capability claims in `README.md` should always agree with it.

## Positioning

SciFlow is a **local-first, single-machine research workbench**. The whole data
chain lives in one SQLite file. The user supplies their own model endpoint and
key; nothing is uploaded to a service we operate.

Design principles that decide scope:

- **Local first.** One SQLite file, no external database, no multi-tenant
  service, no account system. Keys are encrypted at rest.
- **Deterministic over probabilistic where it matters.** Quality scores and
  citation audit are rule-based, so the same text always produces the same
  number and fingerprint. An LLM may suggest, but it does not decide pass/fail.
- **No pretending.** If an integration cannot be verified, it ships as a
  documented gap rather than a fabricated success state. Empty reference pools
  disable citation markers instead of letting the model invent them.
- **Composable, not monolithic.** Retrieval, quality audit, citation audit and
  address policy are shared packages used by both the API and the CLI.
- **Use the ecosystem.** LangGraph for orchestration, Vercel AI SDK for model
  transport, Drizzle for data access, sqlite-vec for vectors. We write the
  research domain logic, not the plumbing.

## Capability status

Status values: **Shipped** — works and is covered by tests; **Partial** — works
with a known limitation; **Planned** — not built; **Out of scope** — a deliberate
decision not to build it.

| Stage | Capability | Status | Notes |
| --- | --- | --- | --- |
| Topic | Topic validation and research plan | Shipped | Planner agent produces goals, sub-questions, search strategy, sections and risks |
| Topic | Novelty pre-check | Partial | Uses academic sources when reachable; reports "unavailable" rather than guessing when offline |
| Literature | Online academic search | Shipped | OpenAlex, Crossref, arXiv in parallel, TTL cached, no API key required |
| Literature | Web search fallback | Shipped | Keyless domestic provider with a reachability diagnostic |
| Literature | Library management | Shipped | Import, fingerprint dedup, reading status machine, BibTeX and RIS exchange |
| Literature | Screening and coding matrix | Shipped | PRISMA-style screening with a coding matrix and citation network |
| Knowledge | Hybrid retrieval | Shipped | sqlite-vec ANN plus FTS5 trigram, RRF fusion, MMR de-duplication |
| Knowledge | Grounded Q&A with source cards | Shipped | Hits carry author, year and document binding |
| Knowledge | PDF parsing and chunking | Shipped | Upload PDF, TXT or Markdown; text extraction and chunking |
| Design | Experiment design assistant | Shipped | Variables, controls, sample-size hints, procedure, analysis plan, validity risks |
| Design | Experiment sandbox | Shipped | Isolated local Python execution with timeout and output caps |
| Writing | Outline-first authoring | Shipped | Outline tree, edit and preview, split view |
| Writing | Section drafting with Agentic RAG | Shipped | Retrieves while writing; anchors map to references |
| Writing | Contrarian outline variants | Shipped | Anti-homogenisation alternative narratives |
| Writing | Polish, translate, paraphrase | Shipped | Tail blocks such as references and figures are protected from rewriting |
| Writing | Version history and diff | Shipped | Named snapshots with per-version diff |
| Writing | Export | Shipped | Markdown, DOCX, LaTeX, standalone HTML |
| Citation | Anchor traceability | Shipped | Anchor to citation to reference, three levels |
| Citation | Citation audit | Shipped | Seven classes including ghost anchors, orphans, duplicate DOI, metadata conflict |
| Citation | CSL styles | Shipped | Eight styles including GB/T 7714, renumbered in place |
| Quality | Deterministic seven-dimension gate | Shipped | Stable fingerprint; five selectable standards with scaled thresholds |
| Quality | Automatic revision loop | Shipped | Targeted revision up to three rounds, best round retained |
| Quality | Integrity detection | Shipped | Flags claims of empirical results when no experiment was run |
| Pipeline | End-to-end orchestration | Shipped | LangGraph with a human outline checkpoint |
| Pipeline | Checkpoint resume | Shipped | Continues after a service restart |
| Pipeline | Step timing and token accounting | Shipped | Per-step duration chart and per-call cost log |
| Submission | Journal matching | Shipped | Matches against the local journal library with decision-time hints |
| Submission | Cover letter generation | Shipped | Structured generation from the manuscript |
| Submission | Submission tracking | Shipped | Append-only status events with a multi-state machine |
| Submission | Review reply | Partial | Replies are generated per request; review comments are not yet linked back into the loop |
| Integration | MCP server and client | Shipped | Expose tools and resources; attach external MCP servers |
| Integration | Headless CLI | Shipped | `sciflow run` produces a manuscript without the UI |
| Integration | Desktop application | Partial | Packaging works; a Windows installer build requires a C++ toolchain |
| Operations | Deep health probe | Shipped | `GET /api/health/deep` reports subsystem status |

## Deliberate non-goals

- **Multi-tenant SaaS.** No hosted accounts, no shared storage, no per-organisation
  billing inside this repository.
- **Publisher automation.** No logged-in crawling of submission systems and no
  background polling of editorial mailboxes. The tool organises what the user
  already has.
- **Downloading paywalled full text.** Metadata only.
- **Model hosting.** We integrate with providers; we do not serve weights.

## Next

Ordered by value to a researcher, not by implementation ease.

1. **Link review comments into the revision loop.** A review comment should
   point at a paragraph, and the reply should close against that comment rather
   than a pasted blob of text.
2. **Paragraph-level version restore.** Diff and restore a single section
   instead of a whole-document snapshot.
3. **Structured quality feedback.** Split the audit narrative into actionable,
   checkable issues tied to sections.
4. **Reference and document pagination.** Both lists are unbounded today.
5. **Dependency refresh.** p-limit 6 to 7 and citation-js plugin 0.8 to 0.9 need
   a compatibility pass and a regression run before adoption.
6. **Desktop installer CI.** Produce a signed Windows artifact on a runner that
   has the C++ toolchain.

## How this document is maintained

Any change that alters the capability table must update it in the same pull
request. A capability may only move to **Shipped** when there is a test that
fails without it and a command whose output is quoted in the PR description.
