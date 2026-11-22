import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemoteAccessService } from './remote-access.service';

describe('RemoteAccessService', () => {
  let upstream: http.Server;
  let upstreamPort = 0;
  let service: RemoteAccessService | undefined;
  const envKeys = [
    'PORT',
    'SCIFLOW_REMOTE_HOST',
    'SCIFLOW_REMOTE_PORT',
    'SCIFLOW_REMOTE_LINK_TTL_MS',
    'SCIFLOW_REMOTE_SESSION_TTL_MS',
    'SCIFLOW_REMOTE_PUBLIC_URL',
  ] as const;
  let previousEnv: Partial<Record<(typeof envKeys)[number], string>> = {};

  beforeEach(async () => {
    previousEnv = {};
    for (const key of envKeys) previousEnv[key] = process.env[key];
    upstream = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true, path: req.url, gateway: req.headers['x-sciflow-remote-gateway'] || null }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('fake upstream listen failed');
    upstreamPort = address.port;
    process.env.PORT = String(upstreamPort);
    process.env.SCIFLOW_REMOTE_HOST = '127.0.0.1';
    process.env.SCIFLOW_REMOTE_PORT = '0';
    process.env.SCIFLOW_REMOTE_LINK_TTL_MS = '60000';
    process.env.SCIFLOW_REMOTE_SESSION_TTL_MS = '300000';
    delete process.env.SCIFLOW_REMOTE_PUBLIC_URL;
  });

  afterEach(async () => {
    await service?.stop();
    service = undefined;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  it('生成一次性二维码链接，兑换后只放行带 Cookie 的 API 请求', async () => {
    service = new RemoteAccessService();
    const started = await service.start();
    expect(started.active).toBe(true);
    expect(started.state).toBe('waiting');
    expect(started.link).toContain('/remote?token=');
    expect(started.qrSvg).toContain('<svg');
    expect(started.gatewayPort).toBeGreaterThan(0);

    const token = new URL(started.link || '').searchParams.get('token') || '';
    const gateway = `http://127.0.0.1:${started.gatewayPort}`;

    const page = await fetch(`${gateway}/remote?token=${encodeURIComponent(token)}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('连接 SciFlow');

    const redeem = await fetch(`${gateway}/api/remote/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120' },
      body: JSON.stringify({ token }),
    });
    expect(redeem.status).toBe(200);
    const cookie = redeem.headers.get('set-cookie') || '';
    expect(cookie).toContain('sciflow_remote=');
    expect(cookie).toContain('HttpOnly');

    const unauthorized = await fetch(`${gateway}/api/health`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${gateway}/api/health`, { headers: { cookie: cookie.split(';')[0] } });
    expect(authorized.status).toBe(200);
    const body = (await authorized.json()) as { ok: boolean; path: string; gateway: string };
    expect(body.path).toBe('/api/health');
    expect(body.gateway).toBe('1');

    const status = service.status();
    expect(status.state).toBe('paired');
    expect(status.deviceLabel).toContain('Android');
    expect(status.connected).toBe(true);

    const secondTry = await fetch(`${gateway}/api/remote/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(secondTry.status).toBe(410);
    expect((await secondTry.json()).reason).toBe('token-used');
  });

  it('刷新后旧 Cookie 立即失效，停止后网关不再监听', async () => {
    service = new RemoteAccessService();
    const started = await service.start();
    const gateway = `http://127.0.0.1:${started.gatewayPort}`;
    const token = new URL(started.link || '').searchParams.get('token') || '';
    const redeem = await fetch(`${gateway}/api/remote/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const cookie = (redeem.headers.get('set-cookie') || '').split(';')[0];
    expect(await fetch(`${gateway}/api/health`, { headers: { cookie } })).toHaveProperty('status', 200);

    const refreshed = await service.refresh();
    expect(refreshed.state).toBe('waiting');
    expect(refreshed.link).not.toBe(started.link);
    expect(await fetch(`${gateway}/api/health`, { headers: { cookie } })).toHaveProperty('status', 401);

    const stopped = await service.stop();
    expect(stopped.active).toBe(false);
    await expect(fetch(`${gateway}/healthz`)).rejects.toThrow();
  });

  it('配置公网根地址后二维码优先使用公网入口，并下 Secure Cookie', async () => {
    process.env.SCIFLOW_REMOTE_PUBLIC_URL = 'https://sciflow.example.com/';
    service = new RemoteAccessService();
    const started = await service.start();
    expect(started.publicUrlConfigured).toBe(true);
    expect(started.link).toMatch(/^https:\/\/sciflow\.example\.com\/remote\?token=/);
    const token = new URL(started.link || '').searchParams.get('token') || '';
    const gateway = `http://127.0.0.1:${started.gatewayPort}`;
    const redeem = await fetch(`${gateway}/api/remote/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ token }),
    });
    expect(redeem.status).toBe(200);
    expect(redeem.headers.get('set-cookie') || '').toContain('Secure');
  });

  it('手机不能通过网关调用控制面', async () => {
    service = new RemoteAccessService();
    const started = await service.start();
    const gateway = `http://127.0.0.1:${started.gatewayPort}`;
    const token = new URL(started.link || '').searchParams.get('token') || '';
    const redeem = await fetch(`${gateway}/api/remote/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const cookie = (redeem.headers.get('set-cookie') || '').split(';')[0];
    const control = await fetch(`${gateway}/api/remote/stop`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(control.status).toBe(403);
    expect((await control.json()).message).toContain('不能操作远控网关');
    expect(service.status().active).toBe(true);
  });
});
