/**
 * 模型目录发现（设置页「地址 + Key → 自动检测可用模型」唯一实现）。
 *
 * 支持三种主流协议：
 *  - openai-compatible：GET {base}/models（OpenAI / DeepSeek / 通义 / 智谱 / Kimi / 豆包 / Ollama / vLLM …）
 *  - anthropic-messages：GET {base}/models（Anthropic 官方及其兼容网关）
 *  - google-gemini：GET {base}/models（Google Generative Language API）
 *
 * 纯解析函数与网络请求分离：解析函数是设置页、AI 传输层、单测共用的单一来源。
 */

export type ModelProtocol = 'openai-compatible' | 'anthropic-messages' | 'google-gemini';

export const MODEL_PROTOCOLS: readonly ModelProtocol[] = ['openai-compatible', 'anthropic-messages', 'google-gemini'];

export interface DiscoveredModel {
  id: string;
  displayName?: string;
  /** 上下文窗口（token），网关未提供时省略 */
  contextWindow?: number;
  /** 单次最大输出（token），网关未提供时省略 */
  maxOutput?: number;
  /** 是否支持工具调用（无明确元数据时按聊天模型保守推断） */
  toolCalling?: boolean;
  ownedBy?: string;
}

export interface ModelCatalogResult {
  ok: boolean;
  models: DiscoveredModel[];
  error?: string;
  endpoint: string;
  status?: number;
}

export function normalizeProtocol(value?: unknown): ModelProtocol {
  const v = String(value ?? '').trim();
  return (MODEL_PROTOCOLS as readonly string[]).includes(v) ? (v as ModelProtocol) : 'openai-compatible';
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return undefined;
}

/** 非聊天模型过滤：嵌入 / 重排 / 语音 / 图像 / 视频 / 审核模型不进入可选列表 */
const NON_CHAT_MODEL = /(^|[-_/.])(embed|embedding|rerank|tts|whisper|transcribe|speech|image|imagen|dall-e|flux|stable-diffusion|video|sora|moderation)([-_/.]|$)/i;

export function isChatModelId(id: string): boolean {
  return !!id && !NON_CHAT_MODEL.test(id);
}

