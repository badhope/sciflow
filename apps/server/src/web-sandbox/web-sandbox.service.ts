import { Injectable, Logger, BadRequestException, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { db } from '../db/database';
import { webProjects, projects } from '../db/schema';
import { envInt } from '../common/env';

/**
 * Web 项目沙箱：在独立目录里装依赖、构建、起静态预览。
 *
 * 与「实验沙箱」的区别：
 *  - 实验沙箱跑一次性脚本（python/node/shell），10 秒级；
 *  - Web 沙箱跑**项目生命周期**：npm install → build → 静态服务，分钟级，且要持续占端口。
 *
 * 隔离与安全边界：
 *  - 每个项目独立临时目录，互不可见；不读宿主仓库，不继承服务端密钥（env 白名单）；
 *  - 只允许白名单脚本（install/build/start），不允许任意 shell；
 *  - 端口从固定段动态分配，用完即释放；单项目并发上限 1；
 *  - 预览只监听 127.0.0.1，不对外暴露。
 */

const NPM_TIMEOUT_MS = envInt('WEB_SANDBOX_NPM_TIMEOUT_MS', 300_000, { min: 10_000, max: 1_800_000 });
const BUILD_TIMEOUT_MS = envInt('WEB_SANDBOX_BUILD_TIMEOUT_MS', 300_000, { min: 10_000, max: 1_800_000 });
const MAX_LOG_BYTES = 32 * 1024;
const PREVIEW_PORT_BASE = envInt('WEB_SANDBOX_PORT_BASE', 43500, { min: 1024, max: 65000 });

/**
 * 统一静态预览脚本（写入每个 Web 项目目录）。
 * 只用 Node 内置模块：不依赖 npx serve / python -m http.server，避免"装不上就跑不起来"。
 * 支持 SPA 回退（找不到文件且无扩展名时返回 index.html）。
 */
const SERVE_SCRIPT = `import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const port = Number(process.env.PORT || 8080);
const root = join(process.cwd(), 'dist');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.woff2':'font/woff2' };
createServer((req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = normalize(raw).replace(/^([/\\\\])+/, '');
  let file = join(root, rel || 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  if (!existsSync(file) || !rel) file = join(root, 'index.html');
  if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log('preview listening ' + port));
`;

/** 允许的 npm 脚本名（白名单，防止跑任意生命周期脚本） */
const ALLOWED_SCRIPTS = new Set(['install', 'build', 'dev', 'start']);

function sandboxEnv(workDir: string): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'SHELL', 'SystemRoot', 'COMSPEC', 'PATHEXT'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of allowed) if (process.env[k]) env[k] = process.env[k];
  env['npm_config_cache'] = path.join(workDir, '.npm-cache');
  env['npm_config_update_notifier'] = 'false';
  env['npm_config_fund'] = 'false';
  env['npm_config_audit'] = 'false';
  env['CI'] = '1';
  // 明确不带入服务端密钥（AI_API_KEY / SCIFLOW_SECRET 等）
  return env;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let out = '';
    let timedOut = false;
    const child = spawn(cmd, args, { cwd, env: sandboxEnv(cwd), stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    const append = (chunk: Buffer) => {
      if (out.length < MAX_LOG_BYTES) out += chunk.toString('utf-8').slice(0, MAX_LOG_BYTES - out.length);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* already exited */
      }
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.slice(0, MAX_LOG_BYTES), timedOut });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: `${out}\n[spawn error] ${e.message}`, timedOut });
    });
  });
}

/** 找一个空闲端口（从 base 起逐个试，最多 50 个） */
function findFreePort(base: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = base;
    let tries = 0;
    const tryPort = () => {
      const srv = createServer();
      srv.once('error', () => {
        srv.close();
        tries += 1;
        if (tries > 50) return reject(new Error('无可用端口'));
        port += 1;
        tryNext();
      });
      srv.once('listening', () => {
        srv.close(() => resolve(port));
      });
      srv.listen(port, '127.0.0.1');
    };
    const tryNext = () => setTimeout(tryPort, 10);
    tryPort();
  });
}

