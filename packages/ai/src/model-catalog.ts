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
}): Promise<ModelCatalogResult> {
  const protocol = normalizeProtocol(opts.protocol);
  const { url, headers } = catalogRequest(protocol, String(opts.baseUrl || ''), String(opts.apiKey || ''));
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (opts.signal) signals.push(opts.signal);
  try {
    const res = await fetch(url, {
      headers,
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
    const models = parseCatalog(protocol, json);
    return { ok: true, models, endpoint: url, status: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /abort|timeout|timed out/i.test(`${(e as { name?: string })?.name || ''} ${msg}`);
    return { ok: false, models: [], endpoint: url, error: timedOut ? `模型列表请求超时（${Math.round(timeoutMs / 1000)}s）` : `模型列表请求失败：${msg.slice(0, 300)}` };
  }
}
