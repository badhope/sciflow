import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { safeOutboundFetch } from './safe-outbound';

/**
 * 连接级出站守卫回归。
 *
 * 关键点：不是校验 URL 字符串，而是校验「建立 socket 时真正解析到的地址」。
 * 这里用真实 HTTP server + 真实 fetch 证明回环连接在默认策略下被拒绝，
 * 并在显式 ALLOW_PRIVATE_OUTBOUND=1 时放行，避免「预检通过、连接照旧」的假安全。
 */

let server: Server | undefined;
let baseUrl = '';
const previous = process.env.ALLOW_PRIVATE_OUTBOUND;

async function startServer(): Promise<void> {
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/target' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
  const address = server!.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/`;
}

afterEach(async () => {
  if (previous === undefined) delete process.env.ALLOW_PRIVATE_OUTBOUND;
  else process.env.ALLOW_PRIVATE_OUTBOUND = previous;
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

describe('safeOutboundFetch 连接级防护', () => {
  it('默认拒绝真实回环 socket 连接', async () => {
    delete process.env.ALLOW_PRIVATE_OUTBOUND;
    await startServer();
    await expect(safeOutboundFetch(baseUrl)).rejects.toThrow(/SSRF|拒绝|blocked/i);
  });

  it('显式允许私网时可完成真实请求', async () => {
    process.env.ALLOW_PRIVATE_OUTBOUND = '1';
    await startServer();
    const res = await safeOutboundFetch(baseUrl);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('true');
  });

  it('域名解析到回环时在连接阶段拒绝（不是只看 URL 字符串）', async () => {
    delete process.env.ALLOW_PRIVATE_OUTBOUND;
    await startServer();
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    await expect(safeOutboundFetch(`http://localhost:${port}/`)).rejects.toThrow(/SSRF|拒绝|blocked/i);
  });

  it('即使调用方请求 follow，也返回未跟随的 3xx，避免跳转到未校验目标', async () => {
    process.env.ALLOW_PRIVATE_OUTBOUND = '1';
    await startServer();
    const res = await safeOutboundFetch(`${baseUrl}redirect`, { redirect: 'follow' });
    expect(res.status).toBe(302);
  });
});
