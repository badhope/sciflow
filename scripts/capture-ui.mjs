/**
 * 全页面截图自动化（真实运行 + 种子数据）。
 *
 * 与旧脚本的区别：
 *  - 自带启停：脚本自己拉起 mock 后端（随机端口）与静态站点，跑完自动关闭，不留进程；
 *  - 覆盖全部一级页面（含新增的长篇写作、研究计划）与设置页关键分区；
 *  - 每张图先确认关键内容已渲染（不是空白/骨架），失败即报错而不是截一张空图；
 *  - 同时产出浅色 + 深色，供 README 与文档直接引用。
 *
 * 用法：node scripts/capture-ui.mjs [--base http://127.0.0.1:PORT] [--out docs/screenshots]
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

const OUT = path.resolve(argOf('--out', 'docs/screenshots'));
const W = 1600;
const H = 1000;
const PORT = Number(argOf('--port', String(43300 + Math.floor(Math.random() * 60))));
const BASE = argOf('--base', `http://127.0.0.1:${PORT}`);
const DB = path.resolve(argOf('--db', path.join(process.env.TEMP || '.', `sciflow-shots-${crypto.randomUUID()}.db`)));
const SERVER_ENTRY = argOf('--server', 'apps/server/dist/apps/server/src/main.js');

/** 页面清单：hash 路由 + 等待内容就绪的断言（避免截到骨架屏） */
const PAGES = [
  { name: 'workspace', hash: '#/workspace', expect: /运行流水线|发送|问问题/ },
  { name: 'dashboard', hash: '#/dashboard', expect: /项目总览|驾驶舱|阶段/ },
  { name: 'programs', hash: '#/programs', expect: /研究计划|自主研究循环/ },
  { name: 'literature', hash: '#/literature', expect: /文献|检索/ },
  { name: 'knowledge', hash: '#/knowledge', expect: /知识库|上传/ },
  { name: 'experiments', hash: '#/experiments', expect: /实验|沙箱/ },
  { name: 'pipeline', hash: '#/pipeline', expect: /流水线/ },
  { name: 'writing', hash: '#/writing', expect: /写作|正文|章节/ },
  { name: 'longform', hash: '#/longform', expect: /长篇写作/ },
  { name: 'quality', hash: '#/quality', expect: /质量/ },
  { name: 'submission', hash: '#/submission', expect: /投稿|期刊/ },
  { name: 'memory', hash: '#/memory', expect: /记忆/ },
  { name: 'settings', hash: '#/settings', expect: /设置|AI 服务/ },
];

function startServer() {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      AI_MOCK: '1',
      DATABASE_PATH: DB,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SCIFLOW_NO_VEC: '1',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${String(d).slice(0, 300)}`));
  return child;
}

async function waitHealthy(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`后端未在 ${timeoutMs}ms 内就绪：${BASE}`);
}

async function seed() {
  const post = (p, body) =>
    fetch(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const project = await post('/api/projects', { name: '界面截图项目', description: '截图自动化种子数据' });
  await post('/api/documents', { projectId: project.id, title: '示例论文草稿' });
  await post(`/api/longform/books`, { projectId: project.id, title: '雾港纪事', premise: '近未来海港，档案员追查失踪船只', targetCharsPerChapter: 800 });
  return project.id;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null;
  const external = args.includes('--base');
  if (!external) {
    server = startServer();
    await waitHealthy();
  }
  const projectId = await seed();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  // 选中种子项目（深链 + localStorage 与 App 的选项目逻辑一致）
  await page.goto(`${BASE}/#/workspace`, { waitUntil: 'networkidle' });
  await page.evaluate((pid) => {
    localStorage.setItem('sciflow.currentProjectId', pid);
    localStorage.setItem('sciflow-theme', 'light');
  }, projectId);
  await page.reload({ waitUntil: 'networkidle' });

  const shoot = async (suffix = '') => {
    for (const p of PAGES) {
      await page.goto(`${BASE}/${p.hash}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const body = await page.locator('main').innerText().catch(() => '');
      if (!p.expect.test(body)) {
        throw new Error(`页面 ${p.name} 未渲染预期内容（可能空白/报错）：${body.slice(0, 120)}`);
      }
      const file = path.join(OUT, `${p.name}${suffix}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const kb = (fs.statSync(file).size / 1024).toFixed(0);
      console.log(`OK  ${`${p.name}${suffix}.png`.padEnd(24)} ${kb} KB`);
    }
  };

  await shoot('');
  // 深色：只截关键 3 页，避免图片过多
  await page.evaluate(() => localStorage.setItem('sciflow-theme', 'dark'));
  for (const name of ['dashboard', 'quality', 'settings']) {
    const p = PAGES.find((x) => x.name === name);
    await page.goto(`${BASE}/${p.hash}`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const file = path.join(OUT, `${name}-dark.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`OK  ${`${name}-dark.png`.padEnd(24)} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }

  await browser.close();
  if (server) {
    // 先等子进程真正退出再删库：Windows 上进程未退出时删 sqlite 文件会 EPERM
    const exited = new Promise((res) => {
      server.once('exit', res);
      setTimeout(res, 5000);
    });
    server.kill();
    await exited;
  }
  // 清理临时库：Windows 句柄释放有延迟，重试几次；仍失败只警告，不影响截图结果
  for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) {
    for (let i = 0; i < 6; i++) {
      try {
        fs.rmSync(f, { force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  if (fs.existsSync(DB)) console.warn(`提示：临时库未能删除（${DB}），可稍后手动清理`);

  const realErrors = errors.filter((e) => !/favicon|ResizeObserver/i.test(e));
  if (realErrors.length) {
    console.error(`\n页面错误 ${realErrors.length} 条：`);
    for (const e of realErrors.slice(0, 10)) console.error(' -', e);
    process.exit(1);
  }
  console.log(`\n完成：${PAGES.length} 张浅色 + 3 张深色，无页面错误。`);
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
