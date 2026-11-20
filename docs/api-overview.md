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
| Documents | `/api/documents` | outline, section drafting, revision queue, polish, citations, export |
| References | `/api/references` | search, screening, coding matrix, graph, import, DOI check, review |
| Knowledge | `/api/knowledge` | upload, list, hybrid search, passage context, bind, delete |
| Pipeline | `/api/pipeline` | start, list, detail, confirm outline, stop, delete |
| Research | `/api/research` | design review, comparison, simulated review, comments, response letter |
| Quality | `/api/quality` | score a document, history, latest, export comments |
| Submission | `/api/submission` | journal fit, library, cover letter, reply, tracking |
| Judgment | `/api/judgment` | intent classification |
| Experiments | `/api/experiments` | run Python, list, detail, update, delete |
| Chat | `/api/chat` | one-shot answer, SSE streaming |
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
