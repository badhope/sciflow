import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import qrcode from 'qrcode-generator';
import type { RemoteAccessAddressDto, RemoteAccessStatusDto } from './remote.dto';

/**
 * 桌面端远程控制网关。
 *
 * 设计约束（对齐 ZCode 的「窗口远控」而不是「另开一台机器」）：
 *  - 真正的业务进程仍只监听 127.0.0.1；本网关是唯一对外端口，只做鉴权 + 反向代理。
 *  - 扫码链接里的 token 是一次性配对凭据；兑换成功后换成 HttpOnly 会话 Cookie。
 *  - 同一时间只允许一台手机；刷新二维码立即吊销旧链接和旧 Cookie。
 *  - 手机打开的是完整 SciFlow Web 工作台，因此项目、对话、流水线、设置全部可操作。
 */
@Injectable()
export class RemoteAccessService implements OnModuleDestroy {
  private readonly logger = new Logger(RemoteAccessService.name);
  private server: Server | null = null;
  private gatewayPort = 0;
  private streamingResponses = new Set<ServerResponse>();
  private session: {
    tokenHash: Buffer;
    tokenUsed: boolean;
    startedAt: number;
    tokenExpiresAt: number;
    accessHash?: Buffer;
    pairedAt?: number;
    sessionExpiresAt?: number;
    lastSeenAt?: number;
    deviceLabel?: string;
  } | null = null;
  private qrSvg: string | undefined;

