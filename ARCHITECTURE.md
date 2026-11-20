# SciFlow architecture

**English** · [简体中文](ARCHITECTURE.zh-CN.md)

SciFlow is a local-first research workbench. The browser UI, the API and the
desktop shell run on one machine; the only durable store is a single SQLite
file. No hosted account, vector database or queue is required.

## Runtime shape

```text
React web UI ──HTTP/SSE──> NestJS API ──> SQLite (WAL)
     │                        │
     │                        ├── OpenAI-compatible model endpoint
     │                        ├── optional local GGUF embeddings
     │                        └── optional MCP tools / web search
     └── Electron shell (desktop build)
```

The server listens on `127.0.0.1:3000` by default. The web app can be served by
Vite in development or by nginx in Docker. The desktop app starts its own
server on a random loopback port and loads the UI through the `app://` protocol.

## Repository layout

| Path | Role |
|---|---|
| `apps/server` | NestJS API, pipeline orchestration, SQLite access, model transport |
| `apps/web` | React UI, hash router, SSE client, charts and editors |
| `apps/desktop` | Electron main process, packaging and auto-update plumbing |
| `packages/core` | Shared types, pipeline step definitions, environment helpers |
| `packages/ai` | Model transport, prompts, timeouts, retries and mock gateway |
| `scripts` | Regression, route probes, screenshot and release checks |

## Main modules

The API is split by domain rather than by technical layer:

- `projects` — project lifecycle and cascade deletion.
- `documents` — manuscripts, outlines, versions, citations, export.
- `references` — library, screening, coding matrix, citation graph.
- `knowledge` — chunking, full-text search and optional vector search.
- `pipeline` — deterministic step graph, pause/resume and checkpoints.
- `agent` — tool loop, approvals, traces and task-level progress.
- `research` — design, simulated review and quality scoring.
- `submission` — journal fit, cover letter, readiness and package export.
- `experiments` — isolated local process execution with a timeout.
- `settings` — model endpoint, feature switches and usage accounting.

Each domain owns its controller, service and persistence code. Cross-domain
writes go through the owning service; controllers do not reach into another
domain's tables.

## Data model

One SQLite database holds projects, documents, document versions, references,
citation links, knowledge chunks, pipeline runs and steps, agent executions,
experiment runs, review comments and submission records.

SQLite runs in WAL mode with a busy timeout. Deleting a project must clear every
project-scoped table in one transaction, because the schema intentionally does
not rely on foreign keys for cascade behaviour.

## Pipeline

A run moves through a fixed sequence:

1. Topic and scope check.
2. Literature search and evidence collection.
3. Outline generation and a human approval gate.
4. Section drafting.
5. Deterministic quality review.
6. Citation and reference validation.
7. Submission-readiness checks and package assembly.

Every step writes a checkpoint. A restart resumes from the last committed step
instead of repeating model calls. The step list has one source of truth in
`packages/core`; the UI and the graph read the same definition.

## Agent runtime

The agent loop exposes a bounded tool set. Side-effecting tools pause for
approval; read-only tools run directly. Tool calls are deduplicated within a
request, time-limited, and recorded as separate spans from model calls so cost
reporting stays honest.

Progress is streamed over SSE. The stream carries cumulative snapshots rather
than deltas, so a late subscriber can render the current state without replaying
the whole run.

## Quality gate

Seven dimensions are scored by deterministic rules with a stable fingerprint:
argument, evidence, structure, citations, language, novelty and submission fit.
The gate decides pass or fail. A model score is advisory only and cannot
override a rule failure. A failed draft receives targeted revision instructions,
not an unbounded reroll.

Citation checks resolve each `[n]` marker to a citation row and then to a
reference. Ghost markers, orphan references, duplicate DOIs and broken numbering
are reported. An empty library blocks citation markers.

## Contracts and guards

- OpenAPI is generated from the server and checked into the repo. CI fails on
  drift.
- Shared DTOs and types live in `packages/core`; the web client consumes the
  generated contract.
- Numeric environment variables are parsed and clamped in one place.
- The version string comes from `package.json` at runtime; it is never hard-coded
  in MCP, CLI or UI code.
- A secret guard rejects tracked `.env` files and high-confidence credential
  patterns.

## Security boundary

The default deployment is single-user and loopback-only. JWT mode is available
for a shared internal network. The Python experiment runner is process-isolated
with a timeout and a working directory, but it is not a security sandbox for
hostile code. Public exposure requires a reverse proxy, TLS and authentication.

Outbound model, embedding and MCP requests are checked at socket-connect time;
private, loopback, link-local and cloud-metadata addresses are rejected unless
explicitly allowed.

## Change rules

Architecture changes must update this page and the Chinese full version. New
runtime dependencies need a written reason: use the standard library or an
existing package first. New pipeline steps must be added to the shared step
definition and covered by a regression assertion.

For the long-form historical contract log, see the
[Chinese architecture document](ARCHITECTURE.zh-CN.md).
