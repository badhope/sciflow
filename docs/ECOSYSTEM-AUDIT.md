# Ecosystem audit

**English** · [简体中文](ECOSYSTEM-AUDIT.zh-CN.md)

This is a historical audit from November 2026. It records what SciFlow borrowed
from the agent-harness ecosystem, what it deliberately rejected, and which gaps
were closed. It is not a current feature list; use
[`product-roadmap.md`](product-roadmap.md) for that.

## What was checked

- Whether advertised capabilities were actually implemented and covered by a
  reproducible gate.
- How MCP, A2A and AG-UI fit a local-first desktop tool.
- What mature agent harnesses do about loops, tool repetition, fallback models
  and approvals.
- Which open-source research tools were worth learning from, without copying
  their hosting model.

## Decisions

- **MCP is the tool boundary.** Local tools are exposed through the MCP schema;
  external servers are optional and visible only in the `full` profile.
- **No A2A or AG-UI dependency.** Both add a network/UI protocol layer that a
  single-user local app does not need.
- **Bounded loops.** Tool calls per turn, per-tool timeout and repeated-call
  detection are enforced in the bridge, not left to the prompt.
- **Non-streaming fallback only.** A fallback model can rescue a failed
  non-streaming call; a stream that has already emitted tokens is not replayed.
- **Approval is a product feature.** Side-effecting tools pause with a readable
  reason instead of silently running.

## Gaps closed after the audit

- Repeated identical tool calls are counted and rejected after the configured
  limit (default 3).
- A non-streaming fallback model can be configured with `AI_MODEL_FALLBACK`.
- Tool scope is narrowed by profile and allow-list; it is never widened silently.
- Agent traces distinguish model calls from tool calls for honest cost reporting.

## Remaining gaps

- No A2A interoperability.
- No multi-user collaboration or shared library.
- No hosted scheduler; long runs depend on the local process staying alive.
- Desktop packaging is verified on Windows x64 only.

The full Chinese audit, with the source list and per-project notes, is in
[ECOSYSTEM-AUDIT.zh-CN.md](ECOSYSTEM-AUDIT.zh-CN.md).

## 2026-11-22 harness follow-up

A second pass compared the tool loop with OpenCode's current harness behavior
(tool-output truncation, permissions, subagents, undo, LSP and multi-session)
and audited the repo for places where a mature dependency could replace local
code. The pass deliberately kept the scope on the tool loop, not on adding new
product surfaces.

Closed in this pass:

| Gap | Change |
|---|---|
| Oversized tool results entered the model context intact | Per-result cap (default 20,000 chars), head+tail preview, spill to a mode-0600 temp file, and a `read_tool_output` tool for paged read-back |
| No turn-level output budget | `AGENT_TOOL_OUTPUT_TOTAL_CHARS` (default 160,000); once exhausted, further calls return a readable stop reason |
| Transient tool failures were final | `p-retry` with exponential backoff for read-only tools only; write tools never retry |
| Tool calls ignored the model's abort signal | `ToolExecutionOptions.abortSignal` now flows through the bridge; timeouts use `AbortSignal.timeout` and `AbortSignal.any` |
| Unbounded parallel tool calls | `p-limit` with `AGENT_TOOL_CONCURRENCY` (default 3) |
| Successful tool output was absent from traces | `agent_step.output` now stores a 2,000-char success preview for MCP and native `read_tool_output` / `tool_search` calls |
| MCP clients could not tell read-only from destructive tools | `tools/list` now sends `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` |
| SSE sent `[DONE]` but the forwarder cancelled early | The forwarder drains to upstream EOF before finalizing; runs end `done`, `error`, or `cancelled`, and the dashboard labels cancelled runs |

Reuse decisions:

- `p-limit` and `p-retry` are direct dependencies, not reimplemented primitives.
- JSON Schema validation still uses `zod.fromJSONSchema`; no second schema converter.
- Timeouts and cancellation use platform `AbortSignal`, not a custom timer registry.
- `jsonrepair` remains the single tolerant JSON parser.
- Chat run usage is written back to `agent_execution.total_tokens` instead of staying zero.

Still open, in priority order:

1. `packages/db/src/database.ts` still uses imperative `ensureColumn` migrations.
   A migration ledger with checksums and a downgrade story is the largest
   remaining operational debt.
2. Enabled skill instructions are injected eagerly (up to 8,000 chars). A
   `skill` tool that loads the body on demand would match OpenCode's progressive
   disclosure and cut the base prompt.
3. No `task`/subagent tool, no conversation-level undo/checkpoint, and no
   background session runner. These are real gaps against OpenCode, but adding
   them without a product decision would expand the harness faster than the
   current UI can explain.
4. MCP prompts are not exposed; tools and resources are.
5. Vite still reports oversized chunks (`WritingEditor`, `elk`).

Not treated as debt:

- The 2-D PCA projection is about 60 lines and avoids a UMAP/t-SNE dependency
  that would dominate the desktop bundle.