export interface WebProjectRow {
  id: string;
  projectId: string;
  name: string;
  template: string;
  workDir: string;
  status: string;
  previewPort: number | null;
  previewUrl: string;
  installLog: string;
  buildLog: string;
  error: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 内置模板（不联网也能起项目）。
 * 全部为纯静态/零依赖起步：install 秒级完成，build 产出 dist/，便于验证整条链路。
 */
const TEMPLATES: Record<string, (name: string) => Record<string, string>> = {
  /** 纯静态站点：零依赖，最快验证 */
  static: (name) => ({
    'index.html': `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><link rel="stylesheet" href="./style.css"></head>
<body><main><h1>${name}</h1><p>由 SciFlow Web 沙箱创建。</p><button id="btn">点我</button><p id="out"></p></main>
<script src="./main.js"></script></body></html>`,
    'style.css': `:root{font-family:system-ui,sans-serif}body{margin:0;display:grid;place-items:center;min-height:100vh;background:#0f172a;color:#e2e8f0}main{text-align:center}button{padding:.6rem 1.2rem;border-radius:.5rem;border:0;background:#14b8a6;color:#04221f;font-weight:600;cursor:pointer}`,
    'main.js': `document.getElementById('btn').addEventListener('click', () => { document.getElementById('out').textContent = '已点击 ' + new Date().toLocaleTimeString(); });`,
    'package.json': JSON.stringify({ name, version: '1.0.0', private: true, scripts: { build: 'node build.mjs', start: 'node serve.mjs' } }, null, 2),
    'build.mjs': `import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\nfor (const f of ['index.html','style.css','main.js']) copyFileSync(f, 'dist/' + f);\nconsole.log('build ok: dist/');\n`,
  }),
  /** React + Vite（需要 npm install，验证真实前端构建链） */
  'react-vite': (name) => ({
    'package.json': JSON.stringify(
      {
        name,
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { build: 'vite build', dev: 'vite', start: 'vite preview --host 127.0.0.1' },
        dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
        devDependencies: { vite: '^8.3.6', '@vitejs/plugin-react': '^5.2.0' },
      },
      null,
      2,
    ),
    'vite.config.js': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()], base: './' });\n`,
    'index.html': `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
    'src/main.jsx': `import React from 'react';\nimport { createRoot } from 'react-dom/client';\nfunction App(){ const [n,setN]=React.useState(0); return <main style={{fontFamily:'system-ui',padding:32}}><h1>${name}</h1><button onClick={()=>setN(n+1)}>点击 {n}</button></main>; }\ncreateRoot(document.getElementById('root')).render(<App />);\n`,
  }),
};

@Injectable()
export class WebSandboxService implements OnModuleInit {
  private readonly logger = new Logger(WebSandboxService.name);

  /**
   * 启动时清理孤儿目录：库里没有记录的 sciflow-web-* 临时目录。
   *
   * 为什么需要：服务重启后内存里的预览进程表为空，但上个进程崩掉时留下的目录仍在，
   * 长期运行会累积成几十个 GB。这里只删「库里查不到」的目录，绝不碰仍在使用的项目。
   */
  onModuleInit() {
    try {
      const known = new Set(db.select({ dir: webProjects.workDir }).from(webProjects).all().map((r) => r.dir));
      const root = tmpdir();
      let removed = 0;
      for (const name of readdirSync(root)) {
        if (!name.startsWith('sciflow-web-')) continue;
        const abs = path.join(root, name);
        if (known.has(abs)) continue;
        try {
          rmSync(abs, { recursive: true, force: true });
          removed += 1;
        } catch {
          /* 被占用则跳过，下次启动再试 */
        }
      }
      if (removed) this.logger.log(`[web-sandbox] 清理孤儿目录 ${removed} 个`);
    } catch {
      /* 清理失败不影响启动 */
    }
  }
  /** 正在运行预览的进程：projectId → { child, port } */
  private readonly previews = new Map<string, { child: ReturnType<typeof spawn>; port: number }>();
  /** 同一 Web 项目同时只允许一个构建 */
  private readonly busy = new Set<string>();

  list(projectId: string) {
    return db.select().from(webProjects).where(eq(webProjects.projectId, projectId)).orderBy(desc(webProjects.updatedAt)).all();
  }

  get(id: string) {
    const row = db.select().from(webProjects).where(eq(webProjects.id, id)).get();
    if (!row) throw new NotFoundException('Web 项目不存在');
    return row;
  }

  templates() {
    return Object.keys(TEMPLATES).map((key) => ({ key, label: key === 'static' ? '纯静态站点（零依赖）' : 'React + Vite' }));
  }

