import type { ChatSource } from '../types';

/** Narrow unknown error to readable message */
export function extractErrMsg(e: unknown): string {
  return typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string' ? e.message : String(e);
}

/**
 * API base（桌面端适配）：
 *  - Web 部署：未注入 → ''，全部走相对路径 /api（Vite 代理 / nginx 反代），行为与历史完全一致；
 *  - 桌面端（Electron）：preload 经 contextBridge 注入 window.sciflowDesktop.apiBase = http://127.0.0.1:<port>，
 *    页面从 file:// 加载时 fetch 需要绝对地址。
 */
declare global {
  interface Window {
    sciflowDesktop?: { apiBase?: string; openExternal?: (url: string) => void; version?: string };
  }
}
const API_BASE: string =
  typeof window !== 'undefined' && window.sciflowDesktop?.apiBase ? window.sciflowDesktop.apiBase : '';
/** 统一拼 API 地址：p 必须以 / 开头 */
export const u = (p: string) => `${API_BASE}${p}`;

/** 友好错误转译：后端中文业务错误原样保留；英文/状态码/网络错误转为清晰中文提示
 *  注意：只做「从无到有」的翻译——已经是中文业务文案时原样返回，绝不再二次改写。
 *  （历史 bug：request() 的 catch 用字符类正则判断是否需要透传，导致 74/87 条后端
 *   中文错误被覆盖成"无法连接服务器"。现在由 ApiError 携带 alreadyTranslated 标记，结构性杜绝。） */
const statusText: Record<number, string> = {
  400: '请求参数有误，请检查后重试',
  401: '未授权访问，请检查服务配置',
  403: '没有操作权限',
  404: '请求的内容不存在或已被删除',
  409: '操作冲突，请刷新后重试',
  413: '上传内容过大，请压缩后重试',
  422: '请求参数校验未通过，请检查后重试',
  429: '请求过于频繁，请稍后再试',
  500: '服务内部错误，请稍后重试',
  502: '网关异常，请稍后重试',
  503: '服务暂时不可用，请稍后重试',
};
const NETWORK_ERROR = '无法连接服务器，请确认服务已启动';

/** 是否已经是中文业务文案（含任一汉字即视为已翻译，直接透传给用户） */
function isTranslated(raw: unknown): raw is string {
  return typeof raw === 'string' && /[\u4e00-\u9fa5]/.test(raw);
}

export function friendlyError(raw: unknown, status?: number): string {
  if (isTranslated(raw)) return raw;
  if (status && statusText[status]) return statusText[status];
  return status ? `请求失败（${status}），请稍后重试` : NETWORK_ERROR;
}

/** API 错误：自带 status 与「已翻译」标记，供上层区分业务失败 / 网络失败 */
export class ApiError extends Error {
  readonly status: number;
  readonly translated: boolean;
  constructor(message: string, status = 0, translated = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.translated = translated;
  }
}

/** 是否为网络层失败（fetch 本身抛错 / 无响应），用于页面区分「配置错误」与「服务没起」 */
export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && e.status === 0;
}

/** 当前登录令牌（AUTH_MODE=jwt 企业模式用；本地模式恒为空） */
export function getToken(): string | null {
  try {
    return localStorage.getItem('sciflow.token');
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem('sciflow.token', token);
    else localStorage.removeItem('sciflow.token');
  } catch {
    /* ignore */
  }
}
/** 401 统一处理：清 token + 通知全局登录门（AuthGate 监听） */
function onUnauthorized(): void {
  setToken(null);
  try {
    window.dispatchEvent(new Event('sciflow:unauthorized'));
  } catch {
    /* ignore */
  }
}

/** 幂等方法：网络层失败/5xx 可安全重试（POST 等非幂等请求绝不自动重发，避免重复写入） */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS']);
/** 重试策略：仅网络层失败与 502/503/504（网关抖动）；退避 300ms → 900ms，最多 3 次尝试 */
const RETRY_STATUS = new Set([502, 503, 504]);
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单次 fetch（含超时/取消），供 request 的重试循环复用 */
async function fetchOnce(url: string, opts: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const token = getToken();
  try {
    const res = await fetch(u(url), {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts?.headers || {}),
      },
      ...opts,
      signal: opts?.signal ?? ctrl.signal,
    });
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  // 默认超时兜底（AI 网关限流/卡死时前端不无限等待）。AI 长任务由调用方传 signal 自行控制。
  const timeoutMs = opts?.signal ? 0 : 60000;
  const method = (opts?.method || 'GET').toUpperCase();
  const retriable = IDEMPOTENT.has(method) && !opts?.signal;

  let res: Response;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      res = await fetchOnce(url, opts, timeoutMs);
    } catch (e: unknown) {
      const isAbort = typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';
      if (isAbort && !retriable) throw new ApiError('请求已取消', 0, true);
      if (isAbort) {
        if (attempt < MAX_ATTEMPTS) { await sleep(300 * 3 ** (attempt - 1)); continue; }
        throw new ApiError('请求超时（服务响应较慢），请稍后重试', 0, true);
      }
      // 断网/服务未启动：幂等请求退避重试，其余立即报错
      if (retriable && attempt < MAX_ATTEMPTS) {
        await sleep(300 * 3 ** (attempt - 1));
        continue;
      }
      throw new ApiError(NETWORK_ERROR, 0, true);
    }
    // 网关抖动：幂等请求自动重试，用户不必手动刷新
    if (retriable && RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(300 * 3 ** (attempt - 1));
      continue;
    }
    break;
  }

  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) onUnauthorized();
    let raw: unknown;
    try {
      const data = await res.json();
      raw = data?.message ?? data?.error;
    } catch {
      /* 非 JSON 响应体：交给状态码映射 */
    }
    // 业务错误：中文文案原样透传（translated=true），英文则按状态码翻译
    throw new ApiError(friendlyError(raw, res.status), res.status, isTranslated(raw));
  }
  // 空响应体（204 / SSE 之外的 void 端点）不强行 parse
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  // 纯文本端点（投稿信/回复信/期刊推荐/文献综述等 Nest 直接返回字符串）：
  // 按文本原样交给调用方，不再把合法文本误判为「无法解析的数据」。
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const isPlainText =
    contentType.includes('text/plain') || contentType.includes('text/html') || contentType.includes('text/markdown');
  if (isPlainText) return text as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // 未声明 Content-Type 但确为纯文本：同样按文本返回（宁可展示原文，也不误报版本不匹配）
    const head = text.trimStart()[0];
    if (head !== '{' && head !== '[') return text as unknown as T;
    throw new ApiError('服务返回了无法解析的数据，请检查后端版本是否匹配', res.status, true);
  }
}


