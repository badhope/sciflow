# Deployment

**English** · [简体中文](deployment.zh-CN.md)

SciFlow is a single-user, local-first application. One SQLite file holds all
data; there is no external database, queue or object store.

## Ports

| Port | Process | Notes |
|---|---|---|
| 3000 | NestJS API | Loopback by default |
| 5173 | Vite dev server | Development only |
| 8080 | nginx web container | Docker; proxies `/api` to the API |
| 5099 | Mock AI gateway | Only with `AI_MOCK=1`, loopback only |

## Docker

```bash
cp .env.example .env
# set AI_API_KEY; adjust AI_BASE_URL and AI_MODEL if needed
docker compose up -d --build
# open http://localhost:8080
```

Compose runs two services:

- `server` builds the `server` target and mounts
  `./apps/server/data:/app/apps/server/data`.
- `web` builds the `web` target, serves the static app on `8080` and proxies
  `/api` to `server:3000`.

The API port is published on `127.0.0.1:3000`, not on all interfaces. Set
`CORS_ORIGIN=http://localhost:8080` when using the nginx address.

Compose reads `AI_API_KEY` as a required value and defaults `AI_MODEL` to
`agnes-3.0-flash`; the application itself does not assume a model. If
`DATABASE_PATH` is unset, the container uses
`/app/apps/server/data/sciflow.db`, which is the mounted volume.

## Manual install

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
# fill AI_BASE_URL, AI_API_KEY, AI_MODEL
pnpm --filter @sciflow/server build
node apps/server/dist/apps/server/src/main.js
# API: http://localhost:3000/api/health
```

For the UI, run `pnpm --filter @sciflow/web dev` and open
`http://localhost:5173`, or serve `apps/web/dist` behind nginx and proxy `/api`
to port 3000.

## Important environment variables

| Variable | Role | Default |
|---|---|---|
| `PORT` | API port | 3000 |
| `HOST` | Listen address | `127.0.0.1` |
| `DATABASE_PATH` | SQLite file | `apps/server/data/sciflow.db` |
| `AI_BASE_URL` | OpenAI-compatible endpoint | 火山方舟 |
| `AI_API_KEY` | Provider key | empty; AI features disabled |
| `AI_MODEL` | Default model | empty |
| `CORS_ORIGIN` | Allowed web origins | local Vite origins |
| `SANDBOX_TIMEOUT_MS` | Experiment timeout | 10000 |
| `SCIFLOW_BROWSERS_PATH` | Playwright browser cache | auto-detected |
| `BROWSER_MAX_SESSIONS` | Concurrent browser sessions | 3 |

The full variable table is in the
[Chinese deployment guide](deployment.zh-CN.md). Defaults are defined by the
code and `apps/server/.env.example`.

## Runtime dependencies

- Python 3.10+ for the experiment runner. Without it, experiments return a
  readable error and the rest of the app still works.
- Playwright Chromium for the built-in browser. Install with
  `npx playwright install chromium`, or point `SCIFLOW_BROWSERS_PATH` at a
  cached install.
- `better-sqlite3` and `sqlite-vec` are native modules. Rebuild them after an
  Electron or Node upgrade: `pnpm rebuild`.

The experiment runner passes a filtered environment to the child process, so
server secrets such as `AI_API_KEY` and `SCIFLOW_SECRET` are not inherited.

## Logs and shutdown

Logs are JSON on stdout. The API handles `SIGTERM` and `SIGINT` by checkpointing
WAL and closing the database. In Docker, use `docker compose logs -f server`.

## Backup

All data is in `DATABASE_PATH` (WAL mode). For a cold copy:

```bash
docker compose stop server
cp apps/server/data/sciflow.db backups/sciflow-$(date +%F).db
# copy -wal and -shm too if present
docker compose start server
```

For a live backup, use `node scripts/backup-db.mjs`. To reset to a clean state,
stop the API, remove the database and its `-wal`/`-shm` files, then start again;
the schema and seed data are recreated.
