# Security policy

**English** · [简体中文](SECURITY.zh-CN.md)

SciFlow is designed for a single user on a local machine. JWT accounts are
available for a shared internal network. The default server binds to
`127.0.0.1`; the experiment runner uses a timeout and a separate working
directory, but it is not a sandbox for hostile code.

## Design boundaries

- **Loopback by default.** `HOST=127.0.0.1` keeps the unauthenticated API off the
  LAN. Setting `HOST=0.0.0.0` is an explicit decision and requires a reverse
  proxy or an authenticated network.
- **Minimal CORS.** Only `http://localhost:5173` is allowed by default. Multiple
  origins are comma-separated; `*` must be set deliberately.
- **Secrets stay local.** Keys can come from the environment, a local
  `apps/server/.env`, or the settings page, where they are encrypted in SQLite.
  The UI only shows a mask. Do not commit the database, the env file or keys.
- **Process isolation.** Python and Node experiments run in a child process with
  `SANDBOX_TIMEOUT_MS`, a separate working directory and a filtered environment.
  A timeout returns a readable failure; it does not crash the API.
- **Parameterised SQL.** All database access goes through Drizzle. String-built
  SQL is not accepted.
- **Input validation.** A global pipe validates JSON bodies. MCP tool arguments
  are checked against their JSON Schema. Third-party tool output is labelled as
  untrusted and fenced before it reaches the model.
- **Controlled outbound traffic.** Model, embedding and MCP connections are
  checked at socket-connect time. Private, loopback, link-local and
  cloud-metadata addresses are rejected. `ALLOW_PRIVATE_OUTBOUND=1` can allow a
  local model server, but never the metadata address.
- **Mock gateway stays local.** `AI_MOCK=1` binds to `127.0.0.1` only and makes
  no external calls.

## Dependency checks

Run these before every release:

```bash
pnpm audit --registry=https://registry.npmjs.org --prod
pnpm audit --registry=https://registry.npmjs.org
```

Production dependencies currently report no known high or critical
vulnerabilities. Dependabot checks weekly; security updates are kept separate
from routine version updates and are merged after CI passes.

## Known limits

- The experiment sandbox is a process boundary, not a container or VM.
- The desktop build trusts the local user account; it does not protect against a
  malicious process running as the same user.
- A public deployment needs gateway authentication, TLS, rate limits and
  monitoring that SciFlow does not ship.

## Reporting a vulnerability

Please do not open a public issue first. Use the private security advisory
channel on GitHub, Gitee or GitCode, or contact the maintainer through the
address on the repository profile. Include reproduction steps, the affected
version, your OS/Node/pnpm versions and a proof of concept if you have one.

We aim to acknowledge a report within 72 hours and will agree on a fix window
before any public disclosure.