  private readonly upstreamPort = Number(process.env.PORT) || 3000;
  private readonly linkTtlMs = Math.max(
    60_000,
    Number(process.env.SCIFLOW_REMOTE_LINK_TTL_MS) || 10 * 60_000,
  );
  private readonly sessionTtlMs = Math.max(
    5 * 60_000,
    Number(process.env.SCIFLOW_REMOTE_SESSION_TTL_MS) || 8 * 60 * 60_000,
  );

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<RemoteAccessStatusDto> {
    if (this.server && this.session) {
      if (!this.session.tokenUsed && Date.now() >= this.session.tokenExpiresAt) {
        return this.refresh();
      }
      return this.status();
    }

    const now = Date.now();
    const token = randomBytes(24).toString('base64url');
    this.session = {
      tokenHash: hashToken(token),
      tokenUsed: false,
      startedAt: now,
      tokenExpiresAt: now + this.linkTtlMs,
    };

    const host = process.env.SCIFLOW_REMOTE_HOST || '0.0.0.0';
    const port = Number(process.env.SCIFLOW_REMOTE_PORT) || 0;
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    // 手机端对话/流水线可能长时间挂着 SSE，不能被 Node 默认 5 分钟请求超时截断。
    server.requestTimeout = 0;
    server.timeout = 0;
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening);
        this.server = null;
        this.session = null;
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      await this.stop();
      throw new Error('远程控制网关监听失败：无法获取端口');
    }
    this.gatewayPort = address.port;
    await this.rebuildQr(token);
    this.logger.log(`远程控制网关已启动：${host}:${this.gatewayPort} -> 127.0.0.1:${this.upstreamPort}`);
    return this.status();
  }

  async refresh(): Promise<RemoteAccessStatusDto> {
    if (!this.server) return this.start();
    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    this.session = {
      tokenHash: hashToken(token),
      tokenUsed: false,
      startedAt: now,
      tokenExpiresAt: now + this.linkTtlMs,
    };
    // 刷新意味着让旧手机彻底掉线：换掉 Cookie，并切断已经挂着的 SSE 长连接。
    // 只切流式响应，不动 keep-alive 空闲连接；否则桌面端/手机的下一次普通请求会先吃一次 ECONNRESET。
    for (const response of this.streamingResponses) response.destroy();
    this.streamingResponses.clear();
    await this.rebuildQr(token);
    return this.status();
  }

  async stop(): Promise<RemoteAccessStatusDto> {
    const server = this.server;
    this.server = null;
    this.session = null;
    this.qrSvg = undefined;
    this.currentToken = undefined;
    this.gatewayPort = 0;
    for (const response of this.streamingResponses) response.destroy();
    this.streamingResponses.clear();
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
    return this.status();
  }

  status(): RemoteAccessStatusDto {
    const addresses = this.gatewayPort ? buildAddresses(this.gatewayPort) : [];
    const base: RemoteAccessStatusDto = {
      active: Boolean(this.server && this.session),
      state: 'stopped',
      addresses,
      publicUrlConfigured: Boolean(normalizePublicBase(process.env.SCIFLOW_REMOTE_PUBLIC_URL)),
      connected: false,
      gatewayPort: this.gatewayPort || undefined,
      hint:
        this.server && addresses.length === 0
          ? '未检测到可用的局域网地址'
          : undefined,
    };
    const session = this.session;
    if (!this.server || !session) return base;

    base.startedAt = new Date(session.startedAt).toISOString();
    const now = Date.now();
    if (session.pairedAt && session.sessionExpiresAt && now < session.sessionExpiresAt) {
      base.state = 'paired';
      base.pairedAt = new Date(session.pairedAt).toISOString();
      base.lastSeenAt = session.lastSeenAt
        ? new Date(session.lastSeenAt).toISOString()
        : undefined;
      base.expiresAt = new Date(session.sessionExpiresAt).toISOString();
      base.deviceLabel = session.deviceLabel;
      base.connected = Boolean(session.lastSeenAt && now - session.lastSeenAt < 90_000);
      return base;
    }

    if (session.tokenUsed || now >= session.tokenExpiresAt) {
      base.state = 'expired';
      base.expiresAt = new Date(session.sessionExpiresAt || session.tokenExpiresAt).toISOString();
      base.pairedAt = session.pairedAt ? new Date(session.pairedAt).toISOString() : undefined;
      base.deviceLabel = session.deviceLabel;
      return base;
    }

    const primary = addresses.find((address) => address.kind !== 'localhost');
    if (!primary) {
      base.state = 'waiting';
      base.expiresAt = new Date(session.tokenExpiresAt).toISOString();
      base.hint =
        '没有可用的局域网/公网地址，手机无法访问。请设置 SCIFLOW_REMOTE_PUBLIC_URL 或检查网络。';
      return base;
    }
    const token = this.currentToken;
    base.state = 'waiting';
    base.addresses = addresses.map((address) => {
      const withToken = token
        ? { ...address, link: joinPath(address.url, `/remote?token=${encodeURIComponent(token)}`) }
        : address;
      return withToken;
    });
    base.link = token ? joinPath(primary.url, `/remote?token=${encodeURIComponent(token)}`) : undefined;
    base.qrSvg = this.qrSvg;
    base.expiresAt = new Date(session.tokenExpiresAt).toISOString();
    return base;
  }

  /** 启动时生成的一次性 token；仅内存保存，用于拼二维码链接。 */
  private currentToken: string | undefined;

  private async rebuildQr(token: string): Promise<void> {
    this.currentToken = token;
    const addresses = this.gatewayPort ? buildAddresses(this.gatewayPort) : [];
    const primary = addresses.find((address) => address.kind !== 'localhost');
    if (!primary) {
      this.qrSvg = undefined;
      return;
    }
    const link = joinPath(primary.url, `/remote?token=${encodeURIComponent(token)}`);
    try {
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      this.qrSvg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (error) {
      this.qrSvg = undefined;
      this.logger.warn(`二维码生成失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', 'http://remote.invalid');
    const pathname = url.pathname;

    if (pathname === '/healthz') {
      return json(res, 200, { ok: true });
    }

    if (pathname === '/remote') {
      if (this.isAuthorized(req)) return redirect(res, '/');
      const token = url.searchParams.get('token') || '';
      return this.servePairingPage(res, token);
    }

    if (pathname === '/api/remote/session') {
      if (req.method === 'POST') return void this.handleRedeem(req, res);
      if (req.method === 'GET') {
        return json(res, 200, { ok: true, authorized: this.isAuthorized(req) });
      }
      return json(res, 405, { ok: false, message: 'Method Not Allowed' });
    }

    // 控制面只允许桌面端直连回环地址。网关本身绝不把 start/stop/refresh 暴露给手机。
    if (pathname.startsWith('/api/remote/')) {
      return json(res, 403, { ok: false, message: '远程端不能操作远控网关本身' });
    }

    if (pathname.startsWith('/api/')) {
      if (!this.isAuthorized(req)) {
        return json(res, 401, { ok: false, message: '远程会话无效或已过期，请回桌面端重新扫码' });
      }
      return this.proxy(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { ok: false, message: 'Method Not Allowed' });
    }

    // 静态资源放行；页面入口要求会话，避免未配对的人看到工作台外壳。
    if (this.isDocumentRequest(pathname) && !this.isAuthorized(req)) {
      return redirect(res, '/remote');
    }
    return this.proxy(req, res);
  }

  private isDocumentRequest(pathname: string): boolean {
    if (pathname === '/' || pathname === '/index.html') return true;
    const last = pathname.split('/').pop() || '';
    return !last.includes('.');
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const session = this.session;
    if (!session?.accessHash || !session.sessionExpiresAt) return false;
    if (Date.now() >= session.sessionExpiresAt) return false;
    const cookie = readCookie(req.headers.cookie, REMOTE_COOKIE);
    if (!cookie) return false;
    const hash = hashToken(cookie);
    if (hash.length !== session.accessHash.length) return false;
    if (!timingSafeEqual(hash, session.accessHash)) return false;
    session.lastSeenAt = Date.now();
    return true;
  }

  private async handleRedeem(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body = '';
    try {
      body = await readBody(req, 8 * 1024);
    } catch (error) {
      const code = error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400;
      return json(res, code, { ok: false, message: '请求体不合法' });
    }
    let token = '';
    try {
      const parsed = JSON.parse(body || '{}') as { token?: unknown };
      token = typeof parsed.token === 'string' ? parsed.token : '';
    } catch {
      return json(res, 400, { ok: false, message: '请求体不是合法 JSON' });
    }
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) {
      return json(res, 401, { ok: false, reason: 'invalid-token', message: '配对链接无效' });
    }

    const session = this.session;
    if (!session) {
      return json(res, 401, { ok: false, reason: 'invalid-token', message: '远程控制未启动' });
    }
    if (session.tokenUsed) {
      return json(res, 410, {
        ok: false,
        reason: 'token-used',
        message: '这个二维码已经被使用过。请在桌面端刷新二维码，或点「停止」后重新开启。',
      });
    }
    if (Date.now() >= session.tokenExpiresAt) {
      return json(res, 410, {
        ok: false,
        reason: 'expired',
        message: '二维码已过期。请在桌面端刷新二维码后重新扫码。',
      });
    }
    if (session.pairedAt && session.sessionExpiresAt && Date.now() < session.sessionExpiresAt) {
      return json(res, 409, {
        ok: false,
        reason: 'already-paired',
        message: '已有一台手机连接。远程控制同一时间只允许一个页面，请先在桌面端停止或刷新。',
      });
    }

    const incoming = hashToken(token);
    if (
      incoming.length !== session.tokenHash.length ||
      !timingSafeEqual(incoming, session.tokenHash)
    ) {
      return json(res, 401, { ok: false, reason: 'invalid-token', message: '配对链接无效' });
    }

    const accessToken = randomBytes(24).toString('base64url');
    const now = Date.now();
    session.tokenUsed = true;
    session.accessHash = hashToken(accessToken);
    session.pairedAt = now;
    session.sessionExpiresAt = now + this.sessionTtlMs;
    session.lastSeenAt = now;
    session.deviceLabel = describeClient(req.headers['user-agent']);
    this.currentToken = undefined;
    this.qrSvg = undefined;

    const secure =
      isHttpsPublicBase(process.env.SCIFLOW_REMOTE_PUBLIC_URL) ||
      String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    const maxAge = Math.max(0, Math.floor(this.sessionTtlMs / 1000));
    res.setHeader('Set-Cookie', [
      `${REMOTE_COOKIE}=${encodeURIComponent(accessToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
      // 非 HttpOnly 的只读标记：手机端完整工作台据此隐藏「远程控制」入口，
      // 避免手机再对自己发起 start/stop（服务端本来也会 403）。
      `${REMOTE_COOKIE}_mode=1; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`,
    ]);
    this.logger.log(`手机已完成远程配对：${session.deviceLabel}`);
    return json(res, 200, { ok: true });
  }

  private proxy(req: IncomingMessage, res: ServerResponse): void {
    const headers = { ...req.headers };
    delete headers.host;
    headers.host = `127.0.0.1:${this.upstreamPort}`;
    headers['x-sciflow-remote-gateway'] = '1';
    headers['x-forwarded-host'] = req.headers.host || '';
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
    headers['x-forwarded-for'] =
      [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ') ||
      'unknown';

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: this.upstreamPort,
        method: req.method,
        path: req.url,
        headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        if (String(upstreamRes.headers['content-type'] || '').includes('text/event-stream')) {
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders?.();
          this.streamingResponses.add(res);
        }
        // 手机断网/锁屏/刷新时，别让后端还在为已断开的 SSE 继续生成内容。
        res.once('close', () => {
          this.streamingResponses.delete(res);
          upstreamRes.destroy();
        });
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      this.logger.warn(`远程网关转发失败：${error.message}`);
      if (!res.headersSent) {
        json(res, 502, { ok: false, message: '桌面端服务暂时不可用，请确认 SciFlow 仍在运行' });
      } else {
        res.destroy();
      }
    });
    req.once('error', () => upstream.destroy());
    req.once('aborted', () => upstream.destroy());
    req.pipe(upstream);
  }

  private servePairingPage(res: ServerResponse, token: string): void {
    const valid = /^[A-Za-z0-9_-]{20,80}$/.test(token);
    const payload = valid ? JSON.stringify(token) : 'null';
    const html = pairingPage(payload);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    });
    res.end(html);
  }
}

