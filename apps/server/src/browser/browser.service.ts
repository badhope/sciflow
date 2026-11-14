import { Injectable, Logger, BadRequestException, OnModuleDestroy } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { safeOutboundFetch } from '../common/safe-outbound';
import { envInt } from '../common/env';

/**
 * 内置浏览器：让应用（和 Agent）真的能打开网页、读内容、点元素、截图。
 *
 * 为什么放在服务端而不是前端 iframe：
 *  - iframe 受同源策略限制，绝大多数站点禁止被嵌入（X-Frame-Options / CSP），
 *    看起来「有浏览器」，实际打不开任何外部页面；
 *  - 截图、点击、取文本需要与页面同进程，只有真实浏览器内核能做。
 *
 * 安全边界（与实验沙箱一致的原则）：
 *  - 出站地址先过 SSRF 守卫（禁止内网/云元数据），与 ai/safe-outbound 同一套策略；
 *  - 每会话独立 BrowserContext，默认无持久化、无扩展、无下载；
 *  - 不注入 cookies / 不使用用户真实浏览器 profile；
 *  - 会话数与会话时长有上限，闲置自动关闭，避免进程与内存泄漏。
 */

const MAX_SESSIONS = envInt('BROWSER_MAX_SESSIONS', 3, { min: 1, max: 10 });
const IDLE_TTL_MS = envInt('BROWSER_IDLE_TTL_MS', 5 * 60_000, { min: 30_000, max: 60 * 60_000 });
const NAV_TIMEOUT_MS = envInt('BROWSER_NAV_TIMEOUT_MS', 30_000, { min: 5_000, max: 120_000 });
const VIEWPORT = { width: 1280, height: 800 };

interface Session {
  id: string;
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  /** 最近一次导航或操作的简要记录，供 UI 显示历史 */
  history: { action: string; target: string; at: number; ok: boolean }[];
}

export interface BrowserSessionView {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  lastUsed: number;
  history: Session['history'];
}

