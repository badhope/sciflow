# Acceptance report · 1.19.17

[简体中文](ACCEPTANCE-REPORT.zh-CN.md) · **English**

Last run: **2026-11-24 02:38–02:45 CST** · Release under test: **1.19.17** ·
Code base: the `v1.19.17` release commit, identical on all five remotes and the tag.

This report closes the three acceptance tickets that had been left open:

1. real third-party connectors, with live calls instead of a mocked success state;
2. a complete browser journey, from an uploaded scan to a shared, commented document;
3. the collaboration boundary, 10,000-document search latency, stale PWA caches and
   real token accounting.

It records what passed, what is still blocked by a missing external credential, and
what was deliberately not claimed. A blocked item is not rewritten as a pass.

## Verdict

| Item | Verdict | What was actually observed |
| --- | --- | --- |
| Zotero live connector | **PASS** | Public library `475425` connected without an API key; test reported 164 items; import returned `fetched=10, added=7, duplicate=1, skipped=2` |
| Feishu live message | **PASS** | A real message was delivered to group `oc_372a49ef1a17564e6bef107893e8e1cb` by the Feishu user identity, message `om_x100b7f76383a60a115bcafb08d9eb24` |
| Feishu custom-bot Webhook | **BLOCKED** | No real group Webhook URL exists in this environment; the code path and HTTPS allow-list are covered by tests, but no live POST was possible |
| Feishu app connector | **BLOCKED** | No real App ID / App Secret; a fake credential produced `tenant_access_token` error `10003`, proving the SDK path is real but leaving the success path unverified |
| Browser journey | **PASS** | Final build `18:37:54`: scan upload → real model answer `3200 W/(m·K)` → clean document `4f1d9c7f...` → exported PDF → public share → anonymous comment → author moderation → revoke |
| Cross-project session guard | **PASS** | A session from another project is now refused with an explicit error instead of silently creating a new conversation |
| Collaboration boundary | **PASS** | Behaviour matches the published permission matrix; comment hiding is a soft delete and the audit row remains |
| 10,000-document search P95 | **PASS** | Fresh seeded database: service document P95 **1.26 ms**, all-type service P95 **3.90 ms**, HTTP document P95 **4.44 ms** |
| PWA stale-cache cleanup | **PASS (desktop Chromium)** | A newer service worker removed the injected legacy precache; the offline shell rendered the reconnect screen instead of an endless spinner |
| Real token accounting | **PASS** | API and SQLite agree; one clean execution and its LLM call both report **8,158** tokens |
| Deterministic gates | **PASS** | 951 server + 276 web + 5 desktop tests passed, 1 skipped; lint, typecheck, server build, web build and chunk budget passed; `full_regression.py` 222 PASS / 0 FAIL |

## 1. Real third-party connectors

### Environment

- Acceptance database: `/tmp/sciflow-accept/sciflow.db`, copied from
  `/home/user/.sciflow/sciflow-final-e2e.db` with SQLite online backup and the same
  `.sciflow.key`.
- Server: port `4404`, database-backed, authentication disabled for the isolated run.
- Model: `https://api.qs.al/v1`, `deepseek-v4.1-flash`, `AI_MOCK=false` reported by
  `/api/health`.

### Zotero

The connector was configured through the public API, not by inserting rows:

```json
POST /api/connectors/connect
{"projectId":"e1139d37-e06c-4b9a-baa2-c11ccc7f842a",
 "key":"zotero",
 "config":{"libraryId":"475425","libraryType":"user","apiKey":""}}
```

`POST /api/connectors/test` returned `Zotero 连接正常，库内 164 条`.
`POST /api/connectors/zotero/import` returned:

```json
{"fetched":10,"added":7,"duplicate":1,"skipped":2}
```

The connector list showed `connected: true`, the masked library ID, and the import
summary with `checkedAt=1795456147964`. This is a network call to Zotero's public Web
API and a real write into the local reference table.

### Feishu

Two different paths were tested, and they must not be conflated:

