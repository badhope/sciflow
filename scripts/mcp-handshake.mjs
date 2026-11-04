#!/usr/bin/env node
/**
 * MCP 握手端到端验证（scripts/mcp-handshake.mjs）
 *
 * 用官方 SDK 客户端对本仓 MCP server（POST /api/mcp/rpc，无状态 Streamable HTTP）
 * 走一遍真实协议链路：initialize 握手 → tools/list → resources/list →
 * resources/read → tools/call（只读工具）。任何一步失败即非零退出。
 *
 * 用途：核实 @modelcontextprotocol/sdk 版本与 2026-07-28 协议的适配（ECOSYSTEM-AUDIT 待核实项），
 * 也是回归套件的常驻成员——协议互通不能靠「没改过应该没事」。
 *
 * 前置：后端已启动（mock 模式即可）。默认 BASE=http://127.0.0.1:3000。
 *   BASE=http://127.0.0.1:3200 node scripts/mcp-handshake.mjs
 */

const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');

const { createRequire } = await import('node:module');
// 复用 apps/server 已安装的 @modelcontextprotocol/sdk（版本单一来源，与 server 同一份实现）
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const steps = [];
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

const client = new Client({ name: 'sciflow-handshake-probe', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/rpc`));

let allOk = true;
try {
  // 1. initialize 握手（SDK 在 connect 内完成能力协商）
  const serverInfo = await client.connect(transport);
  allOk &= step('initialize 握手', true, `server=${serverInfo?.serverInfo?.name ?? '?'} protocol=${serverInfo?.protocolVersion ?? '?'}`);

  // 2. tools/list
  const tools = await client.listTools();
  const toolCount = tools?.tools?.length ?? 0;
  allOk &= step('tools/list', toolCount > 0, `${toolCount} 个工具，如 ${(tools.tools.slice(0, 3).map((t) => t.name)).join(', ')}`);

  // 3. tools/call 一个只读工具：优先零必填参数的 config.snapshot（探针不构造业务参数）
  const zeroArg = tools.tools.find((t) => !t.inputSchema?.required?.length);
  const callName = tools.tools.find((t) => t.name === 'config.snapshot')?.name ?? zeroArg?.name ?? tools.tools[0].name;
  const call = await client.callTool({ name: callName, arguments: {} });
  const callOk = !call?.isError;
  allOk &= step(`tools/call ${callName}`, callOk, callOk ? '返回正常' : JSON.stringify(call?.content ?? {}).slice(0, 120));

  // 4. resources/list
  let resourceCount = 0;
  try {
    const resources = await client.listResources();
    resourceCount = resources?.resources?.length ?? 0;
    allOk &= step('resources/list', true, `${resourceCount} 个资源`);
  } catch (e) {
    allOk &= step('resources/list', false, e?.message);
  }

  // 5. resources/read（有资源才读第一个）
  if (resourceCount > 0) {
    const resources = await client.listResources();
    const first = resources.resources[0];
    const read = await client.readResource({ uri: first.uri });
    allOk &= step(`resources/read ${first.uri.slice(0, 40)}`, Array.isArray(read?.contents), `${read?.contents?.length ?? 0} 条内容`);
  }
} catch (e) {
  allOk = false;
  step('协议链路', false, e?.message || String(e));
} finally {
  try { await client.close(); } catch { /* 无状态端点，关闭失败不影响结论 */ }
}

console.log('='.repeat(50));
console.log(allOk ? `握手验证通过（${steps.filter((s) => s.ok).length}/${steps.length} 步）` : '握手验证失败');
process.exit(allOk ? 0 : 1);