- Passage merging is domain-specific retrieval logic, not a generic library
  primitive.

## 2026-11-23 AI capability integration (22 items)

This round delivered A1-A9, B1-B6 and C1-C7 of the SciFlow AI capability
integration plan. The product boundary did not move: no new pages, the primary
navigation still has 9 entries, and the only new Nest module is the aggregate
`SearchModule`; every other capability extends an existing module.

| Group | Delivered |
|---|---|
| A1 sessions | Server-side CRUD, full-text search, pin/archive; `chat_session` migration and E2E |
| A2 branching | Message tree with `id/parentId`, `activeLeafId`, edit/regenerate branches, version switching; `branch_json` persisted |
| A3 files | One `FileExtractService` for PDF/OCR, DOCX, XLSX, PPTX, EPUB, image OCR, audio transcription and video audio-track extraction; shared by chat attachments and the knowledge base |
| A4 search | `GET /api/search` aggregates documents, chats, projects, experiments, references and knowledge; ⌘K and deep links consume grouped results |
| A5 automation | Time/event triggers, thresholds, in-app/browser/Feishu notifications, idempotent dedupe, retry, last-run status; Croner scheduling |
| A6 output | Playwright `printToPDF`, presentation outline template, tool artifacts into documents/projects, save answer as document |
| A7 sharing | Document/conversation snapshot shares, expiry, anonymous read-only comments, author deletion; conversation snapshots are sanitized |
| A8 prompts | Extension manifest separates `tool/chat` scope; chat templates enter the slash menu via `/api/extensions/chat-prompts` |
| A9 connectors | Domestic-first catalog: Zotero + Feishu, encrypted credentials, test/import/notify/Webhook; Notion/Drive/Overleaf removed |
| B1 composer | Workspace and writing page share `ChatComposer`; duplicated attachment/slash/stop logic removed |
| B2 inbox | AgentOps automation card shows tasks, approvals and notifications through one `useAgentInbox` query set |
| B3 knowledge | Office/EPUB/media import in the existing knowledge tab, `?q=` filtering, no new file library |
| B4 writing | PDF/PPTX export and the A6 template selector; switching templates never overwrites body text |
| B5 settings | Connectors under Extensions & Tools, data export/cleanup under Usage & Audit; settings stay at 9 groups |
| B6 templates | Removed unused `project.templates` and DTO; v19 migration drops the column; `outline-templates` is the single template source |
| C1 PWA | Hand-written `sw.js` replaced by `vite-plugin-pwa` with `navigateFallback`, `cleanupOutdatedCaches` and `/api` excluded |
| C2 scheduling | Croner parses and computes nextRun while DB persistence and the scanner stay |
| C3 Office | `officeparser + mammoth + exceljs`; no hand-written OOXML package parsing |
| C4 OCR | Lazy `tesseract.js` with `chi_sim+eng`, page/pixel caps and graceful fallback |
| C5 PDF | Playwright `printToPDF` with A4, margins, repeated table headers, formulas and hanging-indent references |
| C6 XLSX | Export moved from SheetJS `xlsx` to `exceljs`; three sheets are read back in tests |
| C7 keep list | CodeMirror 6, Recharts, Streamdown/remark/rehype/KaTeX, unpdf and pptxgenjs/docx are kept; `cmdk` is not added |

### C7 keep list (no replacement for novelty)

| Dependency | Use | Decision |
|---|---|---|
| CodeMirror 6 | Writing editor | Keep; extensions and theming are stable |
| Recharts | Charts | Keep; all charts go through `components/charts.tsx` |
| Streamdown / remark / rehype / KaTeX | Markdown and formulas | Keep; coupled to streaming chat |
| unpdf | PDF text | Keep; OCR is only a scanned-file fallback |
| pptxgenjs / docx | PPTX/DOCX export | Keep; output matches the existing templates |
| `cmdk` | Command palette | Do not add; the existing palette is tightly coupled to permissions and routing |

Replace these only on a concrete maintenance or security issue, never merely to
look more “ecosystem-native”.

### Verification and honest boundaries

- Full gates: server/web unit tests, lint, typecheck, build, first-load chunk
  budget and OpenAPI generation.
- Real samples: image OCR, scanned-PDF OCR, real mp4 audio-track transcription,
  DOCX tables, EPUB and multi-sheet XLSX.
- Verified live: Zotero public Web API read/import and Feishu OpenAPI message
  delivery. Still open: a real custom-bot Feishu Webhook URL, because Feishu
  exposes bot creation only in the group settings UI (no OpenAPI), and PWA
  stale-cache update on a physical device. Notion, Google Drive and Overleaf
  were removed by the domestic-first connector policy.
- Real audio uses a local `faster-whisper` fallback (`scripts/local-transcribe.py`)
  when the configured model endpoint has no `/audio/transcriptions`.
- Product wording: “no collaboration UI” is implemented as “no new pages,
  public share + read-only comments first, team collaboration deferred”.
