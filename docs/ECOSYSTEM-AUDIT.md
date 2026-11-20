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
