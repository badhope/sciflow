# API overview

**English** · [简体中文](api-overview.zh-CN.md)

The API is a single NestJS service mounted under `/api`. The generated OpenAPI
document is the authoritative contract; this page is a map of the surface.

## Conventions

- JSON request and response bodies, except export endpoints that return text or
  a file stream.
- UTF-8. Error messages are written for end users.
- `CORS_ORIGIN` controls allowed origins; the default is the local Vite origin.
- In `AUTH_MODE=jwt`, every route except health and auth requires a bearer token.
- Errors use a stable shape:

```json
{ "statusCode": 400, "message": " readable message ", "error": "Bad Request" }
```

## Route map

| Group | Base | Main operations |
|---|---|---|
| Projects | `/api/projects` | list, create, read, update, delete (cascades project data) |
| Documents | `/api/documents` | outline, section drafting, revision queue, polish, citations, PDF/DOCX/XLSX export |
| References | `/api/references` | search, screening, coding matrix, graph, import, DOI check, review |
| Knowledge | `/api/knowledge` | upload, list, hybrid search, passage context, bind, delete |
| Pipeline | `/api/pipeline` | start, list, detail, confirm outline, stop, delete |
| Research | `/api/research` | plan audit, design review, comparison, simulated review, comments, response letter |
| Quality | `/api/quality` | score a document, history, latest, export comments |
| Submission | `/api/submission` | journal fit, library, cover letter, reply, tracking |
| Judgment | `/api/judgment` | intent classification |
| Experiments | `/api/experiments` | run Python, list, detail, update, delete |
| Chat | `/api/chat` | one-shot answer, SSE streaming, cloud session CRUD, full-text session search |
| Search | `/api/search` | cross-domain aggregate search with typed routes |
| Shares | `/api/shares` | document/conversation snapshots, expiry, public read-only comments |
| Automation | `/api/agent` | time/event schedules, in-app/browser/Feishu notifications |
| Extensions | `/api/extensions` | scoped prompt assets and chat slash templates |
| Connectors | `/api/connectors` | Zotero and Feishu credentials, import/test; foreign SaaS connectors removed by domestic-first policy |
| Memory | `/api/memory` | write, list, delete |
| MCP | `/api/mcp` | info, tools, call, external discovery and call |
| Settings | `/api/settings` | read, connection check, provider CRUD, MCP server CRUD |
| Customization | `/api/customization` | intents, step switches, quality weights, prompts |
| Usage | `/api/usage` | token and cost summary |
| Dashboard | `/api/dashboard` | overview aggregate |
| Health | `/api/health` | shallow and deep probes |

### Documents and the revision queue

The writing surface exposes the complete manuscript path: generate an outline,
draft a section, run a revision queue, polish or translate, attach citations and
export. A revision queue runs in the background and returns per-item before/after
results. It can be stopped; the current item finishes, pending items are skipped.

### Aggregate search, sharing, automation and connectors

`GET /api/search` returns one typed result list across documents, chat sessions,
projects, experiments, references and knowledge. `POST /api/shares` now accepts
`targetType: "conversation"`; conversation snapshots strip attachments, reasoning
and tool calls. Comments are off by default and stored separately.

Automation extends the existing schedule module: `triggerType` supports
`time`, `reference.created`, `pipeline.completed`, `quality.threshold` and
`experiment.failed`; notifications are idempotent and Fan-out to in-app,
browser and Feishu webhook channels. Feishu webhooks are HTTPS-only and
host-allowlisted.

Connectors live under the existing MCP module (`/api/connectors`). Credentials
are encrypted at rest. The current catalog is domestic-first: Zotero imports
references; Feishu supports a custom-bot Webhook or app credentials, sends real
notifications and imports cloud docs. Notion, Google Drive and Overleaf were
removed instead of kept as credential-blocked placeholders.

### Chat and SSE

`POST /api/chat` returns a complete answer. `POST /api/chat/stream` returns
`text/event-stream`:

```text
data: {"sources":[...]}

data: {"delta":"..."}

data: [DONE]
```

When a `projectId` is supplied and tools are enabled, both entry points use the
same tool bridge, step limit and trace storage. Disconnecting the client aborts
the upstream request. Reasoning deltas are forwarded only when
`enableThinking: true`.

## Examples

```bash
curl -s http://127.0.0.1:3000/api/health

curl -s -X POST http://127.0.0.1:3000/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Graph neural networks","description":"A review"}'

curl -s -X POST http://127.0.0.1:3000/api/documents \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<id>","title":"Draft"}'

curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"<id>","message":"Summarise the evidence"}'
```

The full route list, field-level notes and older curl examples are in the
[Chinese API guide](api-overview.zh-CN.md). Regenerate the contract with
`pnpm openapi:gen`; CI rejects drift.
