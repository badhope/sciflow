# Configuration

**English** · [简体中文](CONFIGURATION.zh-CN.md)

SciFlow ships no built-in model. You bring an OpenAI-compatible endpoint, a
local server, or run the mock gateway for tests. The same settings can be
changed from the settings page, the CLI, or a chat instruction; environment
variables are the fallback for a fresh install.

## Fastest working setup

```bash
cp apps/server/.env.example apps/server/.env
```

```ini
AI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_API_KEY=sk-your-api-key-here
AI_MODEL=doubao-seed-1-6
```

Any OpenAI-compatible provider works: 火山方舟, DeepSeek, DashScope, 智谱,
Moonshot, Ollama, LM Studio, or a self-hosted gateway. Use the exact model name
from your provider. `AI_MODEL` is required; `AI_MODEL_FAST` and
`AI_MODEL_STRONG` are optional routes.

## Model routing

| Variable | Purpose | Default |
|---|---|---|
| `AI_BASE_URL` | OpenAI-compatible base URL | 火山方舟 endpoint |
| `AI_API_KEY` | Provider key; never commit it | empty |
| `AI_MODEL` | Default model | empty, must be set |
| `AI_MODEL_FAST` | Short answers, polish, review JSON | falls back to `AI_MODEL` |
| `AI_MODEL_STRONG` | Planning and long-form drafting | falls back to fast |
| `AI_RPM_CAP` | Requests per minute; concurrency is derived from it | 60 in the server, 8 in Compose |
| `AI_REQUEST_TIMEOUT_MS` | Per-request timeout; `0` disables | 180000 |
| `AI_MOCK` | `1` starts the in-process mock gateway | off |

A fast/strong split is worth setting for long pipelines: planning and critique
benefit from a stronger model, while translation and formatting do not.

## Agent and tools

| Variable | Purpose | Default |
|---|---|---|
| `AGENT_TOOLS` | `off` disables tool calls | on |
| `AGENT_TOOLS_ALLOW` | Comma-separated tool allow-list | built-in research set |
| `AGENT_TOOLS_PROFILE` | `full`, `research`, `experiment`, `config` | `full` |
| `AGENT_TOOL_MODE` | `full` or `dynamic` (`tool_search` first) | `full` |
| `AGENT_MAX_TOOL_CALLS` | Tool calls per turn | 24 |
| `AGENT_TOOL_TIMEOUT_MS` | Per-tool timeout | 20000 |
| `AGENT_PLAN_APPROVAL_WAIT_MS` | How long `request_research_plan` waits for approval before ending the turn | 300000 |
| `AGENT_TOOL_OUTPUT_MAX_CHARS` | Maximum characters from one tool result sent back to the model; the rest is retrievable with `read_tool_output` | 20000 |
| `AGENT_TOOL_OUTPUT_TOTAL_CHARS` | Total tool-output budget per turn | 160000 |
| `AGENT_TOOL_RETRIES` | Retry budget for transient failures of read-only tools; write tools never retry | 2 |
| `AGENT_TOOL_CONCURRENCY` | Maximum tool executions running at once | 3 |
| `SCIFLOW_TOOL_OUTPUT_DIR` | Temporary directory for truncated tool output | OS temp `/sciflow-tool-output` |
| `AI_TOOLS_NONSTREAM_HOSTS` | Hosts that need non-streaming tool calls | `hcnsec.cn` |

External MCP tools are visible only in the `full` profile. If you replace
`AGENT_TOOLS_ALLOW`, include the MCP tool names or they will be filtered out.

## Storage and retrieval

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_PATH` | SQLite file | `apps/server/data/sciflow.db` |
| `EMBEDDING_MODEL_PATH` | Local GGUF embedding model | empty; full-text search only |
| `SCIFLOW_NO_VEC` | `1` disables sqlite-vec | off |
| `KNOWLEDGE_CONTEXT_CHUNKS` | Neighbour chunks added to a hit | 1 |
| `RETRIEVAL_RERANK` | LLM reranking | off |
| `SCHOLAR_SEARCH` | OpenAlex / Crossref / arXiv search | on |
| `WEBSEARCH_PROVIDER` | `so360`, `searxng`, `tavily`, `serper`, `brave`, `duckduckgo` | duckduckgo |

Embeddings are optional. Without a model, search falls back to FTS5 BM25 and
LIKE matching; nothing in the writing or review flow stops working.

## Network and auth

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | Listen address | `127.0.0.1` |
| `PORT` | API port | 3000 |
| `CORS_ORIGIN` | Allowed origins, comma-separated | local Vite origins |
| `AUTH_MODE` | `none` or `jwt` | `none` |
| `JWT_SECRET` | Signing key, at least 32 characters | empty |
| `JWT_EXPIRES` | Token lifetime | `7d` |
| `ALLOW_REGISTRATION` | Open self-registration | off |
| `ALLOW_PRIVATE_OUTBOUND` | Allow private/local outbound targets | off |
| `SANDBOX_TIMEOUT_MS` | Experiment timeout | 10000 |

If `HOST` is not loopback, `AUTH_MODE=jwt` and a valid `JWT_SECRET` are required;
the server refuses to start otherwise.

## Search, traces and assets

- Web search is configured in the UI or via `PUT /api/web/config`. SearXNG is the
  recommended self-hosted option; commercial providers need their own key.
- `OTEL_EXPORTER_OTLP_ENDPOINT` exports traces as OTLP/HTTP-JSON. It is off by
  default and adds no overhead when unset.
- Built-in prompts, skills, roles and MCP catalogue entries are seeded once on
  first start. They can be disabled but not physically deleted; `resetBuiltin`
  restores the defaults.

## Docker

```bash
cp .env.example .env          # fill AI_API_KEY
docker compose up -d --build
# open http://localhost:8080
```

Compose publishes the API only on `127.0.0.1:3000` and serves the web app on
`8080`. Set `CORS_ORIGIN=http://localhost:8080` when using that address.

## Full reference

The complete variable list, CLI examples and troubleshooting notes are in the
[Chinese configuration guide](CONFIGURATION.zh-CN.md). The source of truth for
defaults is `apps/server/.env.example` plus the `envInt` calls in code.