@Injectable()
export class BrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserService.name);
  private browser: Browser | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly created = new Map<string, number>();
  private sweeper: NodeJS.Timeout | null = null;

  /**
   * 浏览器可执行文件的位置。
   *
   * Playwright 默认去 用户目录/ms-playwright 找；本项目把浏览器装在
   * `<工作区>/cache/ms-playwright`（隔离要求：不写用户目录）。这里按顺序探测：
   *  1. 显式 PLAYWRIGHT_BROWSERS_PATH（进程环境优先）
   *  2. 工作区缓存目录（SCIFLOW_CACHE_DIR 或 AGENT 约定路径）
   *  3. 交给 Playwright 默认逻辑
   */
  private browserPathHint(): string | undefined {
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
    const candidates = [
      process.env.SCIFLOW_BROWSERS_PATH,
      path.join(process.env.SCIFLOW_HOME || '', 'cache', 'ms-playwright'),
      path.join(path.parse(process.cwd()).root, 'sciflow-research', 'cache', 'ms-playwright'),
    ].filter((p): p is string => Boolean(p)).map((p) => path.resolve(p));
    for (const dir of candidates) {
      try {
        if (dir && fs.existsSync(dir)) return dir;
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  /** 在缓存目录里定位 chromium 可执行文件（优先 headless shell，其次完整 chrome） */
  private resolveChromiumExecutable(root?: string): string | undefined {
    if (!root) return undefined;
    try {
      const entries = fs.readdirSync(root);
      const order = ['chromium_headless_shell-', 'chromium-'];
      for (const prefix of order) {
        const dir = entries.find((e) => e.startsWith(prefix));
        if (!dir) continue;
        const base = path.join(root, dir);
        const candidates =
          process.platform === 'win32'
            ? [path.join(base, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'), path.join(base, 'chrome-win64', 'chrome.exe')]
            : process.platform === 'darwin'
              ? [path.join(base, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'), path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')]
              : [path.join(base, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), path.join(base, 'chrome-linux', 'chrome')];
        for (const c of candidates) if (fs.existsSync(c)) return c;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  /** 惰性启动浏览器（首次使用时才拉起，未使用不占内存） */
  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const hint = this.browserPathHint();
    if (hint) process.env.PLAYWRIGHT_BROWSERS_PATH = hint;
    // 显式定位可执行文件：只设 PLAYWRIGHT_BROWSERS_PATH 在某些启动方式下不生效
    // （服务进程 env 已被父进程快照，Playwright 在模块加载时读取）。
    const exe = this.resolveChromiumExecutable(hint);
    try {
      this.browser = await chromium.launch({
        headless: true,
        ...(exe ? { executablePath: exe } : {}),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/Executable doesn't exist/i.test(msg)) {
        throw new BadRequestException(
          '浏览器内核未安装：请在项目目录执行 `npx playwright install chromium`（或把 PLAYWRIGHT_BROWSERS_PATH 指向已安装的缓存目录）后重试',
        );
      }
      throw new BadRequestException(`浏览器启动失败：${msg.slice(0, 200)}`);
    }
    this.logger.log(`[browser] chromium 已启动（browsers=${process.env.PLAYWRIGHT_BROWSERS_PATH || '默认'})`);
    this.startSweeper();
    return this.browser;
  }

  /**
   * 出站守卫：与 AI 出站同一套 SSRF 策略（内网/云元数据默认拒绝）。
   *
   * 例外：本机 Web 沙箱预览（127.0.0.1 且端口在 WEB_SANDBOX_PORT_BASE..+50 段内）
   * 是本应用自己起的静态服务，必须允许——否则「开发完的页面用内置浏览器验收」这条路直接断掉。
   */
  private async assertUrlAllowed(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('不是合法 URL');
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new BadRequestException('只支持 http/https');
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    const sandboxBase = envInt('WEB_SANDBOX_PORT_BASE', 43500, { min: 1024, max: 65000 });
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    if (loopback && port >= sandboxBase && port <= sandboxBase + 50) {
      return; // 自家 Web 沙箱预览，跳过 SSRF 守卫
    }
    // 用守卫发起一次 HEAD 做地址校验（不读内容）：被拒绝时抛出可读原因
    try {
      const res = await safeOutboundFetch(parsed.toString(), { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      try { await res.body?.cancel(); } catch { /* noop */ }
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('安全策略')) throw new BadRequestException(msg);
      // 网络错误交给浏览器自己处理（有些站点拒绝 HEAD），不在这里判死
    }
  }

  private startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => void this.sweepIdle(), 60_000);
    this.sweeper.unref?.();
  }

  private async sweepIdle() {
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (now - s.lastUsed > IDLE_TTL_MS) {
        await this.close(id).catch(() => undefined);
        this.logger.log(`[browser] 会话 ${id.slice(0, 8)} 闲置超时已关闭`);
      }
    }
  }

  async list(): Promise<BrowserSessionView[]> {
    const out: BrowserSessionView[] = [];
    for (const [id, s] of this.sessions) {
      out.push({
        id,
        url: s.page.url(),
        title: await s.page.title().catch(() => ''),
        createdAt: this.created.get(id) ?? s.lastUsed,
        lastUsed: s.lastUsed,
        history: s.history.slice(-10),
      });
    }
    return out;
  }

  /** 新建会话并打开页面 */
  async open(url: string): Promise<BrowserSessionView> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new BadRequestException(`同时打开的浏览器会话已达上限（${MAX_SESSIONS}），请先关闭一个`);
    }
    await this.assertUrlAllowed(url);
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ignoreHTTPSErrors: false });
    const page = await context.newPage();
    const id = `bs_${Math.random().toString(36).slice(2, 10)}`;
    const session: Session = { id, context, page, lastUsed: Date.now(), history: [] };
    this.sessions.set(id, session);
    this.created.set(id, Date.now());
    try {
      const res = await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
      session.history.push({ action: 'open', target: url, at: Date.now(), ok: !!res });
    } catch (e: any) {
      session.history.push({ action: 'open', target: url, at: Date.now(), ok: false });
      this.sessions.delete(id);
      await context.close().catch(() => undefined);
      throw new BadRequestException(`打开页面失败：${String(e?.message || e).slice(0, 200)}`);
    }
    return this.view(session);
  }

  private async view(s: Session): Promise<BrowserSessionView> {
    return {
      id: s.id,
      url: s.page.url(),
      title: await s.page.title().catch(() => ''),
      createdAt: this.created.get(s.id) ?? s.lastUsed,
      lastUsed: s.lastUsed,
      history: s.history.slice(-10),
    };
  }

  private session(id: string): Session {
    const s = this.sessions.get(id);
    if (!s) throw new BadRequestException('浏览器会话不存在或已关闭');
    s.lastUsed = Date.now();
    return s;
  }

  /** 导航到新地址 */
  async navigate(id: string, url: string) {
    const s = this.session(id);
    await this.assertUrlAllowed(url);
    const res = await s.page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    s.history.push({ action: 'navigate', target: url, at: Date.now(), ok: !!res });
    return this.view(s);
  }

  /** 取页面可见文本（供 Agent 阅读/摘要） */
  async text(id: string, maxChars = 8000) {
    const s = this.session(id);
    const body = await s.page.locator('body').innerText().catch(() => '');
    return {
      url: s.page.url(),
      title: await s.page.title().catch(() => ''),
      text: body.slice(0, Math.max(500, Math.min(50_000, maxChars))),
      truncated: body.length > maxChars,
    };
  }

  /** 截图（返回 data URL，前端可直接展示） */
  async screenshot(id: string, fullPage = false) {
    const s = this.session(id);
    const buf = await s.page.screenshot({ fullPage, type: 'png' });
    return { url: s.page.url(), dataUrl: `data:image/png;base64,${buf.toString('base64')}` };
  }

  /** 点击一个 CSS 选择器（或文本） */
  async click(id: string, selector: string) {
    const s = this.session(id);
    try {
      const loc = selector.startsWith('text=') ? s.page.getByText(selector.slice(5), { exact: false }).first() : s.page.locator(selector).first();
      await loc.click({ timeout: 10_000 });
      s.history.push({ action: 'click', target: selector, at: Date.now(), ok: true });
      await s.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
      return { ok: true, ...(await this.view(s)) };
    } catch (e: any) {
      s.history.push({ action: 'click', target: selector, at: Date.now(), ok: false });
      throw new BadRequestException(`点击失败：${String(e?.message || e).slice(0, 200)}`);
    }
  }

  /** 在输入框填入文本 */
  async fill(id: string, selector: string, value: string) {
    const s = this.session(id);
    try {
      await s.page.locator(selector).first().fill(value, { timeout: 10_000 });
      s.history.push({ action: 'fill', target: selector, at: Date.now(), ok: true });
      return { ok: true };
    } catch (e: any) {
      s.history.push({ action: 'fill', target: selector, at: Date.now(), ok: false });
      throw new BadRequestException(`填入失败：${String(e?.message || e).slice(0, 200)}`);
    }
  }

  /** 列出可交互元素（供 Agent 决定下一步点什么） */
  async elements(id: string, limit = 40) {
    const s = this.session(id);
    // 回调在页面上下文执行（有 document/HTMLElement），服务端 TS 不加载 DOM lib，
    // 因此用 any 访问页面全局，避免为此把整个 server 的 lib 改成含 dom。
    const items = await s.page.evaluate((max) => {
      const g = globalThis as any;
      const out: { tag: string; text: string; selector: string; type?: string }[] = [];
      const sel = 'a,button,input,textarea,select,[role=button]';
      for (const el of Array.from(g.document.querySelectorAll(sel)) as any[]) {
        if (out.length >= max) break;
        const e = el as any;
        const rect = e.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        const text = (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 80);
        const id = e.id ? `#${e.id}` : '';
        const name = e.getAttribute('name') ? `[name="${e.getAttribute('name')}"]` : '';
        out.push({ tag: String(e.tagName).toLowerCase(), text, selector: id || name || String(e.tagName).toLowerCase(), type: e.getAttribute('type') || undefined });
      }
      return out;
    }, limit);
    return { url: s.page.url(), elements: items };
  }

  /**
   * 网页验收：按断言列表检查页面，返回逐条通过/失败。
   *
   * 为什么需要：能打开、能截图不等于「做对了」。Web 项目交付前必须能声明
   * 「标题是 X、按钮存在、点完出现 Y」，并由机器给出结论，而不是人眼看图。
   *
   * 支持 5 种断言（够覆盖大部分验收）：
   *  - exists：选择器存在
   *  - text：页面（或指定选择器）包含文本
   *  - count：选择器命中数量等于期望
   *  - visible：选择器可见
   *  - value：输入框的值等于期望（可选 selector）
   */
  async verify(
    id: string,
    checks: { type: 'exists' | 'text' | 'count' | 'visible' | 'value'; selector?: string; expect?: string | number; label?: string }[],
  ) {
    const s = this.session(id);
    const results: { label: string; type: string; ok: boolean; actual: string }[] = [];
    for (const c of checks) {
      const label = c.label || `${c.type}${c.selector ? ` ${c.selector}` : ''}`;
      let ok = false;
      let actual = '';
      try {
        switch (c.type) {
          case 'exists': {
            if (!c.selector) throw new Error('exists 需要 selector');
            const n = await s.page.locator(c.selector).count();
            ok = n > 0;
            actual = `${n} 个匹配`;
            break;
          }
          case 'visible': {
            if (!c.selector) throw new Error('visible 需要 selector');
            ok = await s.page.locator(c.selector).first().isVisible().catch(() => false);
            actual = ok ? '可见' : '不可见';
            break;
          }
          case 'count': {
            if (!c.selector) throw new Error('count 需要 selector');
            const n = await s.page.locator(c.selector).count();
            ok = n === Number(c.expect);
            actual = `${n}（期望 ${c.expect}）`;
            break;
          }
          case 'text': {
            const scope = c.selector ? s.page.locator(c.selector).first() : s.page.locator('body');
            const t = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ');
            const want = String(c.expect ?? '');
            ok = t.includes(want);
            actual = ok ? `包含「${want}」` : `未包含「${want}」，实际：${t.slice(0, 120)}`;
            break;
          }
          case 'value': {
            if (!c.selector) throw new Error('value 需要 selector');
            const v = await s.page.locator(c.selector).first().inputValue().catch(() => '');
            ok = v === String(c.expect ?? '');
            actual = `${JSON.stringify(v)}（期望 ${JSON.stringify(c.expect)}）`;
            break;
          }
          default:
            throw new Error(`未知断言类型：${(c as { type: string }).type}`);
        }
      } catch (e: any) {
        ok = false;
        actual = `执行失败：${String(e?.message || e).slice(0, 160)}`;
      }
      results.push({ label, type: c.type, ok, actual });
    }
    const passed = results.filter((r) => r.ok).length;
    s.history.push({ action: 'verify', target: `${passed}/${results.length}`, at: Date.now(), ok: passed === results.length });
    return {
      url: s.page.url(),
      title: await s.page.title().catch(() => ''),
      total: results.length,
      passed,
      failed: results.length - passed,
      allPassed: passed === results.length,
      results,
    };
  }

  async close(id: string) {
    const s = this.sessions.get(id);
    if (!s) return { ok: true };
    this.sessions.delete(id);
    this.created.delete(id);
    await s.context.close().catch(() => undefined);
    return { ok: true };
  }

  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const id of [...this.sessions.keys()]) await this.close(id);
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.browser = null;
  }
}