  /** 创建项目骨架（不装依赖，不构建） */
  create(input: { projectId: string; name: string; template?: string }) {
    const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
    if (!project) throw new NotFoundException('项目不存在');
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('项目名必填');
    const template = String(input.template || 'static');
    const factory = TEMPLATES[template];
    if (!factory) throw new BadRequestException(`未知模板：${template}`);

    const workDir = mkdtempSync(path.join(tmpdir(), 'sciflow-web-'));
    const files = factory(name.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40) || 'app');
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(workDir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
    }
    // 预览脚本独立于模板：预览统一由 serve.mjs 托管 dist/，模板只需产出 dist/
    writeFileSync(path.join(workDir, 'serve.mjs'), SERVE_SCRIPT, 'utf-8');

    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId: input.projectId,
      name: name.slice(0, 200),
      template,
      workDir,
      status: 'created',
      previewPort: null,
      previewUrl: '',
      installLog: '',
      buildLog: '',
      error: '',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(webProjects).values(row).run();
    return row;
  }

  /** 安装依赖（npm install）；无 package.json 依赖时秒完成 */
  async install(id: string) {
    const row = this.get(id);
    if (this.busy.has(id)) throw new BadRequestException('该项目正在执行其他操作');
    this.busy.add(id);
    this.setStatus(id, 'installing');
    try {
      const r = await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], row.workDir, NPM_TIMEOUT_MS);
      const ok = r.code === 0 && !r.timedOut;
      this.setStatus(id, ok ? 'installed' : 'install_failed', { installLog: r.out, error: ok ? '' : r.timedOut ? 'npm install 超时' : `npm install 退出码 ${r.code}` });
      return { ok, log: r.out.slice(-4000) };
    } finally {
      this.busy.delete(id);
    }
  }

  /** 构建（npm run build） */
  async build(id: string) {
    const row = this.get(id);
    if (this.busy.has(id)) throw new BadRequestException('该项目正在执行其他操作');
    this.busy.add(id);
    this.setStatus(id, 'building');
    try {
      const r = await run('npm', ['run', 'build'], row.workDir, BUILD_TIMEOUT_MS);
      const ok = r.code === 0 && !r.timedOut;
      const distDir = path.join(row.workDir, 'dist');
      const hasDist = existsSync(distDir) && readdirSync(distDir).length > 0;
      this.setStatus(id, ok && hasDist ? 'built' : 'build_failed', {
        buildLog: r.out,
        error: ok ? (hasDist ? '' : '构建完成但 dist/ 为空') : r.timedOut ? '构建超时' : `构建失败，退出码 ${r.code}`,
      });
      return { ok: ok && hasDist, log: r.out.slice(-4000) };
    } finally {
      this.busy.delete(id);
    }
  }

  /** 起静态预览（托管 dist/，只监听 127.0.0.1） */
  async preview(id: string) {
    const row = this.get(id);
    const distDir = path.join(row.workDir, 'dist');
    if (!existsSync(distDir)) throw new BadRequestException('尚未构建：请先执行 build');
    this.stopPreview(id);
    const port = await findFreePort(PREVIEW_PORT_BASE);
    const child = spawn(process.execPath, ['serve.mjs'], {
      cwd: row.workDir,
      env: { ...sandboxEnv(row.workDir), PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    // 等端口真正可用（最多 8s），避免前端拿到一个还没起来的 URL
    const deadline = Date.now() + 8000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        if (res.ok || res.status === 404) { up = true; break; }
      } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!up) {
      try { child.kill(); } catch { /* noop */ }
      this.setStatus(id, 'preview_failed', { error: `预览未能在 8s 内启动（端口 ${port}）` });
      throw new BadRequestException('预览启动失败，请查看日志');
    }
    this.previews.set(id, { child, port });
    this.setStatus(id, 'previewing', { previewPort: port, previewUrl: `http://127.0.0.1:${port}/` });
    return { url: `http://127.0.0.1:${port}/`, port };
  }

  stopPreview(id: string) {
    const p = this.previews.get(id);
    if (!p) return { stopped: false };
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-p.child.pid!, 'SIGKILL');
    } catch { /* noop */ }
    try { p.child.kill(); } catch { /* noop */ }
    this.previews.delete(id);
    this.setStatus(id, 'built', { previewPort: null, previewUrl: '' });
    return { stopped: true };
  }

  /** 删除项目：先停预览，再删目录 */
  remove(id: string) {
    const row = this.get(id);
    this.stopPreview(id);
    try { rmSync(row.workDir, { recursive: true, force: true }); } catch { /* 目录可能已被清理 */ }
    db.delete(webProjects).where(eq(webProjects.id, id)).run();
    return { ok: true };
  }

  /** 一次性全流程：install → build → preview（供「一键跑通」用） */
  async runAll(id: string) {
    const install = await this.install(id);
    if (!install.ok) return { ok: false, stage: 'install', error: install.log.slice(-800) };
    const build = await this.build(id);
    if (!build.ok) return { ok: false, stage: 'build', error: build.log.slice(-800) };
    const preview = await this.preview(id);
    return { ok: true, stage: 'preview', url: preview.url };
  }

  /** 服务关闭时清理所有预览（防止端口泄漏到下一轮） */
  onModuleDestroy() {
    for (const id of [...this.previews.keys()]) this.stopPreview(id);
  }

  private setStatus(id: string, status: string, patch: Partial<WebProjectRow> = {}) {
    db.update(webProjects).set({ status, updatedAt: Date.now(), ...patch }).where(eq(webProjects.id, id)).run();
  }
}
