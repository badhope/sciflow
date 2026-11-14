/**
 * 全功能 API 覆盖测试（真实 HTTP 调用，非单元测试）。
 *
 * 目的：回答「所有功能是不是真的能用」——按模块逐个打真实接口，
 * 断言状态码与关键字段，并把 4xx/5xx 与异常响应体收集成报告。
 *
 * 用法：
 *   node scripts/api-coverage.mjs                 # 自带 mock 后端（随机端口，跑完关闭）
 *   node scripts/api-coverage.mjs --base URL      # 打已有后端
 *   node scripts/api-coverage.mjs --json out.json # 额外输出机器可读结果
 *
 * 设计约束：
 *  - 只做可重复的写操作（自建项目/文档/书籍），不改全局配置、不删真实数据；
 *  - 破坏性接口（删除项目、重置内置扩展）不调用；
 *  - AI 相关接口在 mock 后端下由 mock 网关应答，验证的是「链路通」而非模型质量。
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const PORT = Number(argOf('--port', String(43400 + Math.floor(Math.random() * 60))));
const BASE = argOf('--base', `http://127.0.0.1:${PORT}`);
const DB = path.resolve(argOf('--db', path.join(process.env.TEMP || '.', `sciflow-api-${crypto.randomUUID()}.db`)));
const JSON_OUT = argOf('--json', '');
const SERVER_ENTRY = argOf('--server', 'apps/server/dist/apps/server/src/main.js');

const results = [];
let projectId = '';
let docId = '';
let refId = '';
let bookId = '';
let programId = '';

function startServer() {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: { ...process.env, AI_MOCK: '1', DATABASE_PATH: DB, PORT: String(PORT), HOST: '127.0.0.1', SCIFLOW_NO_VEC: '1', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  return child;
}

async function waitHealthy(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`后端未就绪：${BASE}`);
}

/** 单次调用 + 断言；expect 返回 true 表示通过 */
async function call(module, name, method, p, body, check = () => true, opts = {}) {
  const t0 = Date.now();
  let status = 0;
  let data = null;
  let error = '';
  try {
    const res = await fetch(`${BASE}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Sciflow-Actor': 'coverage' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.timeout ? AbortSignal.timeout(opts.timeout) : undefined,
    });
    status = res.status;
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) error = typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : String(data).slice(0, 200);
  } catch (e) {
    error = String(e?.message || e).slice(0, 200);
  }
  // expectStatus：负向用例（如畸形入参应返回 400）用它显式声明期望码，否则非 2xx 一律判失败
  const statusOk = opts.expectStatus ? status === opts.expectStatus : status >= 200 && status < 300;
  const ok = statusOk && (() => {
    try {
      return check(data, status);
    } catch {
      return false;
    }
  })();
  results.push({ module, name, method, path: p, status, ok, error, ms: Date.now() - t0 });
  const flag = ok ? 'OK ' : 'FAIL';
  console.log(`${flag} ${module.padEnd(12)} ${name.padEnd(34)} ${method.padEnd(5)} ${p.padEnd(52)} ${status}${ok ? '' : `  ${error}`}`);
  return { ok, status, data };
}

async function main() {
  const external = args.includes('--base');
  let server = null;
  if (!external) {
    server = startServer();
    await waitHealthy();
  }

  // ── 基础 ─────────────────────────────────────────────
  await call('health', 'health', 'GET', '/api/health', undefined, (d) => d?.ok !== false);
  await call('health', 'deep health', 'GET', '/api/health/deep', undefined, (d) => !!d);
  await call('health', 'metrics', 'GET', '/api/metrics', undefined, (d) => typeof d === 'string' && d.includes('sciflow_'));

  // ── 项目 / 文档 ──────────────────────────────────────
  const proj = await call('projects', 'create', 'POST', '/api/projects', { name: `覆盖测试 ${Date.now()}`, description: 'API 覆盖' }, (d) => !!d?.id);
  projectId = proj.data?.id || '';
  await call('projects', 'list', 'GET', '/api/projects', undefined, (d) => Array.isArray(d));
  await call('projects', 'get', 'GET', `/api/projects/${projectId}`, undefined, (d) => d?.id === projectId);
  await call('projects', 'update', 'PATCH', `/api/projects/${projectId}`, { description: '已更新' }, (d) => !!d);
  await call('projects', 'export bundle', 'GET', `/api/projects/${projectId}/export`, undefined, (d) => !!d);

  const doc = await call('documents', 'create', 'POST', '/api/documents', { projectId, title: '覆盖测试稿' }, (d) => !!d?.id);
  docId = doc.data?.id || '';
  await call('documents', 'list', 'GET', `/api/documents?projectId=${projectId}`, undefined, (d) => Array.isArray(d));
  await call('documents', 'get', 'GET', `/api/documents/${docId}`, undefined, (d) => d?.id === docId);
  await call('documents', 'update content', 'PATCH', `/api/documents/${docId}`, { content: '# 标题\n\n正文内容足够长以通过最短长度限制，用于覆盖测试。'.repeat(4) }, (d) => !!d);
  await call('documents', 'snapshot', 'POST', `/api/documents/${docId}/snapshot`, { commitMessage: '覆盖测试快照' }, (d) => d?.created !== undefined);
  await call('documents', 'objective audit', 'GET', `/api/documents/${docId}/objective-audit`, undefined, (d) => d?.report?.totalScore !== undefined);
  await call('documents', 'citation audit', 'GET', `/api/documents/${docId}/citation-audit`, undefined, (d) => d?.score !== undefined);
  await call('documents', 'export markdown', 'GET', `/api/documents/${docId}/export`, undefined, (d) => typeof d?.markdown === 'string');
  await call('documents', 'export docx', 'GET', `/api/documents/${docId}/export-docx`, undefined, (d) => typeof d?.base64 === 'string' && d.base64.length > 100);

  // ── 文献 / 引用 ──────────────────────────────────────
  const ref = await call('references', 'create', 'POST', '/api/references', {
    projectId,
    hit: { title: 'A Coverage Test Reference', authors: ['Zhang, Wei'], year: 2024, venue: 'Test Journal', doi: '10.1000/test.1', abstract: 'coverage test abstract' },
  }, (d) => !!d?.id);
  refId = ref.data?.id || '';
  await call('references', 'list', 'GET', `/api/references?projectId=${projectId}`, undefined, (d) => Array.isArray(d));
  await call('references', 'search local', 'POST', '/api/references/search', { query: 'coverage', projectId }, (d) => Array.isArray(d));
  await call('references', 'add citation', 'POST', `/api/documents/${docId}/citations`, { referenceId: refId }, (d) => !!d);
  await call('references', 'list citations', 'GET', `/api/documents/${docId}/citations`, undefined, (d) => Array.isArray(d));
  await call('references', 'export citations', 'GET', `/api/documents/${docId}/export-citations?format=apa`, undefined, (d) => Array.isArray(d));

  // ── 质量 ─────────────────────────────────────────────
  await call('quality', 'review', 'POST', '/api/quality', { documentId: docId, title: '覆盖测试稿', content: '# 标题\n\n这是一段用于质量评分的正文。'.repeat(20) }, (d) => typeof d?.totalScore === 'number' && d?.scoreSource === 'split');
  await call('quality', 'latest', 'GET', `/api/quality/latest?documentId=${docId}`, undefined, (d) => d?.documentId === docId);
  await call('quality', 'history', 'GET', `/api/quality?documentId=${docId}`, undefined, (d) => Array.isArray(d));
  await call('quality', 'project overview', 'GET', `/api/quality/project-overview?projectId=${projectId}`, undefined, (d) => Array.isArray(d?.items) && typeof d?.items[0]?.passScore === 'number');

  // ── 实验沙箱（三种运行时） ────────────────────────────
  await call('experiments', 'run python', 'POST', '/api/experiments/run', { projectId, goal: 'python', code: 'print(sum(range(5)))' }, (d) => d?.status === 'ok' && d?.runtime === 'python' && String(d?.stdout).includes('10'));
  await call('experiments', 'run node', 'POST', '/api/experiments/run', { projectId, goal: 'node', code: 'console.log(2**5)' }, (d) => d?.status === 'ok' && d?.runtime === 'node' && String(d?.stdout).includes('32'));
  await call('experiments', 'run shell', 'POST', '/api/experiments/run', { projectId, goal: 'shell', runtime: 'shell', code: process.platform === 'win32' ? '@echo off\r\necho shell-ok' : '#!/bin/sh\r\necho shell-ok' }, (d) => d?.status === 'ok' && String(d?.stdout).includes('shell-ok'));
  await call('experiments', 'list', 'GET', `/api/experiments?projectId=${projectId}`, undefined, (d) => Array.isArray(d));

  // ── 长篇写作 ─────────────────────────────────────────
  const book = await call('longform', 'create book', 'POST', '/api/longform/books', { projectId, title: '覆盖测试书', premise: '测试设定', targetCharsPerChapter: 800 }, (d) => !!d?.id);
  bookId = book.data?.id || '';
  await call('longform', 'add volume', 'POST', `/api/longform/books/${bookId}/volumes`, { title: '第一卷', goal: '测试', chapters: 2 }, (d) => d?.chapters?.length === 2);
  await call('longform', 'write one chapter', 'POST', `/api/longform/books/${bookId}/write-next`, {}, (d) => d?.chapter?.seq === 1);
  await call('longform', 'consistency', 'GET', `/api/longform/books/${bookId}/consistency`, undefined, (d) => typeof d?.score === 'number' && Array.isArray(d?.issues));
  await call('longform', 'compile', 'GET', `/api/longform/books/${bookId}/compile`, undefined, (d) => typeof d?.markdown === 'string' && d.chapters >= 1);

  // ── Web 项目沙箱（真实 npm 构建 + 预览） ──────────────
  await call('web-sandbox', 'templates', 'GET', '/api/web-projects/templates', undefined, (d) => Array.isArray(d) && d.length >= 1);
  const wp = await call('web-sandbox', 'create', 'POST', '/api/web-projects', { projectId, name: `cov-web-${Date.now()}`, template: 'static' }, (d) => !!d?.id);
  const wpId = wp.data?.id || '';
  await call('web-sandbox', 'list', 'GET', `/api/web-projects?projectId=${projectId}`, undefined, (d) => Array.isArray(d));
  await call('web-sandbox', 'run-all', 'POST', `/api/web-projects/${wpId}/run-all`, undefined, (d) => d?.ok === true && typeof d?.url === 'string');
  await call('web-sandbox', 'stop', 'POST', `/api/web-projects/${wpId}/stop`, undefined, (d) => d?.stopped === true);

  // ── 内置浏览器（真实 Chromium） ──────────────────────
  const bs = await call('browser', 'open', 'POST', '/api/browser/sessions', { url: 'https://example.com' }, (d) => !!d?.id, { timeout: 60000 });
  if (bs?.data?.id) {
    const bid = bs.data.id;
    await call('browser', 'text', 'GET', `/api/browser/sessions/${bid}/text`, undefined, (d) => typeof d?.text === 'string' && d.text.length > 0);
    await call('browser', 'screenshot', 'GET', `/api/browser/sessions/${bid}/screenshot`, undefined, (d) => String(d?.dataUrl || '').startsWith('data:image/png'));
    await call('browser', 'elements', 'GET', `/api/browser/sessions/${bid}/elements`, undefined, (d) => Array.isArray(d?.elements));
    await call('browser', 'close', 'DELETE', `/api/browser/sessions/${bid}`, undefined, (d) => d?.ok === true);
  }
  await call('browser', 'rejects loopback', 'POST', '/api/browser/sessions', { url: 'http://127.0.0.1:1/' }, () => true, { expectStatus: 400 });

  // ── 科研对象 / 研究循环 ──────────────────────────────
  const prog = await call('programs', 'create program', 'POST', '/api/programs', { projectId, title: '覆盖测试计划', goal: '验证', autonomyLevel: 'L2' }, (d) => !!d?.id);
  programId = prog.data?.id || '';
  await call('programs', 'list', 'GET', `/api/programs?projectId=${projectId}`, undefined, (d) => Array.isArray(d));
  await call('programs', 'get', 'GET', `/api/programs/${programId}`, undefined, (d) => d?.id === programId);
  await call('programs', 'create cycle', 'POST', `/api/programs/${programId}/cycles`, { objective: '覆盖测试循环' }, (d) => !!d?.id);
  await call('programs', 'list cycles', 'GET', `/api/programs/${programId}/cycles`, undefined, (d) => Array.isArray(d));
  await call('research-cycles', 'list', 'GET', `/api/research-cycles?programId=${programId}`, undefined, (d) => Array.isArray(d));

  // ── 知识库 ───────────────────────────────────────────
  await call('knowledge', 'list docs', 'GET', `/api/knowledge?projectId=${projectId}`, undefined, () => true);
  await call('knowledge', 'query', 'POST', '/api/knowledge/query', { projectId, question: '覆盖测试问题' }, () => true);

  // ── 记忆 ─────────────────────────────────────────────
  await call('memory', 'create', 'POST', '/api/memory', { projectId, type: 'episodic', content: '覆盖测试记忆：本轮验证了记忆写入。' }, (d) => !!d?.id);
  await call('memory', 'list', 'GET', `/api/memory?projectId=${projectId}`, undefined, (d) => Array.isArray(d));

  // ── 对话（mock 模型） ────────────────────────────────
  await call('chat', 'answer', 'POST', '/api/chat', { message: '用一句话说明什么是质量门', projectId }, (d) => typeof d?.answer === 'string' && d.answer.length > 0);

  // ── MCP ──────────────────────────────────────────────
  await call('mcp', 'info', 'GET', '/api/mcp/info', undefined, (d) => !!d?.version || !!d?.name);
  await call('mcp', 'tools', 'GET', '/api/mcp/tools', undefined, (d) => (Array.isArray(d) ? d.length : d?.tools?.length) >= 20);
  await call('mcp', 'config.snapshot', 'POST', '/api/mcp/call', { name: 'config.snapshot', arguments: {} }, (d) => !!d?.content);

  // ── 设置 / 用量 / 配置中心 / 扩展 / 自定义 ────────────
  await call('settings', 'get', 'GET', '/api/settings', undefined, (d) => !!d?.ai);
  await call('settings', 'self check', 'GET', '/api/settings/check', undefined, (d) => typeof d?.ai?.ok === 'boolean');
  await call('settings', 'agent access', 'GET', '/api/settings/agent-access', undefined, (d) => typeof d?.mode === 'string' && Array.isArray(d?.modes));
  await call('usage', 'summary', 'GET', '/api/usage/summary', undefined, () => true);
  await call('config', 'get', 'GET', '/api/config', undefined, (d) => !!d);
  await call('config', 'permission', 'GET', '/api/config/permission', undefined, (d) => !!d?.mode);
  await call('config', 'roles', 'GET', '/api/config/roles', undefined, (d) => Array.isArray(d));
  await call('config', 'constraints', 'GET', '/api/config/constraints', undefined, (d) => Array.isArray(d));
  await call('config', 'hooks', 'GET', '/api/config/hooks', undefined, (d) => Array.isArray(d));
  await call('config', 'presets', 'GET', '/api/config/presets', undefined, () => true);
  await call('config', 'preview', 'GET', '/api/config/preview', undefined, () => true);
  await call('extensions', 'list', 'GET', '/api/extensions', undefined, (d) => Array.isArray(d) || Array.isArray(d?.items) || Array.isArray(d?.assets) || typeof d === 'object');
  await call('extensions', 'templates', 'GET', '/api/extensions/templates', undefined, () => true);
  await call('customization', 'intents', 'GET', '/api/customization/intents', undefined, () => true);
  await call('customization', 'pipeline steps', 'GET', '/api/customization/pipeline-steps', undefined, () => true);
  await call('customization', 'pipeline settings', 'GET', '/api/customization/pipeline-settings', undefined, () => true);
  await call('customization', 'quality weights', 'GET', '/api/customization/quality-weights', undefined, () => true);
  await call('judgment', 'intent', 'POST', '/api/judgment/intent', { text: '帮我写一篇论文' }, () => true);

  // ── 仪表盘 / 研究辅助 / 投稿 ─────────────────────────
  await call('dashboard', 'overview', 'GET', `/api/dashboard/overview?projectId=${projectId}`, undefined, (d) => typeof d?.docCount === 'number');
  await call('research', 'design review', 'POST', '/api/research/design-review', { idea: '覆盖测试研究想法' }, () => true);
  await call('research', 'comparison', 'POST', '/api/research/comparison', { papers: [{ title: 'Coverage Paper A', year: 2024, venue: 'Test J' }, { title: 'Coverage Paper B', year: 2023, venue: 'Test J' }] }, (d) => Array.isArray(d?.rows));
  await call('research', 'comparison rejects malformed', 'POST', '/api/research/comparison', { papers: 'not-an-array' }, () => true, { expectStatus: 400 });
  await call('research', 'review', 'POST', '/api/research/review', { title: '覆盖测试', content: '正文'.repeat(200) }, () => true);
  await call('submission', 'journals', 'POST', '/api/submission/journals', { title: '覆盖测试', abstract: '摘要', field: '计算机' }, () => true);
  await call('submission', 'cover letter', 'POST', '/api/submission/cover-letter', { title: '覆盖测试', abstract: '摘要', journal: 'Test Journal' }, () => true);
  await call('submission', 'track create', 'POST', '/api/submission/track', { projectId, journalName: 'Test Journal', documentId: docId }, (d) => typeof d?.title === 'string');
  await call('submission', 'track list', 'GET', `/api/submission/track?projectId=${projectId}`, undefined, (d) => Array.isArray(d));
  await call('web', 'search', 'POST', '/api/web/search', { q: 'coverage test' }, () => true);
  await call('agent', 'executions', 'GET', '/api/agent/executions', undefined, () => true);

  // ── 汇总 ─────────────────────────────────────────────
  const total = results.length;
  const failed = results.filter((r) => !r.ok);
  const byModule = {};
  for (const r of results) {
    byModule[r.module] ||= { total: 0, failed: 0 };
    byModule[r.module].total += 1;
    if (!r.ok) byModule[r.module].failed += 1;
  }
  console.log('\n=== 覆盖汇总 ===');
  for (const [m, v] of Object.entries(byModule)) console.log(`${v.failed ? 'FAIL' : 'OK  '} ${m.padEnd(14)} ${v.total - v.failed}/${v.total}`);
  console.log(`\n总计 ${total - failed.length}/${total} 通过`);

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, total, passed: total - failed.length, failed: results.filter((r) => !r.ok), byModule }, null, 2));
    console.log(`结果已写入 ${JSON_OUT}`);
  }

  if (server) {
    const exited = new Promise((res) => {
      server.once('exit', res);
      setTimeout(res, 5000);
    });
    server.kill();
    await exited;
  }
  for (const f of [DB, `${DB}-shm`, `${DB}-wal`]) {
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(f, { force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