- **Message delivery:** a real text message was sent to the private acceptance group
  `oc_372a49ef1a17564e6bef107893e8e1cb` through the Feishu user identity, producing
  message ID `om_x100b7f76383a60a115bcafb08d9eb24`. The message states that this is a
  live acceptance run, not a mock, and carries the date 2026-11-23.
- **Connector app mode:** the service correctly attempted a real
  `tenant_access_token` exchange. With deliberately fake credentials it failed with
  `code: 10003, msg: invalid param`; this proves the SDK call is reached, but a
  successful app-mode send still needs real App ID / App Secret.
- **Connector Webhook mode:** the code now accepts a custom-bot Webhook URL, enforces
  HTTPS and the `open.feishu.cn` / `open.larksuite.com` host allow-list before sending,
  and parses `code` / `StatusCode`. Unit tests cover rejection of
  `http://127.0.0.1:9999/hook` before any request is made. No real Webhook URL was
  available: Feishu's OpenAPI and CLI do not expose custom-bot creation, and a Bitable
  external Webhook trigger on base `I67XbMspcaAsEss074zc0Bxr6o7` returned
  `800005667 webhook not available`. Browser login stopped at the QR page and the
  hand-off request was skipped, so no URL could be created.

**Boundary:** the live Feishu message is real, but it was sent by the user identity,
not by the SciFlow connector. The connector's Webhook and app-mode success paths remain
unproven in this environment. The report does not claim otherwise.

### Connector scope after the domestic-first decision

`ConnectorKey` is now exactly `zotero | feishu`. Notion, Google Drive and Overleaf were
removed rather than left as disabled placeholders:

- directory entries, `check()` branches, `notionSearch()` and `driveList()` deleted;
- `/connectors/notion/search` and `/connectors/drive/list` deleted;
- `@notionhq/client` and `googleapis` removed from `apps/server/package.json` and the
  lockfile;
- generated OpenAPI reduced to **268** paths, with the Notion/Drive schemas and the
  `ProjectBody` component gone;
- settings UI exposes only the two remaining connectors.

Zotero is retained as a user-supplied literature source: the user provides the library
ID and optional key, and the data lands in the local SQLite file. It is not a hosted
SciFlow account. If the domestic-only policy is meant to exclude Zotero as well, that
is a separate product decision and should be made explicitly rather than silently
flipped in this release.

## 2. Complete browser journey

Run against the rebuilt acceptance database and the final production web build
(`2026-11-23T18:37:54.791Z`), in headless Chromium 146 driven by Playwright. Runs C/D/E
were iterations; only the final F run is recorded below. Every run made real model calls
and wrote through the real API, never a mocked page.

| Step | Observed |
| --- | --- |
| Project | `e1139d37-e06c-4b9a-baa2-c11ccc7f842a` (“真实模型终验 · GNN 分布外泛化”) |
| Upload | `/tmp/scan.pdf`, a one-page image-only scan of a synthetic material test report |
| Question | “请读取这份扫描件里的热导率数值，保留单位，并说明它来自哪份材料。” |
| Answer | “扫描件中报告的热导率数值为 3200 W/(m·K)，测试方法为激光闪射法。” |
| Saved document | `4f1d9c7f-caa6-4249-9783-0cf6638d089f`, title “扫描件热导率复验 F · 20261124”, 659 characters; a database check found no internal marker |
| Export | `acceptance-2026-11-24-export.pdf`, 367,596 bytes; PDF title matches the document; text layer contains `3200 W/(m·K)` and no `---FOLLOWUPS---`; creation time `2026-11-24 02:40:57 +08` |
| Share | `http://127.0.0.1:4404/share/c912578cf187e69b8332ed6f6507fbe311410340ccef9feb`; comments default off for a new share and appear only after opting in |
| Public read | Heading and body rendered the saved snapshot, including the 3200 value |
| Anonymous comment | “1.19.17 最终构建浏览器全旅程：扫描件→对话→干净文档→PDF→分享评论，2026-11-24。” posted as “验收读者 Final F” |
| Author moderation | Share dialog showed “读者评论 · 1”; after “删除评论” it showed “还没有评论。” and the public API returned an empty visible list |
| Revoke | After “撤销链接”, refreshing the public URL showed “分享链接已撤销” |

