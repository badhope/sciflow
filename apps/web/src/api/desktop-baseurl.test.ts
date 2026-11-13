// @vitest-environment node
/**
 * 桌面端（Electron）API 地址回归。
 *
 * 背景：桌面端页面从 `file://` 加载，preload 经 contextBridge 注入
 * `window.sciflowDesktop.apiBase = http://127.0.0.1:<port>`；`core.ts` 的 `u()`
 * 就是为此存在的——所有出站请求都必须经它拼成绝对地址。
 *
 * 缺陷：`extensions.upload`、`config.metricsText`、`ConnectionBanner` 的探活
 * 三处写的是裸 `fetch('/api/...')`，绕过 `u()`。在浏览器里相对路径能用（所以一直没暴露），
 * 但在桌面端会解析成 `file:///api/...` → 请求必然失败：
 *   - ConnectionBanner 探活永远失败 → 「服务不可达」提示条**永久误报且无法消除**
 *     （而 v1.15.1 起 Windows 安装包已是官网首推的下载方式，桌面用户是主要受众）；
 *   - 扩展中心「上传」按钮点了没反应；
 *   - 设置页运维指标面板空白。
 * 三处同时都缺 Authorization 头 → 企业 JWT 模式下即使地址对了也会 401。
 *
 * node 环境：happy-dom 自带 fetch 会绕过 msw 的 undici 拦截，故本文件用 node env +
 * 最小 window 垫片（与 client.msw.test.ts 同一套做法）。
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const API = 'http://msw.test';

// API_BASE 在模块求值时读取 window.sciflowDesktop；必须在动态 import 之前注入
(globalThis as unknown as { window: Record<string, unknown> }).window = {
  sciflowDesktop: { apiBase: API },
};

// node 环境没有 localStorage，而 getToken/setToken 内部 try-catch 后静默降级成 null
// ——不垫一层就永远测不到 Authorization 是否真的带上（生产代码本身是对的）。
const tokenStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (tokenStore.has(k) ? tokenStore.get(k)! : null),
  setItem: (k: string, v: string) => void tokenStore.set(k, String(v)),
  removeItem: (k: string) => void tokenStore.delete(k),
  clear: () => tokenStore.clear(),
  key: (i: number) => [...tokenStore.keys()][i] ?? null,
  get length() {
    return tokenStore.size;
  },
} as Storage;

/** 记录每个请求实际打到的 URL 与头部，用于断言「走的是绝对地址 + 带上了令牌」 */
const seen: { url: string; contentType: string | null; auth: string | null }[] = [];