/** OpenAI 兼容 /models 解析（兼容多种网关的上下文字段命名） */
export function parseOpenAICompatibleCatalog(raw: unknown): DiscoveredModel[] {
  const data = (raw as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const models: DiscoveredModel[] = [];
  for (const item of data) {
    const m = item as Record<string, unknown> | null;
    const id = typeof m?.id === 'string' ? m.id : '';
    if (!isChatModelId(id)) continue;
    models.push({
      id,
      displayName: typeof m?.['name'] === 'string' ? String(m['name']) : undefined,
      contextWindow: pickNumber(m?.['context_window'], m?.['context_length'], m?.['max_input'], m?.['max_input_tokens']),
      maxOutput: pickNumber(m?.['max_output'], m?.['max_output_tokens'], m?.['max_completion_tokens']),
      toolCalling: true,
      ownedBy: typeof m?.['owned_by'] === 'string' ? String(m['owned_by']) : undefined,
    });
  }
  return models;
}

/** Anthropic /models 解析（官方返回 data[]，无上下文元数据） */
export function parseAnthropicCatalog(raw: unknown): DiscoveredModel[] {
  const data = (raw as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const models: DiscoveredModel[] = [];
  for (const item of data) {
    const m = item as Record<string, unknown> | null;
    const id = typeof m?.id === 'string' ? m.id : '';
    if (!isChatModelId(id)) continue;
    models.push({
      id,
      displayName: typeof m?.['display_name'] === 'string' ? String(m['display_name']) : undefined,
      toolCalling: true,
    });
  }
  return models;
}

/** Google Generative Language /models 解析（只保留能 generateContent 的模型） */
export function parseGoogleCatalog(raw: unknown): DiscoveredModel[] {
  const data = (raw as { models?: unknown })?.models;
  if (!Array.isArray(data)) return [];
  const models: DiscoveredModel[] = [];
  for (const item of data) {
    const m = item as Record<string, unknown> | null;
    const name = typeof m?.name === 'string' ? m.name : '';
    const id = name.replace(/^models\//, '');
    if (!isChatModelId(id)) continue;
    const methods = Array.isArray(m?.['supportedGenerationMethods']) ? (m['supportedGenerationMethods'] as unknown[]).map(String) : [];
    if (methods.length && !methods.includes('generateContent')) continue;
    models.push({
      id,
      displayName: typeof m?.['displayName'] === 'string' ? String(m['displayName']) : undefined,
      contextWindow: pickNumber(m?.['inputTokenLimit']),
      maxOutput: pickNumber(m?.['outputTokenLimit']),
      toolCalling: true,
    });
  }
  return models;
}

export function parseCatalog(protocol: ModelProtocol, raw: unknown): DiscoveredModel[] {
  switch (protocol) {
    case 'anthropic-messages':
      return parseAnthropicCatalog(raw);
    case 'google-gemini':
      return parseGoogleCatalog(raw);
    default:
      return parseOpenAICompatibleCatalog(raw);
  }
}

/**
 * Ollama 的 OpenAI 兼容 `/v1/models` 不返回上下文/输出元数据，只有 `/api/show`
 * 才带 `parameters.num_ctx` 与 `model_info.*.context_length`。
 * 这里只对明确的本机 Ollama 端点补能力，避免把任意 OpenAI 兼容网关当成 Ollama。
 */
function ollamaApiRoot(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || u.port !== '11434') return null;
    const path = u.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

function ollamaParameter(raw: unknown, name: string): number | undefined {
  const parameters = typeof (raw as { parameters?: unknown })?.parameters === 'string'
    ? String((raw as { parameters: string }).parameters)
    : '';
  const match = parameters.match(new RegExp(`(?:^|\\n)\\s*${name}\\s+([0-9]+)`, 'i'));
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
}

export function parseOllamaShowCapabilities(raw: unknown): { contextWindow?: number; maxOutput?: number } {
  const info = (raw as { model_info?: Record<string, unknown> })?.model_info || {};
  const contextKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
  const nativeContext = contextKey ? pickNumber(info[contextKey]) : undefined;
  return {
    // 运行时 `num_ctx` 才是实际可用上下文；模型原生 context_length 只作为兜底
    contextWindow: ollamaParameter(raw, 'num_ctx') ?? nativeContext,
    maxOutput: ollamaParameter(raw, 'num_predict'),
  };
}

async function enrichOllamaCapabilities(
  models: DiscoveredModel[],
  baseUrl: string,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<DiscoveredModel[]> {
  const root = ollamaApiRoot(baseUrl);
  if (!root || models.length === 0) return models;
  try {
    const probe = await doFetch(`${root}/api/version`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
    });
    if (!probe.ok) return models;
  } catch {
    return models;
  }
  return Promise.all(models.map(async (m) => {
    try {
      const res = await doFetch(`${root}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model: m.id }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)),
      });
      if (!res.ok) return m;
      const caps = parseOllamaShowCapabilities(await res.json());
      return {
        ...m,
        contextWindow: caps.contextWindow ?? m.contextWindow,
        maxOutput: caps.maxOutput ?? m.maxOutput,
      };
    } catch {
      return m;
    }
  }));
}

function catalogRequest(protocol: ModelProtocol, baseUrl: string, apiKey: string): { url: string; headers: Record<string, string> } {
  const base = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (protocol === 'anthropic-messages') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return { url: `${base}/models`, headers };
  }
  if (protocol === 'google-gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
    return { url: `${base}/models`, headers };
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return { url: `${base}/models`, headers };
}

/**
 * 拉取模型目录。失败返回 ok=false + 可读原因（绝不抛出，设置页可当普通结果展示）。
 */
export async function fetchModelCatalog(opts: {
  baseUrl: string;
  apiKey?: string;
  protocol?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** 受控出站 fetch（连接级地址校验）；未提供时回落到全局 fetch（仅测试用） */
  fetchImpl?: typeof fetch;
}): Promise<ModelCatalogResult> {
  const protocol = normalizeProtocol(opts.protocol);
  const { url, headers } = catalogRequest(protocol, String(opts.baseUrl || ''), String(opts.apiKey || ''));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      headers,
      redirect: 'manual',
      signal: signals.length > 1 && typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0],
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, models: [], endpoint: url, status: res.status, error: `模型列表请求失败（HTTP ${res.status}）：${text.slice(0, 300)}` };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, models: [], endpoint: url, status: res.status, error: `模型列表不是合法 JSON：${text.slice(0, 200)}` };
    }
    let models = parseCatalog(protocol, json);
    models = await enrichOllamaCapabilities(models, opts.baseUrl, doFetch, timeoutMs);
    return { ok: true, models, endpoint: url, status: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort|timeout|timed out/i.test(`${(e as { name?: string })?.name || ''} ${msg}`);
    return { ok: false, models: [], endpoint: url, error: timedOut ? `模型列表请求超时（${Math.round(timeoutMs / 1000)}s）` : `模型列表请求失败：${msg.slice(0, 300)}` };
  }
}