The scan is an acceptance fixture, not a scientific measurement. Its 3200 value must
not be cited as a material property. What is being verified is the chain: image OCR,
a real model call, persistence as a document, PDF rendering, immutable share snapshot,
anonymous comment and owner moderation.

Evidence:

- [Chat answer](verification/assets/acceptance-2026-11-24-chat.png)
- [Writing page and PDF export](verification/assets/acceptance-2026-11-24-export.png)
- [Public page with comment](verification/assets/acceptance-2026-11-24-public-comment.png)
- [Author sees the comment](verification/assets/acceptance-2026-11-24-author-comment.png)
- [Comment hidden](verification/assets/acceptance-2026-11-24-comment-hidden.png)
- [Revoked link](verification/assets/acceptance-2026-11-24-revoked.png)
- [Comments off by default on a new share](verification/assets/acceptance-2026-11-24-share-default-off.png)
- [Exported PDF](verification/assets/acceptance-2026-11-24-export.pdf)
- [Scan fixture](verification/assets/acceptance-2026-11-24-scan.pdf)

### Defects found and fixed during this journey

**Cross-project session fallback.** With `?session=0ba3ed72-cc87-4671-b3bb-2f0b37ff306a`
belonging to project `e1139d37`, opening the workspace while project `7fb3c5a9` was
current did not report an error. It silently created a new conversation, uploaded the
file there and saved the document into the wrong project. The workspace now checks the
server-provided session list before opening: if the requested session is absent, it sets
`focusSessionConsumed`, shows “该会话不属于当前项目，已阻止打开；请切换到会话所属项目后重试。”,
and never calls the cross-project detail endpoint. A regression test covers this.

- [Correct project loads the guard session](verification/assets/acceptance-2026-11-24-guard-good.png)
- [Foreign project is refused](verification/assets/acceptance-2026-11-24-guard-foreign.png)

**Missing comment moderation UI.** The first share dialog could create a link but had no
way for the owner to review or delete comments, which did not match ticket A7. The dialog
now loads `targetId`, finds an existing share by target type and ID, lists “读者评论 · N”,
and exposes a per-comment delete action. The server implements this as a soft delete
(`status='hidden'`), so the audit row remains; the UI label is “删除评论”.

**Internal marker leaked into saved documents.** The D run exposed `---FOLLOWUPS---`
and the follow-up draft at the end of the saved document. “Save as document” stored
`message.content` verbatim, including the internal follow-up convention. Saving now goes
through `parseFollowUps(message.content).content.trim()`, separating body and follow-ups.
The F database check reported `instr(content, "---FOLLOWUPS---") = 0`, and the PDF text
layer contains none. Historical sessions are also stripped at render time, so old rows
do not show the marker in the bubble either.

**Share dialog could leak the previous comment setting.** `openShare` only applied the
checkbox value when an existing share was found. Opening a document that had comments
enabled, closing the dialog, then opening an unshared target could leave the box checked.
Every open now resets to false and only restores an existing share’s value; a
`shareLookupSeq` guard discards late responses for an older target. The F run confirmed
comments default off on a fresh document, with a regression test.

**Deep link vs. tab state.** `#/write-review?doc=...&tab=citations` does not select the
bottom tab on first render; the user still has to click “引用与导出”. This is a small
consistency defect and was not treated as a blocker for this release. It is recorded
here instead of being hidden.

## 3. Collaboration boundary

The published boundary is [`COLLABORATION-BOUNDARY.md`](COLLABORATION-BOUNDARY.md).
The verified behaviour matches it:

- a project has one owner; there is no membership model or shared project database;
- a share is a frozen snapshot of one document or one conversation;
- document snapshots contain title, Markdown body, version, update time and project
  title; conversation snapshots contain visible user/assistant text only, at most 200
  messages of 50,000 characters each;
- attachments, filenames, reasoning, tool calls and results, system prompts, message IDs,
  token usage and model names never enter a conversation snapshot;