const server = setupServer(
  http.post(`${API}/api/extensions/upload`, async ({ request }) => {
    seen.push({ url: request.url, contentType: request.headers.get('content-type'), auth: request.headers.get('authorization') });
    return HttpResponse.json({ ok: true, assets: [] });
  }),
  http.get(`${API}/api/metrics`, ({ request }) => {
    seen.push({ url: request.url, contentType: null, auth: request.headers.get('authorization') });
    return new HttpResponse('sciflow_up 1\n', { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
  }),
  http.get(`${API}/api/health`, ({ request }) => {
    seen.push({ url: request.url, contentType: null, auth: request.headers.get('authorization') });
    return HttpResponse.json({ status: 'ok' });
  }),
  http.post(`${API}/api/echo-headers`, ({ request }) => {
    seen.push({ url: request.url, contentType: request.headers.get('content-type'), auth: request.headers.get('authorization') });
    return HttpResponse.json({ ok: true });
  }),
);

beforeAll(() => server.listen());
afterEach(() => {
  seen.length = 0;
  server.resetHandlers();
});
afterAll(() => server.close());

describe('桌面端 apiBase：出站请求必须是绝对地址', () => {
  it('extensions.upload 打到注入的 apiBase（而不是 file:///api/...）', async () => {
    const { api } = await import('./client');
    const file = new File(['kind: skill\n'], 'demo.yaml', { type: 'text/yaml' });
    await api.extensions.upload(file);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(`${API}/api/extensions/upload`);
  });

  it('config.metricsText 打到注入的 apiBase', async () => {
    const { api } = await import('./client');
    const text = await api.config.metricsText();
    expect(seen.map((s) => s.url)).toContain(`${API}/api/metrics`);
    expect(text).toContain('sciflow_up 1');
  });

  it('健康探活打到注入的 apiBase，服务正常时返回 true', async () => {
    const { probeServerHealth } = await import('./core');
    await expect(probeServerHealth()).resolves.toBe(true);
    expect(seen.map((s) => s.url)).toContain(`${API}/api/health`);
  });

  it('健康探活：服务 5xx 时是 false，探活自身抛错时也是 false（不冒泡）', async () => {
    const { probeServerHealth } = await import('./core');
    server.use(http.get(`${API}/api/health`, () => new HttpResponse('down', { status: 503 })));
    await expect(probeServerHealth()).resolves.toBe(false);
    server.use(http.get(`${API}/api/health`, () => HttpResponse.error()));
    await expect(probeServerHealth()).resolves.toBe(false);
  });
});

describe('桌面端 apiBase：令牌与 Content-Type', () => {
  it('upload 携带 Authorization（企业 JWT 模式不再 401）', async () => {
    const { api, setToken } = await import('./client');
    setToken('tk-upload');
    try {
      await api.extensions.upload(new File(['x'], 'a.yaml', { type: 'text/yaml' }));
      expect(seen[0].auth).toBe('Bearer tk-upload');
    } finally {
      setToken(null);
    }
  });

  it('metricsText 与探活同样携带 Authorization', async () => {
    const { api, setToken } = await import('./client');
    const { probeServerHealth } = await import('./core');
    setToken('tk-metrics');
    try {
      await api.config.metricsText();
      await probeServerHealth();
      expect(seen.every((s) => s.auth === 'Bearer tk-metrics')).toBe(true);
    } finally {
      setToken(null);
    }
  });

  it('FormData 上传不得强塞 application/json（否则 multipart 边界丢失、后端取不到 file 字段）', async () => {
    const { api } = await import('./client');
    await api.extensions.upload(new File(['kind: skill\n'], 'b.yaml', { type: 'text/yaml' }));
    expect(seen[0].contentType).toMatch(/^multipart\/form-data/i);
  });

  it('metricsText 遇到非 2xx 必须报错，而不是把错误响应体当成指标文本渲染', async () => {
    const { api } = await import('./client');
    server.use(http.get(`${API}/api/metrics`, () => new HttpResponse('service unavailable', { status: 503 })));
    await expect(api.config.metricsText()).rejects.toThrow(/服务暂时不可用|请求失败/);
  });
});

/**
 * request() 的头部合并缺陷。
 *
 * `fetchOnce` 里对象字面量的展开顺序是 `{ headers: {...合并后...}, ...opts, signal }`
 * —— `...opts` 在 `headers` **之后**，因此只要调用方传了 `opts.headers`，
 * 整个合并结果（含 `Content-Type: application/json` 与 `Authorization: Bearer`）
 * 就会被调用方的 headers **整体覆盖**，而不是逐项合并。
 * 目前尚无调用方传 headers，所以还没爆；但这是修好上传/指标的前提，
 * 也是下一个加自定义头的人必然会踩的坑（表现为「加了个头就 401」）。
 */
describe('request()：调用方 headers 必须与默认头合并而非整体覆盖', () => {
  it('保留 Content-Type 与 Authorization，同时带上调用方自定义头', async () => {
    const { request, setToken } = await import('./core');
    setToken('tk-merge');
    try {
      await request('/api/echo-headers', { method: 'POST', headers: { 'X-Sciflow-Trace': 'abc' }, body: JSON.stringify({ a: 1 }) });
      expect(seen[0].auth).toBe('Bearer tk-merge');
      expect(seen[0].contentType).toBe('application/json');
    } finally {
      setToken(null);
    }
  });

  it('调用方可以显式覆盖默认 Content-Type（FormData 场景依赖这一点）', async () => {
    const { request } = await import('./core');
    await request('/api/echo-headers', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'raw' });
    expect(seen[0].contentType).toBe('text/plain');
  });
});