/** SSE 流式问答（主流智能体范式版：停止/推理流/来源/用量事件回调）
 * 事件契约：正文增量 data: {"delta": string}，可同事件携带 "reasoning"；
 * 正文前可能先来 data: {"sources": [{docName,score,chunkText,chunkSeq,referenceId,referenceTitle}]}；结束前 data: {"usage": {...}}；
 * data: {"error": string}；末尾 data: [DONE]。
 * 返回 abort 函数：调用后立即断开连接，已收文本保留（onDone 以当前全文触发）。
 */
export function streamChat(opts: {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  projectId?: string;
  docContext?: string;
  model?: string;
  enableThinking?: boolean;
  /** 本轮强制联网搜索（输入区「联网」开关） */
  webSearch?: boolean;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onSources?: (sources: ChatSource[]) => void;
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => void;
  /** Agent 工具调用（模型决定调用某个工具时触发；用于在对话里展示"正在检索…"） */
  onToolCall?: (call: { id?: string; name: string; arguments: string }) => void;
  onDone?: (full: string) => void;
  onError?: (msg: string) => void;
}): () => void {
  const ctrl = new AbortController();
  const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal;
  let full = '';
  const finish = () => opts.onDone?.(full);
  fetch(u('/api/chat/stream'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: JSON.stringify({
      message: opts.message,
      history: opts.history || [],
      projectId: opts.projectId,
      docContext: opts.docContext,
      model: opts.model,
      enableThinking: opts.enableThinking,
      webSearch: opts.webSearch,
    }),
    signal,
  })
    .then(async (res) => {
      if (!res.ok || !res.body) {
        let raw: unknown;
        try {
          const data = await res.json();
          raw = data?.message ?? data?.error;
        } catch {
          /* 非 JSON 错误体 */
        }
        throw new ApiError(friendlyError(raw, res.status), res.status, isTranslated(raw));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let reasoning = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (!payload) continue;
          if (payload === '[DONE]') {
            finish();
            return;
          }
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            // 坏行（网络截断/非 JSON 事件）：跳过，不中断整个流
            continue;
          }
          // 服务端显式错误事件：终止并上报（这是真错误，不是坏行）
          if (typeof json.error === 'string' && json.error) {
            opts.onError?.(friendlyError(json.error));
            opts.onDone?.(full);
            return;
          }
          if (json.sources) {
            opts.onSources?.(json.sources as unknown as ChatSource[]);
            continue;
          }
          if (json.usage) {
            opts.onUsage?.(json.usage as unknown as { prompt_tokens: number; completion_tokens: number; total_tokens: number });
            continue;
          }
          // Agent 工具调用：模型决定检索文献/查知识库时下发，供 UI 展示进度
          if (Array.isArray(json.tool_calls)) {
            for (const raw of json.tool_calls as Array<{ id?: string; function?: { name?: string; arguments?: string } }>) {
              const name = raw?.function?.name;
              if (name) opts.onToolCall?.({ id: raw.id, name, arguments: raw.function?.arguments ?? '{}' });
            }
            continue;
          }
          if (typeof json.delta === 'string') {
            full += json.delta;
            opts.onDelta?.(full);
          }
          if (typeof json.reasoning === 'string') {
            reasoning += json.reasoning;
            opts.onReasoning?.(reasoning);
          }
        }
      }
      finish();
    })
    .catch((e: unknown) => {
      // 用户主动停止：保留已收文本，正常收尾（不报错）
      if (typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError') {
        finish();
        return;
      }
      // 已经是中文业务文案的 ApiError 原样透传；其余交给 friendlyError 按状态码翻译
      if (e instanceof ApiError) {
        opts.onError?.(e.message);
        return;
      }
      opts.onError?.(friendlyError(extractErrMsg(e)));
    });
  return () => ctrl.abort();
}
