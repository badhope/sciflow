/**
 * SciFlow 桌面端 · 主进程
 *
 * 生命周期：单实例锁 → 启动内嵌后端 → 创建窗口（等待 /api/health 就绪）
 * 安全基线：contextIsolation + 无 nodeIntegration + 外链走系统浏览器 + 回环监听
 */

import { app, BrowserWindow, ipcMain, shell, Menu, dialog, protocol, nativeTheme, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { startServer, isDev, type ServerHandle } from './server-manager';
import { initAutoUpdater } from './auto-updater';

let serverHandle: ServerHandle | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;

// ---------- 桌面端日志（渲染进程错误只在 DevTools 可见，用户看不到 → 落盘便于排查） ----------
function desktopLog(line: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'desktop.log'), `[${new Date().toISOString()}] ${line}
`);
  } catch {
    /* 日志失败不影响运行 */
  }
  console.log(`[SciFlow Desktop] ${line}`);
}

// ---------- 全局兜底：后端/更新类异步异常不崩窗口 ----------
process.on('unhandledRejection', (reason) => {
  console.error('[SciFlow Desktop] unhandledRejection:', reason instanceof Error ? reason.stack : String(reason));
});
process.on('uncaughtException', (err) => {
  console.error('[SciFlow Desktop] uncaughtException:', err.stack || err.message);
});

// ---------- 自定义协议：app:// ----------
// 为什么不能用 file://（实测白屏根因）：
//   1) index.html 里的 ES module 是 `<script type="module">`，Chromium 对 file:// 页面
//      的模块请求按 CORS 处理，origin 为 null → 直接拒绝（Access to script ... blocked by CORS policy）；
//   2) 即使改成相对路径，file:// 也不允许 modulepreload/CSS 跨目录加载。
// 解法：注册一个 standard + secure 的自定义协议，从 resources/web 提供静态文件。
// 这样页面有正常 origin（app://sciflow），ES module / fetch / localStorage 全部可用。
const APP_SCHEME = 'app';
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

/** resources/web 根目录（打包后 = process.resourcesPath/web；开发时不使用该协议） */
function webRoot(): string {
  return path.join(process.resourcesPath, 'web');
}

/** 注册 app:// 静态文件处理器（含路径穿越防护与 MIME） */
function registerAppProtocol(): void {
  const root = path.resolve(webRoot());
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
  };

  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      // app://sciflow/<path> → pathname
      let rel = decodeURIComponent(url.pathname || '/');
      if (rel === '/' || rel === '') rel = '/index.html';
      const target = path.resolve(root, '.' + rel);
      // 路径穿越防护：必须仍在 web 根目录内
      if (target !== root && !target.startsWith(root + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        // SPA 回退：未知路径交给 index.html（hash 路由不会触发，但静态资源拼错时更宽容）
        const fallback = path.join(root, 'index.html');
        return new Response(fs.readFileSync(fallback), {
          status: 200,
          headers: { 'Content-Type': MIME['.html'] },
        });
      }
      const ext = path.extname(target).toLowerCase();
      return new Response(fs.readFileSync(target), {
        status: 200,
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
      });
    } catch (e) {
      console.error('[SciFlow Desktop] app:// 读取失败:', e);
      return new Response('Not Found', { status: 404 });
    }
  });
}

// ---------- 单实例锁：二次启动唤起已有窗口 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ---------- 优雅退出：先停后端（WAL 安全落盘），再退进程 ----------
async function gracefulQuit() {
  if (quitting) return;
  quitting = true;
  try {
    if (serverHandle) await serverHandle.stop();
  } catch (e) {
    console.error('[SciFlow Desktop] 停止后端失败（继续退出）:', e);
  }
  app.exit(0);
}

app.on('before-quit', (e) => {
  if (!quitting && serverHandle) {
    e.preventDefault();
    void gracefulQuit();
  }
});
app.on('window-all-closed', () => {
  // 内嵌后端随窗口关闭一起退出：数据已在 SIGTERM 时安全落盘
  void gracefulQuit();
});

// ---------- IPC：渲染进程能力桥 ----------
ipcMain.on('app:open-external', (_e, url: unknown) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    void shell.openExternal(url);
  }
});
ipcMain.on('app:get-info', (e) => {
  // preload 以 sendSync 同步获取：窗口加载前完成注入
  e.returnValue = {
    apiBase: serverHandle ? `http://127.0.0.1:${serverHandle.port}` : '',
    version: app.getVersion(),
    platform: process.platform,
    mode: isDev ? 'dev' : 'production',
  };
});

// ---------- 窗口创建 ----------
function createWindow(apiBase: string) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    title: 'SciFlow · 让科研从想法到成文',
    // 窗口底色跟随系统明暗：固定浅色会让深色用户启动时闪白一帧
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#101318' : '#f5f4f0',
    autoHideMenuBar: true,
    show: false,
    icon: isDev ? path.join(__dirname, '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  // 外链一律走系统浏览器，不在应用内开新窗
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // 生产环境禁用 DevTools 快捷键误触（dev 保留）
  if (!isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') event.preventDefault();
    });
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // 加载失败/渲染崩溃必须留下证据（否则用户只看到白屏或「Error」页）
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    desktopLog(`did-fail-load code=${code} desc=${desc} url=${url}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    desktopLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) desktopLog(`renderer[${level}] ${String(message).slice(0, 400)} @${source}:${line}`);
  });

  if (isDev) {
    const devUrl = process.env.SCIFLOW_DEV_WEB_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<body style="font-family:sans-serif;background:#f5f4f0;color:#262b33;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0">
             <h2>未检测到前端开发服务器</h2>
             <p>请先在仓库根目录执行：<code>pnpm dev:web</code>，然后重启桌面端（<code>pnpm desktop:dev</code>）。</p>
             <p style="color:#64748b">后端 API 已就绪：${apiBase}</p></body>`,
          ),
      );
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 走 app:// 而不是 file://：file:// 下 ES module 会被 CORS 拒绝（白屏根因）
    desktopLog('load app://sciflow/index.html');
    mainWindow.loadURL('app://sciflow/index.html').catch((e) => {
      desktopLog(`loadURL 失败: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- 应用就绪：起后端 → 起窗口 → 可选自动更新 ----------
// 单实例锁失败时 app.quit() 已触发，此处必须以 gotLock 收口：
// 否则 quit 过程中 whenReady 仍可能 resolve，第二实例会重复 spawn 后端/开窗。
async function bootstrap() {
  // 自定义协议必须在 app ready 之后注册（registerSchemesAsPrivileged 则在模块顶层）
  registerAppProtocol();

  // macOS 必须保留应用菜单：置 null 会导致 Cmd+C/V/Q 等标准编辑快捷键全部失效；
  // Windows/Linux 无菜单栏依赖，保持无菜单（应用内导航 + ⌘K 命令面板）。
  if (process.platform === 'darwin') {
    const template: MenuItemConstructorOptions[] = [
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }

  try {
    serverHandle = await startServer();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void dialog.showErrorBox(
      'SciFlow 启动失败',
      `内嵌后端未能启动：\n\n${msg}\n\n日志目录：${app.getPath('userData')}${path.sep}logs`,
    );
    app.exit(1);
    return;
  }

  createWindow(`http://127.0.0.1:${serverHandle.port}`);
  void initAutoUpdater();
}

if (gotLock) {
  void app.whenReady().then(bootstrap);
}