- comments are off by default, anonymous, plain text, 2–1,000 characters, and optional
  display name up to 40 characters;
- the owner can hide a comment, revoke the link, or let it expire;
- there are no replies, mentions, reactions, notifications, moderation queues or reader
  analytics.

The boundary document was corrected to say that the owner action is a soft hide, while
the shipped UI labels it “Delete comment”. This avoids a documentation claim that the
row is physically removed.

## 4. 10,000-document search P95

A fresh database was created at `/tmp/sciflow-perf2/sciflow.db` and seeded with one
project and **10,000** documents, all containing a common query term. No production data
was used and the old `/tmp/sciflow-perf` numbers were not reused.

| Measurement | Samples | P50 | P95 | Max |
| --- | --- | --- | --- | --- |
| `SearchService.search(project, query, 'document')` | 100 | 0.60 ms | **1.26 ms** | 3.50 ms |
| `SearchService.search(project, query)` (all six types) | 100 | 1.43 ms | **3.90 ms** | 5.31 ms |
| `GET /api/search?...&types=document` | 50 | 2.71 ms | **4.44 ms** | 23.91 ms |

The HTTP run was capped by the global 60-requests-per-minute throttle; after a cooldown,
50 sequential requests were measured. The first attempt hit `429 Too Many Requests` and
was discarded, not hidden. This is a seeded-text benchmark, not a claim about arbitrary
production corpora.

## 5. PWA cache and offline shell

Production build facts:

- build ID: `2026-11-23T18:37:54.791Z`, injected into
  `meta[name=sciflow-build]` and `window.__SCIFLOW_BUILD__`;
- service worker: `dist/sw.js`, generated by `vite-plugin-pwa` with `generateSW`,
  `navigateFallback: index.html`, `navigateFallbackDenylist: [/^\/api\//]` and
  `cleanupOutdatedCaches: true`;
- current precache: `workbox-precache-v2-http://127.0.0.1:4404/`;
- 168 precache entries, 8,706.62 KiB.

Verified on the final build in a persistent Chromium profile. `dist/sw.js` was first
replaced with a different pre-upgrade version, then restored to the final `sw.js`, so the
browser performed a real update/activate:

1. the page registered `http://127.0.0.1:4404/sw.js` and exposed the build ID above;
2. a legacy cache `workbox-precache-v2-http://127.0.0.1:4404/legacy-old` was injected;
3. a newer service worker was deployed and `registration.update()` was called;
4. after reload, only `workbox-precache-v2-http://127.0.0.1:4404/` remained — the
   legacy cache was deleted by `cleanupOutdatedCaches`;
5. with the context offline, reloading the app rendered:
   “当前离线，或连不上后端 / SciFlow 的应用壳已由 Service Worker 缓存，离线也能打开；科研数据与 AI 能力需要连回后端。”,
   plus a “重新连接” button. It did not stay on the startup spinner.

- [Offline shell](verification/assets/acceptance-2026-11-24-pwa-offline.png)

**Boundary:** this proves service-worker registration, version update, stale-cache
cleanup and offline navigation in desktop Chromium. It does not prove an iOS or Android
install prompt, nor an update on a physical phone. Those require a real device and are
listed as not tested, not as passed.

## 6. Real token accounting

Snapshot at 2026-11-24 02:05 CST, project `e1139d37-e06c-4b9a-baa2-c11ccc7f842a`,
`GET /api/agent/metrics?days=7&projectId=...`:

| Metric | Value |
| --- | --- |
| Runs | 28 total, 26 done, 0 error, 0 running |
| Average duration | 94,377 ms |
| Total tokens | **357,524** |
| Tool calls | 82 total, 82 ok, 0 fail, 100% success |
| Tool latency | 347 ms average, 8 ms P95 |
| By day | 2026-11-22: 82 calls, 0 fail, 336,916 tokens; 2026-11-23: 0 calls, 20,608 tokens |

Direct SQLite cross-check on the same database:

