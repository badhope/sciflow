# Security review record

**English** · [简体中文](SECURITY.zh-CN.md)

This page records the security review behind the current posture. The policy
itself is in [`../SECURITY.md`](../SECURITY.md).

## Threat model

| Deployment | In scope? | Notes |
|---|---|---|
| Local single user, loopback only | Partial | Other local processes can reach the port; SSRF and path traversal still matter |
| Internal network with JWT | Yes | IDOR, privilege escalation and open registration must be blocked |
| Public internet | Not recommended | Needs a WAF, TLS, rate limits and monitoring that SciFlow does not ship |

## Issues found and closed

- **JWT secret fallback.** A default secret allowed forged admin tokens. The
  server now refuses to start in JWT mode unless `JWT_SECRET` is at least 32
  characters. In `none` mode it uses a random per-process secret.
- **SSRF through external MCP and SearXNG URLs.** Outbound connections are now
  checked at socket-connect time against the resolved address; private,
  loopback, link-local and metadata addresses are rejected. Redirects are not
  followed.
- **IDOR across projects.** Document and reference reads now verify project
  ownership before returning data.
- **Open registration.** Self-registration is off by default. The first user in
  an empty database can become admin; subsequent signups require an explicit
  switch.
- **Citation audit false green.** A document with no anchors no longer receives
  a perfect citation score; the gate reports the missing evidence instead.
- **Backup script.** The backup path was rewritten and exercised with a real
  database: backup, restore and table-count checks passed.

## Residual risks

- `project.owner_id` may be empty on legacy rows. In JWT mode those projects are
  not visible; an administrator must migrate them explicitly.
- The experiment runner is a process boundary, not a container. Do not run
  hostile code.
- Desktop builds trust the local OS account.
- No field-level audit log for document or reference changes in JWT mode.

## Minimum JWT configuration

```ini
HOST=0.0.0.0
AUTH_MODE=jwt
JWT_SECRET=<32+ random characters>
CORS_ORIGIN=https://your-real-origin
# ALLOW_REGISTRATION is intentionally unset
# ALLOW_PRIVATE_OUTBOUND=1 only when SearXNG or MCP is on a private network
```

## Verification

```bash
pnpm -r test
SCIFLOW_BASE=http://127.0.0.1:3000 python3 scripts/route_probe.py
pnpm audit --registry=https://registry.npmjs.org --prod
```

The long-form Chinese review, including the original proof-of-concept notes, is
in [SECURITY.zh-CN.md](SECURITY.zh-CN.md).
