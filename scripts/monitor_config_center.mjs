#!/usr/bin/env node
/**
 * 配置中心运行时巡检（供「监控 AI」/CI 使用，纯只读，不改配置）。
 *
 * 检查项：
 *  1. 服务健康（/api/health + /api/config 可达）
 *  2. 配置完整性（默认角色存在、约束可注入、钩子事件合法）
 *  3. 注入生效（chat/pipeline 预览非空，且包含默认角色与至少一条约束标题）
 *  4. 对话链路（chat/stream 真实返回 delta 与 usage）
 *  5. 对话工具（配置工具在 MCP 工具清单中可见）
 *  6. 日志无 error 级（扫描服务日志最近 N 行中的 level>=50）
 *
 * 用法：node scripts/monitor_config_center.mjs --base http://127.0.0.1:3100 --log ../.tmp-server.log
 * 结果：stdout 打印逐项结论，退出码 0=全部通过；1=有失败项。
 */
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = argOf('base', process.env.SCIFLOW_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const LOG = argOf('log', '');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function get(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}

async function chatOnce(message = '只回复两个字：正常') {
  const res = await fetch(`${BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: [] }),
    signal: AbortSignal.timeout(120_000),
  });
  const raw = await res.text();
  const deltas = [...raw.matchAll(/data: (\{.*?\})\n\n/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return {}; } });
  const text = deltas.map((d) => d.delta || '').join('');
  const usage = deltas.find((d) => d.usage)?.usage;
  return { ok: res.ok && text.length > 0, text, usage, error: deltas.find((d) => d.error)?.error };
}

const health = await get('/api/health').catch((e) => ({ status: 0, json: null, text: String(e) }));
record('服务健康 /api/health', health.status === 200 && health.json?.status === 'ok', `status=${health.status}`);

const cfg = await get('/api/config').catch((e) => ({ status: 0, json: null }));
const snap = cfg.json;
record('配置快照 /api/config', cfg.status === 200 && !!snap, `status=${cfg.status}`);
if (snap) {
  const mode = snap.permission?.mode;
  record('权限档存在且合法', ['strict', 'balanced', 'open', 'unrestricted'].includes(mode), `mode=${mode}`);
  record('核心保护项 ≥7 项', Array.isArray(snap.permission?.coreProtected) && snap.permission.coreProtected.length >= 7, `${snap.permission?.coreProtected?.length}`);
  const defaults = (snap.roles || []).filter((r) => r.isDefault === 1 && r.enabled !== 0);
  record('默认角色唯一且存在', defaults.length === 1, defaults.map((r) => r.name).join(',') || 'none');
  const enabledCons = (snap.constraints || []).filter((c) => c.enabled !== 0);
  record('启用约束 ≥1', enabledCons.length >= 1, `${enabledCons.length}`);
  const badHooks = (snap.hooks || []).filter((h) => !['chat:before', 'chat:after', 'pipeline:before', 'pipeline:after'].includes(h.event));
  record('钩子事件合法', badHooks.length === 0, badHooks.map((h) => h.event).join(',') || 'ok');
}

const chatPreview = await get('/api/config/preview?scope=chat').catch(() => ({ status: 0, json: null }));
const pv = chatPreview.json;
if (snap) {
  const roleName = (snap.roles || []).find((r) => r.isDefault === 1)?.name;
  const firstConstraint = (snap.constraints || []).find((c) => c.enabled !== 0);
  record('chat 注入预览包含默认角色', !!roleName && pv?.role?.name === roleName, `${pv?.role?.name}`);
  record('chat 注入预览包含约束标题', !!firstConstraint && String(pv?.text || '').includes(firstConstraint.title), firstConstraint?.title || 'none');
}

const pipePreview = await get('/api/config/preview?scope=pipeline').catch(() => ({ status: 0, json: null }));
record('pipeline 注入预览可取', pipePreview.status === 200 && typeof pipePreview.json?.text === 'string', `len=${pipePreview.json?.text?.length ?? 0}`);

const tools = await get('/api/mcp/tools').catch(() => ({ status: 0, json: null }));
const toolNames = (tools.json?.tools || []).map((t) => t.name);
record('配置工具已暴露给对话', ['config.snapshot', 'config.upsert_role', 'config.upsert_constraint', 'config.upsert_hook', 'config.preview'].every((n) => toolNames.includes(n)), `${toolNames.length} tools`);

const chat = await chatOnce().catch((e) => ({ ok: false, error: String(e) }));
record('对话真实返回', chat.ok, `tokens=${chat.usage?.total_tokens ?? 0}${chat.error ? ` error=${chat.error}` : ''}`);
record('对话 usage 非零', (chat.usage?.total_tokens ?? 0) > 0, `${chat.usage?.prompt_tokens}/${chat.usage?.completion_tokens}`);

if (LOG && existsSync(LOG)) {
  const lines = readFileSync(LOG, 'utf-8').split('\n').slice(-4000);
  const errors = lines.filter((l) => {
    try {
      const d = JSON.parse(l);
      return Number(d.level) >= 50;
    } catch { return false; }
  });
  record('服务日志无 error 级', errors.length === 0, errors.length ? `${errors.length} 条，最后一条：${errors.at(-1).slice(0, 160)}` : '0');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n巡检结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? `（${f.detail}）` : ''}`));
  process.exitCode = 1;
}
