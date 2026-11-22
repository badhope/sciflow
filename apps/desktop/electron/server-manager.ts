/**
 * SciFlow 桌面端 · 内嵌后端进程管理器
 *
 * 职责：
 *  1. 解析后端入口（dev：仓库内 apps/server/dist/apps/server/src/main.js；prod：resources/bundle/server/dist/apps/server/src/main.js）
 *  2. 以 ELECTRON_RUN_AS_NODE 方式用 Electron 自带 Node 运行后端（免分发独立 Node）
 *  3. 自动探测空闲端口，注入数据目录（userData 隔离）与 CORS（回环开放）
 *  4. 轮询 /api/health 直到就绪；退出时优雅终止（SIGTERM → 8s 超时 SIGKILL）
 *  5. 后端 stdout/stderr 落盘 userData/logs/server.log（支撑排障）
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { app } from 'electron';

export interface ServerHandle {
  port: number;
  stop: () => Promise<void>;
}

/** dev 模式判定：未打包 = 开发运行 */
export const isDev = !app.isPackaged;

/** userData 数据目录（Windows: %APPDATA%/SciFlow · macOS: ~/Library/Application Support/SciFlow） */
export const userDataDir = app.getPath('userData');
export const dbPath = path.join(userDataDir, 'sciflow.db');
export const logsDir = path.join(userDataDir, 'logs');

/** 后端入口路径 */
function resolveServerEntry(): string {
  if (isDev) {
    // __dirname = apps/desktop/dist-electron → 上两级 = apps/ → server/dist/main.js
    return path.join(__dirname, '..', '..', 'server', 'dist', 'apps', 'server', 'src', 'main.js');
  }
  // 打包后：extraResources 把 bundle 放到 resources/bundle/server。
  // 必须经二级目录（resources/bundle/...）——见 electron-builder.yml 的踩坑记录：
  // 根级 node_modules 会被 electron-builder 过滤器静默丢弃。
  return path.join(process.resourcesPath, 'bundle', 'server', 'dist', 'apps', 'server', 'src', 'main.js');
}

/** 探测一个空闲回环端口（内核分配， listen(0)） */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('端口探测失败：地址不可用'));
      }
    });
  });
}

/** 简易日志落盘（追加写；超过 5MB 截断保留后半，避免无限膨胀） */
function makeLogger(logFile: string) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  try {
    const st = fs.statSync(logFile);
    if (st.size > 5 * 1024 * 1024) {
      const buf = fs.readFileSync(logFile);
      fs.writeFileSync(logFile, buf.subarray(Math.floor(buf.length / 2)));
    }
  } catch {
    /* 首次无文件 */
  }
  return (line: string) => {
    try {
      fs.appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`);
    } catch {
      /* 落盘失败不阻塞 */
    }
  };
}

/** 轮询健康检查，直到 200 或超时 */
export function waitForHealth(port: number, timeoutMs = 60000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`后端健康检查超时（${timeoutMs}ms）`));
        return;
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

/** 启动内嵌后端并等待就绪 */
export async function startServer(): Promise<ServerHandle> {
  const entry = resolveServerEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(
      `后端入口不存在：${entry}\n` +
        (isDev
          ? '请先在仓库根目录执行：pnpm --filter @sciflow/server build'
          : '打包资源缺失，请重新执行：pnpm --filter @sciflow/desktop dist'),
    );
  }

  const port = await pickFreePort();
  fs.mkdirSync(logsDir, { recursive: true });
  const log = makeLogger(path.join(logsDir, 'server.log'));

  // AI 配置沿用外部环境变量（可选）；其余全部强制本地安全基线
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATABASE_PATH: dbPath,
    // 桌面端页面来自 file://，Origin 为 null；后端仅监听回环 + 单用户定位，回环内全放行
    CORS_ORIGIN: '*',
    SCIFLOW_DESKTOP: '1',
    // 远程控制时手机通过局域网访问内嵌后端，必须能拿到与 app:// 相同的 Web 产物。
    // 打包后：resources/web；开发态：仓库 apps/web/dist（相对本文件 dist-electron 上两级）。
    WEB_DIST: isDev
      ? path.join(__dirname, '..', '..', 'web', 'dist')
      : path.join(process.resourcesPath, 'web'),
    // 桌面端是单用户本机应用，必须允许连接 127.0.0.1 上的 Ollama / llama.cpp；
    // 服务端只监听回环，云元数据地址仍由出站守卫无条件拒绝。
    ALLOW_PRIVATE_OUTBOUND: '1',
  };
  delete env.NODE_OPTIONS; // 避免外部 NODE_OPTIONS 注入内嵌 Node

  log(`[${new Date().toISOString()}] 启动后端 pid=spawn entry=${entry} port=${port} db=${dbPath}`);
  const child: ChildProcess = spawn(process.execPath, [entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', (d: Buffer) => log(d.toString()));
  child.stderr?.on('data', (d: Buffer) => log(`[stderr] ${d.toString()}`));
  child.on('exit', (code, signal) => log(`[${new Date().toISOString()}] 后端退出 code=${code} signal=${signal}`));

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode) return;
    log(`[${new Date().toISOString()}] 停止后端（SIGTERM）`);
    child.kill('SIGTERM');
    const forceAfter = Date.now() + 8000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < forceAfter) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (child.exitCode === null && child.signalCode === null) {
      log(`[${new Date().toISOString()}] 优雅停止超时，强制 SIGKILL`);
      child.kill('SIGKILL');
    }
  };

  await waitForHealth(port);
  log(`[${new Date().toISOString()}] 后端就绪 http://127.0.0.1:${port}/api/health`);
  return { port, stop };
}