- `agent_execution`: 36 rows, `sum(total_tokens)=396,005`;
- `llm_call_log`: 170 rows, `sum(total_tokens)=1,051,854`.

The two totals differ for a reason: the API applies a seven-day window and a project
filter, while the SQL totals cover every project and every caller, including intent
classification, conversation summaries and writing helpers. This is not a mismatch.

One clean execution was traced end to end:

- `agent_execution` id `34f4a925-7c60-4a7d-bef7-83f048a0ee48`, project `e1139d37...`,
  `created_at=1795456749450`, `duration_ms=4,710`, `total_tokens=8,158`;
- `llm_call_log` in the same start→end window: exactly **1** row, caller
  `chatWriting`, model `deepseek-v4.1-flash`, `total_tokens=8,158`.

This is a direct, same-window equality, not an estimate.

## 7. Deterministic gates

| Gate | Result |
| --- | --- |
| `pnpm -r test` | 138 server files / 951 passed / 1 skipped; 51 web files / 276 passed; 1 desktop file / 5 passed; exit 0 |
| `pnpm lint` | exit 0 |
| `python3 scripts/full_regression.py` | 222 PASS / 0 FAIL on an isolated AI_MOCK database |
| CI run `45251532442` | `Types / Unit / Build`, `E2E + prompt evals` and `Full mock regression` all PASS |
| Web typecheck | exit 0 |
| Server build | exit 0 |
| Web build | exit 0, PWA 168 precache entries / 8,706.62 KiB |
| OpenAPI generation | 268 paths, `targetId` present in schema and generated types |
| Chunk budget | first screen 437.3 KB raw / 132.3 KB gzip; largest lazy chunk 1,463.8 KB raw / 447.9 KB gzip, not on first screen; exit 0 |

`pnpm openapi:check` is a clean-tree check (`git diff --exit-code`). It must be run after
the release commit exists; before that it reports the intentional, not-yet-committed
OpenAPI diff. Generation itself succeeded.

## 8. What remains open

These items are not silently marked complete:

1. **Feishu custom-bot Webhook** needs a real group Webhook URL. Without it, only the
   validated HTTPS guard and error parsing are proven. Actionable takeover path: in the
   Feishu client open the acceptance group → Settings → Bots → Add Bot → Custom Bot →
   copy the Webhook → paste it into SciFlow project settings → Connectors → Feishu →
   save and test.
2. **Feishu app connector** needs real App ID / App Secret. The fake-credential attempt
   proves the token exchange is attempted, but not that a message is delivered.
   Actionable takeover path: create a self-built app in the developer console, add bot
   capability and `im:message:send_as_bot`, publish it, add the app to the acceptance
   group, then fill App ID / App Secret / `receiveId`. Alternatively use
   `@larksuiteoapi/node-sdk` `registerApp` device authorization to create the app and
   return real credentials after the user confirms the QR/link.
3. **Mobile PWA install and update** were not run on a physical iOS or Android device.
   Desktop Chromium registration, update and offline shell passed.
4. **Zotero policy** is a product decision. It is retained as a user-supplied literature
   API in 1.19.17; if “domestic only” is meant to remove it too, that must be an explicit
   follow-up, not a guess.
5. **Deep-link tab selection** (`tab=citations`) still needs one click on “引用与导出”.

## 9. Reproduction notes

- Server: from `apps/server`,
  `PORT=4404 DATABASE_PATH=/tmp/sciflow-accept/sciflow.db LOCAL_WHISPER_MODEL=/home/user/models/whisper-small-zh node dist/apps/server/src/main.js`.
- Acceptance database: copy with SQLite `backup()` rather than `cp` of the main file
  alone; a missing WAL produces an empty project list.
- Browser: Playwright Chromium at
  `/opt/vm/preinstall/ms-playwright/chromium-1169/chrome-linux/chrome`.
- Public share URLs are `/share/<token>` without a hash; `#/share/<token>` is not a
  valid entry point.
- The writing page needs a manual click on “引用与导出” before “导出 PDF”.

All screenshots and PDFs in this report are local copies under
`docs/verification/assets/`; no external image host is required to read the report.