const REMOTE_COOKIE = 'sciflow_remote';

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function normalizePublicBase(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    // 只取 origin：二维码固定拼 /remote；反代请把根路径转发到网关，不要在 PUBLIC_URL 里带子路径。
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

function isHttpsPublicBase(value: string | undefined): boolean {
  const normalized = normalizePublicBase(value);
  return Boolean(normalized && normalized.startsWith('https://'));
}

function joinPath(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildAddresses(port: number): RemoteAccessAddressDto[] {
  const addresses: RemoteAccessAddressDto[] = [];
  const publicBase = normalizePublicBase(process.env.SCIFLOW_REMOTE_PUBLIC_URL);
  if (publicBase) {
    addresses.push({
      kind: 'public',
      label: `公网 · ${new URL(publicBase).host}`,
      url: publicBase,
    });
  }
  for (const entry of lanInterfaces()) {
    addresses.push({
      kind: 'lan',
      label: `局域网 · ${entry.address}`,
      url: `http://${entry.address}:${port}`,
    });
  }
  if (addresses.length === 0) {
    addresses.push({
      kind: 'localhost',
      label: '本机',
      url: `http://127.0.0.1:${port}`,
    });
  }
  return addresses;
}

function lanInterfaces(): Array<{ name: string; address: string }> {
  const result: Array<{ name: string; address: string; score: number }> = [];
  for (const [name, values] of Object.entries(os.networkInterfaces())) {
    for (const value of values || []) {
      if (value.family !== 'IPv4' || value.internal) continue;
      if (value.address.startsWith('169.254.')) continue;
      const virtual = /^(docker|br-|veth|virbr|vmnet|utun|tun|tap|lo)/i.test(name);
      const preferred = /(wi-?fi|wlan|en0|ethernet|eth0)/i.test(name) ? 0 : virtual ? 20 : 5;
      const privateScore = value.address.startsWith('192.168.')
        ? 0
        : value.address.startsWith('10.')
          ? 2
          : /^172\.(1[6-9]|2\d|3[01])\./.test(value.address)
            ? 4
            : 8;
      result.push({ name, address: value.address, score: preferred + privateScore });
    }
  }
  result.sort((a, b) => a.score - b.score || a.address.localeCompare(b.address));
  const seen = new Set<string>();
  return result
    .filter((entry) => {
      if (seen.has(entry.address)) return false;
      seen.add(entry.address);
      return true;
    })
    .map(({ name, address }) => ({ name, address }));
}

function describeClient(userAgent: string | undefined): string {
  const ua = userAgent || '';
  const platform = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Macintosh/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : '未知设备';
  const browser = /MicroMessenger/i.test(ua)
    ? '微信'
    : /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome|CriOS/i.test(ua)
        ? 'Chrome'
        : /Safari/i.test(ua)
          ? 'Safari'
          : /Firefox|FxiOS/i.test(ua)
            ? 'Firefox'
            : '浏览器';
  return `${platform} · ${browser}`;
}

function pairingPage(tokenJson: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex,nofollow" />
<title>连接 SciFlow</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 28px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; background: radial-gradient(circle at 20% 0%, #ecfeff 0, #f8fafc 45%, #eef2ff 100%); color: #0f172a; }
  main { width: min(100%, 380px); background: rgba(255, 255, 255, .86); border: 1px solid rgba(15, 23, 42, .08); border-radius: 24px; padding: 28px 24px; box-shadow: 0 24px 60px -28px rgba(15, 23, 42, .28); backdrop-filter: blur(18px); }
  .mark { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; background: linear-gradient(135deg, #0f766e, #14b8a6); color: #fff; font-weight: 700; font-size: 20px; letter-spacing: -.06em; box-shadow: 0 10px 24px -12px rgba(15, 118, 110, .7); }
  h1 { margin: 18px 0 6px; font-size: 22px; letter-spacing: -.02em; }
  p { margin: 0; color: #64748b; font-size: 14px; line-height: 1.65; }
  .state { margin-top: 22px; padding: 14px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 13px; color: #475569; display: flex; gap: 10px; align-items: center; }
  .dot { width: 9px; height: 9px; border-radius: 999px; background: #14b8a6; box-shadow: 0 0 0 6px rgba(20, 184, 166, .12); animation: pulse 1.5s ease-in-out infinite; flex: none; }
  .err { display: none; margin-top: 18px; padding: 14px; border-radius: 14px; background: #fff1f2; border: 1px solid #fecdd3; color: #be123c; font-size: 13px; line-height: 1.65; }
  .err.show { display: block; }
  .foot { margin-top: 20px; font-size: 12px; color: #94a3b8; line-height: 1.6; }
  @keyframes pulse { 0%, 100% { opacity: .45; transform: scale(.86); } 50% { opacity: 1; transform: scale(1); } }
</style>
</head>
<body>
<main>
  <div class="mark">S</div>
  <h1>连接 SciFlow</h1>
  <p>正在验证一次性配对凭据。连接成功后，这台手机将接管桌面端已打开的完整工作台。</p>
  <div class="state"><span class="dot" aria-hidden="true"></span><span id="state">正在建立安全会话…</span></div>
  <div class="err" id="err" role="alert"></div>
  <div class="foot">所有数据仍保存在桌面端电脑上。手机只是控制界面，不会复制、同步或另建工作区。</div>
</main>
<script>
(() => {
  const token = ${tokenJson};
  const state = document.getElementById('state');
  const err = document.getElementById('err');
  const fail = (message) => {
    state.textContent = '连接失败';
    err.textContent = message || '配对链接无效，请回桌面端刷新二维码。';
    err.classList.add('show');
  };
  if (!token) return fail('缺少配对参数。请重新扫描桌面端展示的二维码。');
  fetch('/api/remote/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ token }),
  })
    .then(async (response) => {
      let body = {};
      try { body = await response.json(); } catch {}
      if (!response.ok || !body.ok) throw new Error(body.message || '配对失败');
      history.replaceState(null, '', '/');
      location.replace('/');
    })
    .catch((error) => fail(error && error.message ? error.message : '配对失败'));
})();
</script>
</body>
</html>`;
}
