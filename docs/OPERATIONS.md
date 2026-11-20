# Operations

**English** · [简体中文](OPERATIONS.zh-CN.md)

This guide covers a local install, the desktop build and an optional JWT
deployment on an internal network.

## Topology

| Component | Process | Port | Depends on |
|---|---|---|---|
| API | `node dist/apps/server/src/main.js` | 3000 | SQLite file, optional Python |
| Web (dev) | Vite | 5173 | API |
| Web (prod) | nginx or static host | 80/443 | API |
| Desktop | Electron + embedded API | random loopback | same as API |

Hard requirements: Node 20+ and a writable SQLite path. Python, a local GGUF
embedding model and a search provider are optional; missing pieces degrade
gracefully.

## Health checks

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/health/deep
pnpm doctor
pnpm doctor --json
pnpm doctor --fix
```

`/api/health` reports database status, AI configuration and search capability.
`/api/health/deep` adds read-only checks for SQLite latency, the sqlite-vec
extension and the AI endpoint shape. It never calls the model.

`status=degraded` usually means the database cannot be read. A missing vector
extension or embedding model is a normal fallback, not a failed service.

## Logs and usage

- Structured JSON logs go to stdout. The desktop shell writes them to
  `%APPDATA%/@sciflow/desktop/logs/server.log`.
- `llm_call_log` stores caller, model, tokens, latency and success for every
  model call.
- `agent_execution` and `agent_step` store tool traces and are removed with the
  project.
- API keys are stored encrypted and only returned masked. Passwords are bcrypt
  hashes. Request bodies are not logged.

## Backup and restore

```bash
node scripts/backup-db.mjs                 # keep 14 copies by default
DATABASE_PATH=/path/to/sciflow.db node scripts/backup-db.mjs --keep 7
```

To restore: stop the API, copy the backup over `DATABASE_PATH`, remove any
`-wal` and `-shm` files in that directory, then start the API and check
`/api/health`.

The backup script uses SQLite's online backup API, so it does not lock the
database. The restore path has been exercised with a real database and table
count.

## Failure handling

| Symptom | Likely cause | Action |
|---|---|---|
| `无法连接服务器` | Model endpoint unreachable | Check base URL/key; run `pnpm doctor` |
| `请求过于频繁` | Provider 429 | Lower `AI_RPM_CAP` or use a larger quota |
| `SQLITE_BUSY` | Second process on the same file | Stop the duplicate; busy timeout is 5s |
| Port already in use | Another API instance | `PORT=3001` or stop the other process |
| Vector search unavailable | sqlite-vec load failure | `pnpm rebuild sqlite-vec`, or accept FTS fallback |
| Experiment fails | Python missing | Install Python 3 or set `SANDBOX_PYTHON` |
| Disk full | Health degraded, writes fail | Clean `backups/` and logs; move the database |

Front-end requests time out at 60 seconds. Model calls use a token-bucket limit
and bounded retries. A failed pipeline step is persisted and can be resumed;
there is no infinite retry loop.

## JWT deployment checklist

- [ ] `JWT_SECRET` is a random string of 32+ characters. The server refuses to
  start without it.
- [ ] `ALLOW_REGISTRATION` is unset unless you intentionally want open signup.
- [ ] `HOST=0.0.0.0` and `AUTH_MODE=jwt` are set together.
- [ ] TLS terminates at a reverse proxy; SciFlow does not terminate TLS.
- [ ] `CORS_ORIGIN` is the real front-end origin, not `*`.
- [ ] A scheduled backup job exists.
- [ ] Legacy projects without `owner_id` are migrated before JWT mode is opened.

## Limits

No high availability, no multi-replica setup, no built-in alert channel, no
distributed tracing beyond OTLP export, and no autoscaling. Concurrency is
bounded by `AI_RPM_CAP`. Windows x64 is the only desktop target that has been
packaged and tested; macOS and Linux desktop builds are unverified.
