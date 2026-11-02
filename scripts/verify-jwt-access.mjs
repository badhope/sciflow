#!/usr/bin/env node
/**
 * 企业模式权限边界验证（v1.8）—— 可重复执行的 23 项断言。
 *
 * 为什么必须在仓库里而不是临时脚本：
 * 本地模式（AUTH_MODE=none）下所有单测都能全绿，但真正部署到企业模式时的 403/404
 * 完全不会被覆盖。这个脚本用**真实 HTTP 请求**跑一遍两层边界，改权限代码前后各跑一次。
 *
 * 用法（会自动拉起独立库 + 独立端口的服务，结束即关）：
 *   node scripts/verify-jwt-access.mjs
 *   node scripts/verify-jwt-access.mjs --port 3110 --keep   # 自定义端口 + 保留服务
 *
 * 前提：已 `pnpm --filter @sciflow/server build`。
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 3110;
const KEEP = argv.includes('--keep');
const DB = path.join(os.tmpdir(), `sciflow-verify-jwt-${process.pid}.db`);
const SECRET = randomBytes(32).toString('hex');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${detail ? ' :: ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
};

const j = async (method, url, body, token) => {
  const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

const waitHealthy = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
};

const server = spawn('node', ['dist/apps/server/src/main.js'], {
  cwd: path.join(ROOT, 'apps/server'),
  env: { ...process.env, AUTH_MODE: 'jwt', ALLOW_REGISTRATION: '1', JWT_SECRET: SECRET, DATABASE_PATH: DB, PORT: String(PORT), LOG_LEVEL: 'silent' },
  stdio: 'ignore',
});

const cleanup = () => {
  if (!KEEP) { try { server.kill(); } catch {} }
  for (const f of [DB, DB + '-shm', DB + '-wal']) { try { fs.unlinkSync(f); } catch {} }
};

try {
  if (!(await waitHealthy())) { console.error('服务未就绪，检查是否已 build server'); cleanup(); process.exit(2); }
  console.log(`
企业模式权限边界验证（port=${PORT}）`);

  // —— 准备：admin（首位注册）+ member（第二位） ——
  const adminReg = await j('POST', '/api/auth/register', { email: 'admin@verify.local', password: 'password123' });
  const admin = adminReg.data?.token;
  ok('admin 注册且 role=admin', adminReg.status === 201 && adminReg.data?.user?.role === 'admin', `role=${adminReg.data?.user?.role}`);
  const pa = await j('POST', '/api/projects', { name: 'Admin 项目' }, admin);
  const pidA = pa.data?.id;
  const memberReg = await j('POST', '/api/auth/register', { email: 'member@verify.local', password: 'password123' });
  const member = memberReg.data?.token;
  ok('member 注册且 role=member', memberReg.status === 201 && memberReg.data?.user?.role === 'member', `role=${memberReg.data?.user?.role}`);
  const pb = await j('POST', '/api/projects', { name: 'Member 项目' }, member);
  const pidB = pb.data?.id;
  ok('member 可建自己项目', pb.status === 201, `st=${pb.status}`);

  // —— 第一层：数据面必须 404 ——
  ok('member 读他人项目文档 → 404', (await j('GET', `/api/documents?projectId=${pidA}`, null, member)).status === 404);
  ok('member 向他人项目传知识库 → 404', (await j('POST', '/api/knowledge/upload', { projectId: pidA, name: 'x.md', type: 'markdown', content: 'x' }, member)).status === 404);
  ok('member 读他人项目投稿 → 404', (await j('GET', `/api/submission/track?projectId=${pidA}`, null, member)).status === 404);
  ok('member 读他人项目记忆 → 404', (await j('GET', `/api/memory?projectId=${pidA}`, null, member)).status === 404);
  ok('member 读他人项目总览 → 404', (await j('GET', `/api/dashboard/overview?projectId=${pidA}`, null, member)).status === 404);
  ok('member 读他人项目执行轨迹 → 404', (await j('GET', `/api/agent/executions?projectId=${pidA}`, null, member)).status === 404);

  // —— 第二层：配置面必须 403 ——
  for (const [name, method, url, body] of [
    ['settings', 'GET', '/api/settings', null],
    ['config', 'GET', '/api/config', null],
    ['extensions', 'GET', '/api/extensions', null],
    ['customization', 'GET', '/api/customization/intents', null],
    ['usage', 'GET', '/api/usage/summary', null],
    ['websearch config', 'GET', '/api/web/config', null],
    ['提权 POST /config/permission', 'POST', '/api/config/permission', { mode: 'unrestricted' }],
  ]) {
    ok(`member ${name} → 403`, (await j(method, url, body, member)).status === 403);
  }

  // —— 第三层：admin 与自己的资源必须放行 ——
  for (const [name, url] of [
    ['settings', '/api/settings'], ['config', '/api/config'], ['extensions', '/api/extensions'],
    ['customization', '/api/customization/intents'], ['usage', '/api/usage/summary'],
  ]) {
    ok(`admin ${name} → 200`, (await j('GET', url, null, admin)).status === 200);
  }
  ok('member 读自己项目文档 → 200', (await j('GET', `/api/documents?projectId=${pidB}`, null, member)).status === 200);
  ok('member 读自己项目记忆 → 200', (await j('GET', `/api/memory?projectId=${pidB}`, null, member)).status === 200);
  ok('member 读自己项目总览 → 200', (await j('GET', `/api/dashboard/overview?projectId=${pidB}`, null, member)).status === 200);

  // —— 未登录与跨租户聚合 ——
  ok('无 token 访问 settings → 401', (await j('GET', '/api/settings')).status === 401);
  ok('总览无 projectId → 403', (await j('GET', '/api/dashboard/overview', null, member)).status === 403);
  ok('文档列表无 projectId → 400', (await j('GET', '/api/documents', null, member)).status === 400);
  ok('记忆列表无 projectId → 403', (await j('GET', '/api/memory', null, member)).status === 403);

  console.log(`
结果：PASS ${pass} / FAIL ${fail}`);
} finally {
  cleanup();
}

process.exit(fail === 0 ? 0 : 1);