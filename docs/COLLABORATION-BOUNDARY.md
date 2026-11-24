# Collaboration Boundary

[简体中文](COLLABORATION-BOUNDARY.zh-CN.md) · **English**

Last reviewed: 2026-11-25 · Applies to: **1.19.18**

This document is the single source of truth for what "sharing" means in SciFlow. It
exists because "public read-only share" and "team collaboration" are different
products, and the boundary must be explicit enough to test.

## Product model

SciFlow is a **single-machine, single-owner research assistant**. A project belongs to
the person who created it. There is no membership model, no organisation account,
and no shared project database.

The shipped collaboration surface is deliberately narrow:

1. The owner can publish a **frozen, read-only snapshot** of one document or one
   conversation.
2. Anyone with the unguessable link can read that snapshot without an account.
3. If the owner enables it, anonymous readers can leave **plain-text comments**.
4. The owner can hide comments (the shipped UI labels the action “Delete comment”),
   revoke the link, or let it expire.
5. Nothing else is collaborative.

## Permission matrix

| Action | Project owner | Link visitor (no account) | Other local account |
| --- | --- | --- | --- |
| Open the project workspace | Yes | No | No |
| Read the shared snapshot | Yes | Yes, while active | Yes, while active |
| Edit the source document / conversation | Yes | No | No |
| Create a share link | Yes | No | No |
| Read comments | Yes | Yes, on the public page | Yes, on the public page |
| Post a comment | Yes | Only if comments are enabled | Only if comments are enabled |
| Hide/delete a comment | Yes | No | No |
| Revoke the link | Yes | No | No |
| Use the snapshot after revoke or expiry | N/A | No | No |

"Other local account" means a second account on the same SciFlow instance. It gets
no implicit access to another owner's project; the only path is the same public
link any anonymous visitor would use.

## What enters the snapshot

Document snapshots contain only:

- title, Markdown body, document version, update timestamp, project title.

Conversation snapshots contain only:

- visible `user` and `assistant` message text;
- at most 200 messages, each capped at 50,000 characters;
- the session title and project title.

Conversation snapshots **exclude** attachments and filenames, reasoning or hidden
thinking, tool calls and tool results, system prompts, message IDs, token usage,
model names, and internal metadata. Document snapshots do **not** include binary
attachments or figures; only the text body is frozen.

The snapshot is immutable. Later edits to the source do not change an existing
link, and old links cannot be used to infer newer versions.

## Comment rules

- Comments are **off by default** at link creation.
- When enabled, a comment is anonymous: a display name is optional, self-declared,
  capped at 40 characters; the body is 2–1,000 characters.
- Control characters and angle brackets are stripped; comments render as plain
  text, never as HTML or Markdown.
- The owner sees the comment list in the share dialog and can hide individual
  comments. Hiding is soft-delete; the audit row remains. The shipped UI labels the
  action “Delete comment”, but no row is physically removed.
- There are no replies, mentions, reactions, subscriptions, email/push
  notifications, moderation queues, or reader analytics.
- Public comments are not a private support channel. Do not share confidential or
  personal material with comments enabled.

## Link lifecycle

- Tokens are 24 random bytes encoded as hex; they are not derived from project or
  document IDs and cannot be enumerated.
- Expiry defaults to 30 days, bounded to 1–365 days at creation.
- Revoking marks the link revoked immediately; public reads and comments fail
  afterwards. Expiry is enforced on every public read.
- The share URL is `/share/<token>`; the web app normalises this bare path to its
  hash route before rendering, so the link works when pasted into a fresh browser.

## Explicit non-goals

The following are **not** partially implemented; they are out of scope:

- invites, members, roles, RBAC, per-user permissions, team workspaces;
- shared editing, presence, cursors, mentions, activity feeds;
- comment threads, replies, reactions, attachments in comments;
- per-reader access lists, passwords, domain restrictions, watermarking;
- reader identity, view counts, analytics, or notification on new comments;
- a plugin marketplace or paid extension listings.

Adding any of these requires a new product decision and a new permission model. It
must not be smuggled in as a "small sharing improvement".

## Enforcement and evidence

- Snapshot creation and sanitisation: `apps/server/src/share/share.service.ts`.
- Public read, comment and revoke routes: `apps/server/src/share/share.controller.ts`.
- Service tests: `apps/server/src/share/share.service.spec.ts` covers sanitised
  conversation, default-closed comments, author hide, revoke, expiry, and
  cross-project rejection.
- UI: `apps/web/src/pages/PublicSharePage.tsx` and the share dialog in
  `apps/web/src/pages/WorkspacePage.tsx`.
- Browser acceptance on 2026-11-23: scan PDF → real model answer → save as
  document → export PDF (text layer contains the answer) → share with comments →
  public page shows the snapshot and accepts an anonymous comment. The same run
  caught and fixed the bare `/share/<token>` route bug.
