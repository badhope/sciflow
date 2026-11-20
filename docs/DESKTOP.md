# Desktop app

**English** · [简体中文](DESKTOP.zh-CN.md)

The desktop build wraps the same API and web UI in Electron. It is a local
application, not a separate product.

## How it works

The Electron main process starts the bundled NestJS server on a random loopback
port, then loads the web build through the custom `app://sciflow/index.html`
protocol. The preload script exposes `window.sciflowDesktop.apiBase`, so the UI
can reach the embedded server without hard-coding a port.

`app://` is used instead of `file://` because the app relies on a normal origin
for routing, fetch, storage and service-worker-free caching. Do not change this
back to `file://`.

## Native modules and packaging

`better-sqlite3` is a native module and must match the Electron ABI.
`prepare-server.mjs` resolves the ABI for the current Electron version and tries
three sources in order:

1. The official GitHub prebuilt binary.
2. The npmmirror binary mirror.
3. A local `node-gyp` rebuild (requires Visual Studio C++ on Windows).

The packaged server lives under `resources/bundle/server`; `extraResources` must
keep that two-level layout. A flat layout silently drops the root
`node_modules` and produces a broken bundle.

## Build and run

```bash
pnpm --filter @sciflow/desktop dev
pnpm --filter @sciflow/desktop build
pnpm --filter @sciflow/desktop dist
```

The production installer is built by
`.github/workflows/desktop-installer.yml` on a `v*` tag or by manual dispatch.
The Windows NSIS installer and `latest.yml` are attached to the GitHub release.

## Debugging

Start with a CDP port and attach Playwright:

```bash
SCIFLOW_DESKTOP_DEBUG_PORT=9222 pnpm --filter @sciflow/desktop dev
```

The window title changes to the app title only after the renderer loads. If the
title stays at the Electron default, the web assets or the `app://` handler did
not load.

## Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Blank window | Web assets missing from `resources/web` | Rebuild the web app before packaging |
| `better-sqlite3` ABI error | Module built for the wrong Electron version | Re-run `prepare-server.mjs` and rebuild |
| API not reachable | Embedded server failed to start | Check the desktop server log |
| Port conflict | Another process on the chosen port | The app selects a free loopback port automatically |
| Installer missing assets | `extraResources` layout changed | Restore the two-level `resources/bundle/server` layout |
