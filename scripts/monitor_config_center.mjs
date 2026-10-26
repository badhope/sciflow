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
import { readFileSync, existsSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`用法：node scripts/monitor_config_center.mjs [--base <url>] [--log <path>]

只读巡检配置中心（不改配置、不写库），退出码 0=全部通过 / 1=有失败项。
  --base  后端地址，默认 $SCIFLOW_BASE 或 http://127.0.0.1:3000
  --log   服务日志路径（可选，扫描最近 4000 行 level>=50）
检查项：服务健康、配置快照、权限档、核心保护项、默认角色、约束/钩子合法性、钩子唯一、
      注入预览（chat/pipeline 全覆盖）、MCP 工具暴露、审计拒绝原因、对话真实返回与 usage、日志无 error。`);
  process.exit(0);
}
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
  const badTypes = (snap.hooks || []).filter((h) => !['prompt_inject', 'block', 'webhook'].includes(h.type));
  record('钩子类型合法', badTypes.length === 0, badTypes.map((h) => `${h.name}:${h.type}`).join(',') || 'ok');
  // 重复钩子 = 每次对话重复注入同一文本（监控 AI 发现的假绿项）
  const hookKeys = new Map();
  for (const h of snap.hooks || []) {
    const k = `${h.name}|${h.event}|${h.type}`;
    hookKeys.set(k, (hookKeys.get(k) || 0) + 1);
  }
  const dupHooks = [...hookKeys.entries()].filter(([, n]) => n > 1);
  record('钩子无重复（name+event+type）', dupHooks.length === 0, dupHooks.map(([k, n]) => `${k}×${n}`).join('; ') || 'ok');
  const rawDefault = (snap.roles || []).filter((r) => r.isDefault === 1);
  record('默认角色原始计数为 1', rawDefault.length === 1, `${rawDefault.length}`);
}

// 审计不可变 + 拒绝原因非空（监控 AI 补强）
const audit = await get('/api/config/audit?limit=100').catch(() => ({ status: 0, json: null }));
const denied = Array.isArray(audit.json) ? audit.json.filter((a) => a.allowed === 0) : [];
record('审计接口可达', audit.status === 200 && Array.isArray(audit.json), `status=${audit.status}`);
record('审计拒绝记录带原因', audit.status === 200 && denied.every((a) => String(a.reason || '').trim().length > 0), `${denied.length} denied`);

const chatPreview = await get('/api/config/preview?scope=chat').catch(() => ({ status: 0, json: null }));
const pv = chatPreview.json;
if (snap) {
  const roleName = (snap.roles || []).find((r) => r.isDefault === 1)?.name;
  record('chat 注入预览包含默认角色', !!roleName && pv?.role?.name === roleName, `${pv?.role?.name}`);
  // 全部 chat 适用约束都应出现在预览（不只第一条）
  const chatScope = (snap.constraints || []).filter((c) => c.enabled !== 0 && (c.scope === 'all' || c.scope === 'chat'));
  const missing = chatScope.filter((c) => !String(pv?.text || '').includes(c.title));
  record('chat 注入预览覆盖全部适用约束', missing.length === 0, missing.length ? missing.map((c) => c.title).join(',') : `${chatScope.length} 条`);
}

const pipePreview = await get('/api/config/preview?scope=pipeline').catch(() => ({ status: 0, json: null }));
record('pipeline 注入预览可取', pipePreview.status === 200 && typeof pipePreview.json?.text === 'string', `len=${pipePreview.json?.text?.length ?? 0}`);
if (snap) {
  const pipeScope = (snap.constraints || []).filter((c) => c.enabled !== 0 && (c.scope === 'all' || c.scope === 'pipeline'));
  const missingPipe = pipeScope.filter((c) => !String(pipePreview.json?.text || '').includes(c.title));
  record('pipeline 注入预览覆盖全部适用约束', missingPipe.length === 0, missingPipe.length ? missingPipe.map((c) => c.title).join(',') : `${pipeScope.length} 条`);
}

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
