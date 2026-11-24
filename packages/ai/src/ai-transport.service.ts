import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pRetry from 'p-retry';
import pLimit from 'p-limit';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { fetchModelCatalog, normalizeProtocol, type ModelProtocol } from './model-catalog';
import { safeOutboundFetch } from './safe-outbound';
import { loadPromptAugmentation } from './prompt-augmentation';
import {
  generateText,
  generateObject,
  streamText,
  stepCountIs,
  jsonSchema as aiJsonSchema,
  type ModelMessage,
  type LanguageModelUsage,
} from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { jsonrepair } from 'jsonrepair';
import { decryptSecret } from '../../db/src/secret-crypto';
import { sqlite } from '../../db/src/database';
import { db } from '../../db/src/database';
import { llmCallLogs, customPrompts } from '../../db/src/schema';
import { eq } from 'drizzle-orm';
import { envInt } from '../../core/src/env';

const TEMPLATE_API_KEYS = new Set(['sk-your-api-key-here', 'sk-你的key', '${ai_api_key}', '<api_key>']);

export function normalizeApiKey(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value || TEMPLATE_API_KEYS.has(value.toLowerCase())) return '';
  return value;
}

/**
 * 真实模型常见违约：无视「字段名用英文」的提示，把 schema 键翻译成中文
 * （如 `是否批准: 驳回`、`置信度: 35`）。这里在 zod 校验前做一次确定性归一化，
 * 只映射已知语义别名，不猜测未知字段，也不放宽 schema 本身。
 */
export function normalizeStructuredObject(value: unknown, schemaText = '', depth = 0): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeStructuredObject(item, schemaText, depth));
  if (!value || typeof value !== 'object') return value;

  const props = new Set<string>();
  try {
    const schema = JSON.parse(schemaText) as { properties?: Record<string, unknown> };
    for (const key of Object.keys(schema.properties || {})) props.add(key);
  } catch {
    // schemaText 不是合法 JSON 时不做目标字段裁剪，仍按别名映射
  }

  const alias = (key: string): string => {
    if (props.has(key)) return key;
    const normalized = key.trim().toLowerCase();
    const exact: Record<string, string> = {
      是否批准: 'approved',
      批准: 'approved',
      审批结果: 'approved',
      置信度: 'confidence',
      信心度: 'confidence',
      信心: 'confidence',
      理由: 'rationale',
      依据: 'rationale',
      原因: 'rationale',
      顾虑: 'concerns',
      担忧: 'concerns',
      风险: 'concerns',
      修改要求: 'requiredChanges',
      需要修改: 'requiredChanges',
      建议修改: 'requiredChanges',
    };
    if (exact[key]) return exact[key];
    if (/批准|审批/.test(key)) return 'approved';
    if (/置信|信心/.test(key)) return 'confidence';
    if (/理由|依据|原因/.test(key)) return 'rationale';
    if (/顾虑|担忧|风险/.test(key)) return 'concerns';
    if (/修改|整改/.test(key)) return 'requiredChanges';
    return normalized || key;
  };

  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = alias(rawKey);
    if (depth === 0 && props.size && !props.has(key)) continue;
    if (key === 'approved' && typeof rawValue === 'string') {
      const text = rawValue.trim().toLowerCase();
      out[key] = /^(true|yes|1|批准|通过|同意|是)$/.test(text);
      continue;
    }
    if (key === 'confidence' && typeof rawValue === 'string' && rawValue.trim() !== '') {
      const num = Number(rawValue);
      out[key] = Number.isFinite(num) ? num : rawValue;
      continue;
    }
    if ((key === 'concerns' || key === 'requiredChanges') && typeof rawValue === 'string') {
      out[key] = rawValue.trim() ? [rawValue.trim()] : [];
      continue;
    }
    if (Array.isArray(rawValue)) {
      out[key] = rawValue.map((item) => normalizeStructuredObject(item, schemaText, depth + 1));
      continue;
    }
    out[key] = rawValue && typeof rawValue === 'object' ? normalizeStructuredObject(rawValue, schemaText, depth + 1) : rawValue;
  }
  return out;
}

export type ChatContentPart = { type: 'text'; text: string } | { type: 'image'; image: string; mediaType?: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** 多模态内容（仅当前用户轮使用）；有值时 content 仍保留纯文本，供摘要/持久化/日志读取。 */
  parts?: ChatContentPart[];
}

/**
 * 上游返回空响应（区别于限流）：
 *  - 可重试（与限流同等对待，指数退避重试 4 次）
 *  - 重试耗尽后以 502 暴露（历史实现用 429 伪装限流触发重试，导致上层误判为「速率限制」）
 */
export class AiEmptyResponseError extends Error {
  constructor() {
    super('AI 返回空响应');
    this.name = 'AiEmptyResponseError';
  }
}

/**
 * 本机 Ollama 的 OpenAI 兼容端点：默认给 /chat/completions 补 `think:false`。
 * 1B 级 thinking 模型在长系统提示下会把 maxOutputTokens 全烧在 reasoning 上，
 * 最终 content 为空（润色/评审/质量门实测 502 的根因之一）。云端网关不受影响。
 */
function withOllamaNoThink(fetchImpl: typeof safeOutboundFetch): typeof safeOutboundFetch {
  return async (input, init = {}, opts) => {
    try {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl);
      if (url.port !== '11434' || !url.pathname.endsWith('/chat/completions')) return fetchImpl(input, init, opts);
      const body = init.body;
      if (typeof body !== 'string') return fetchImpl(input, init, opts);
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && parsed.think === undefined) {
        parsed.think = false;
        // Ollama 的 OpenAI 兼容层只认 reasoning_effort（think 字段会被忽略）；两者都带，兼容旧版/新版。
        if (parsed.reasoning_effort === undefined) parsed.reasoning_effort = 'none';
        return fetchImpl(input, { ...init, body: JSON.stringify(parsed) }, opts);
      }
    } catch {
      // 非 JSON 请求体/非标准 URL 时保持原样
    }
    return fetchImpl(input, init, opts);
  };
}

/** 单次模型调用的 token 用量（流式收尾或非流式返回） */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** chat 流式/问答的可选运行参数（best-effort 透传，厂商不支持时静默忽略） */
export interface ChatStreamOptions {
  /** 显式覆盖完整模型 ID（优先于 fast/strong 档位） */
  modelName?: string;
  /** 开启推理过程输出（对应上游 delta.reasoning_content / delta.thinking 透传） */
  enableThinking?: boolean;
  /** 客户端断连时中止上游生成，避免空跑 token */
  signal?: AbortSignal;
  /** 工具集（Agent 模式下注入） */
  tools?: ToolSet;
  /** 工具调用最大步数 */
  maxSteps?: number;
  /** 本轮真实 token 用量回调（流式收尾块 / 非流式回退都会触发） */
  onUsage?: (usage: TokenUsage) => void;
  /** 长文写作档：继承 pipeline 论文约束，不注入 500 字聊天简洁约束 */
  writing?: boolean;
  /** 当前用户轮的多模态内容；历史消息仍只传纯文本，避免重复上传大文件。 */
  userParts?: ChatContentPart[];
}

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  /** 模型档位：fast=轻量快速（默认），strong=强模型（长文/评审/规划等高难任务） */
  model?: 'fast' | 'strong';
  /** 调用方标识（成本追踪落库用） */
  context?: string;
  /** 显式指定完整模型 ID（覆盖 fast/strong 档位；best-effort） */
  modelName?: string;
  /** 流式请求收尾 usage 块（stream_options.include_usage） */
  streamIncludeUsage?: boolean;
  /** 外部 AbortSignal（客户端断连时中止上游请求） */
  signal?: AbortSignal;
  /** 思考模式开关：仅 true 时附加上下文厂商 thinking 参数；不支持的厂商静默忽略 */
  enableThinking?: boolean;
  /** JSON Schema 结构化输出（经 AI SDK jsonSchema 包装走 response_format） */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /** 工具集（AI SDK tool 定义）。提供时 streamText 会走 tool-calling 循环 */
  tools?: ToolSet;
  /** 允许多步工具调用（默认 1，即单轮） */
  maxSteps?: number;
  /** 失败重试次数（默认 4；润色等长输出场景应降低，避免空响应重试把流水线拖死） */
  retries?: number;
  /** 真实用量回调；上层可据此做计划预算/成本归属，不依赖全局 lastTotalTokens */
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * 工具结果太长时截断后再通过 SSE 下发。
 *
 * 对话里的工具返回可能是整篇文档、检索结果数组或实验日志；原样塞进 SSE 会把
 * 上下文和前端存储一起撑爆。保留前 1600 字符供用户核对，同时回传真实长度，
 * 前端可以明确显示“已截断”。
 */
export function describeToolPayload(value: unknown, maxChars = 1600): { text: string; chars: number } {
  let text = '';
  if (typeof value === 'string') {
    text = value;
  } else if (value instanceof Error) {
    text = value.message;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (text === undefined || text === null) text = '';
  const chars = text.length;
  if (chars > maxChars) {
    text = `${text.slice(0, maxChars)}\n…（已截断，共 ${chars} 字符）`;
  }
  return { text, chars };
}

/**
 * 底层 LLM 传输层 — 经 Vercel AI SDK（@ai-sdk/openai-compatible）访问 OpenAI 兼容端点，
 * 保留 fast/strong 路由、p-limit 限流、p-retry 退避、token 成本落库、多厂商切换。
 *
 * 协议细节（SSE 解析、分块拼装、usage 提取）由 AI SDK 承担，本层不再手写。
 * 不含任何 domain 级 prompt / 业务方法（那些在 AiService 里）。
 * 其他不相干服务也可以独立注入本 provider，复用 transport 层。
 */
@Injectable()
export class AiTransportService {
  protected readonly logger = new Logger(AiTransportService.name);

  protected baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
  /** 当前生效密钥：优先 env，被激活厂商覆盖（v0.3.0 起库内为密文，读取时解密）。私有字段 + getter 暴露。 */
  private _secretKey = normalizeApiKey(process.env.AI_API_KEY || '');
  protected mockConnectionActive = false;
  /** fast 档：轻量快速模型（默认） */
  protected fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '';
  /** strong 档：强模型（高难任务；未配置则回落 fast） */
  protected strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
  /** 协议（OpenAI 兼容 / Anthropic Messages / Google Gemini）；被激活厂商覆盖 */
  protected protocol: ModelProtocol = normalizeProtocol(process.env.AI_PROTOCOL);
  /** 上下文窗口（0=未知） */
  protected contextWindow = 0;
  /** 单次最大输出（0=未知，回落 4096） */
  protected maxOutput = 0;
  /** 是否支持工具调用（无元数据时默认 true，保持既有行为） */
  protected toolCalling = true;

  // ---------- 并发限流：p-limit（成熟库替代手写实现） ----------
  // RPM 换算为并发上限：假设单请求 ~10s，RPM 60 → 最多 6 并发；取保守值避免 429
  protected readonly limit = pLimit(Math.max(1, Math.floor(envInt('AI_RPM_CAP', 60, { min: 1, max: 100_000 }) / 6)));

  constructor() {
    this.applyActiveProvider();
  }

  /** 读取当前生效密钥 */
  protected get apiKey(): string {
    return this._secretKey;
  }

  /** 覆盖当前生效密钥（解密后写入） */
  protected setApiKey(v: string): void {
    this._secretKey = normalizeApiKey(v);
  }

  /** 切换激活厂商（设置页调用，立即生效） */
  switchProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as
      { base_url?: string; ['api_key']?: string; model?: string } | undefined;
    if (!row) throw new HttpException('模型厂商不存在', HttpStatus.NOT_FOUND);
    this.mockConnectionActive = false;
    this.setApiKey('');
    this.baseUrl = String(row.base_url).replace(/\/$/, '');
    this.setApiKey(row['api_key'] ? normalizeApiKey(decryptSecret(String(row['api_key']))) : '');
    this.fastModel = String(row.model);
    this.strongModel = String(row.model);
    this.applyProviderCapabilities(row as Record<string, unknown>);
    sqlite.prepare('UPDATE model_provider SET is_active = 0 WHERE is_active = 1').run();
    sqlite.prepare('UPDATE model_provider SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /** 回退到环境变量配置（删除激活中的厂商时调用，避免内存残留失效厂商） */
  resetToEnv() {
    this.mockConnectionActive = false;
    this.baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    this.setApiKey(normalizeApiKey(process.env.AI_API_KEY || ''));
    this.fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '';
    this.strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
    this.protocol = normalizeProtocol(process.env.AI_PROTOCOL);
    this.contextWindow = 0;
    this.maxOutput = 0;
    this.toolCalling = true;
  }

  get configured(): boolean {
    try {
      const url = new URL(this.baseUrl);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password &&
        !!this.fastModel.trim() &&
        // 本机 Ollama 的 OpenAI 兼容端点不需要 API Key；此前一律要求 apiKey，
        // 导致「本地模型导入成功」后 /chat 仍 503「AI 服务未配置」。
        (this.mockConnectionActive || !!this.apiKey || this.isLocalRuntime())
      );
    } catch {
      return false;
    }
  }

  get config(): {
    baseUrl: string;
    model: string;
    fastModel: string;
    strongModel: string;
    configured: boolean;
    mock: boolean;
    protocol: ModelProtocol;
    contextWindow: number;
    maxOutput: number;
    toolCalling: boolean;
    /** true = 未配置 strong 档，高难任务（PI/评审/长文起草）实际在用 fast 模型 */
    strongModelFallback: boolean;
  } {
    return {
      baseUrl: this.baseUrl,
      model: this.fastModel,
      fastModel: this.fastModel,
      strongModel: this.strongModel,
      configured: this.configured,
      mock: this.mockConnectionActive,
      protocol: this.protocol,
      contextWindow: this.contextWindow,
      maxOutput: this.maxOutput,
      toolCalling: this.toolCalling,
      strongModelFallback: !process.env.AI_MODEL_STRONG && this.strongModel === this.fastModel,
    };
  }

  /** 读取厂商行内的能力列（旧库缺列时按未知/默认处理） */
  protected applyProviderCapabilities(row: Record<string, unknown> | undefined): void {
    if (!row) return;
    this.protocol = normalizeProtocol(row['protocol']);
    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    };
    this.contextWindow = num(row['contextWindow'] ?? row['context_window']);
    this.maxOutput = num(row['maxOutput'] ?? row['max_output']);
    const tc = row['toolCalling'] ?? row['tool_calling'];
    this.toolCalling = tc === undefined || tc === null ? true : Number(tc) !== 0;
  }

  /**
   * 单次请求的输出上限：优先显式参数；否则用厂商上报值，但**夹到 8192**。
   *
   * 历史事故（本轮实测）：u2-flash 上报 max_output=131072，若原样下发，模型会一直生成到
   * 上限，单章起草耗时 170s+ 直接触发 180s 请求超时，流水线反复失败。
   * 学术章节 800-1500 字，8192 tokens 足够；需要更长输出的调用方显式传 maxTokens。
   */
  protected defaultMaxOutput(): number {
    const reported = this.maxOutput > 0 ? this.maxOutput : 0;
    const cap = this.contextWindow > 0 ? Math.min(reported || this.contextWindow, this.contextWindow) : reported;
    if (cap > 0) return Math.max(1, Math.min(cap, 8192));
    return 4096;
  }

  /** 自定义提示词查询：用户配置优先，未配置返回 null（调用方回退系统默认） */
  getCustomPrompt(toolKey: string): string | null {
    try {
      const row = db.select().from(customPrompts).where(eq(customPrompts.toolKey, toolKey)).get();
      return row?.enabled ? row.prompt : null;
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- //
  //  transport helpers                                              //
  // ----------------------------------------------------------------- //

  /** strong 档回落告警只打一次，避免每个请求刷日志 */
  private strongFallbackWarned = false;

  protected resolveModel(opts: CompleteOptions): string {
    if (opts.modelName) return opts.modelName;
    if (opts.model === 'strong' && this.strongModel === this.fastModel && !this.strongFallbackWarned) {
      this.strongFallbackWarned = true;
      // 这是「科研质量瓶颈」的可观测点：PI/评审本该用强模型，实际用了 fast。
      console.warn(`[ai] 未配置 AI_MODEL_STRONG，高难任务（PI/评审/长文）将使用 ${this.fastModel}；建议在设置中指定强模型`);
    }
    return opts.model === 'strong' ? this.strongModel : this.fastModel;
  }

  protected assertConfigured(): void {
    if (!this.configured) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * 把配置中心的约束/钩子注入到 system 层（单一注入点，chat 与流水线都经过这里）。
   * - scope 按 caller 归类：chat / chatSessionSummary / judgmentIntent → chat，chatWriting → writing，其余 → pipeline
   * - 无配置时零开销（返回原数组）
   */
  protected withConfigAugmentation(messages: ChatMessage[], caller: string): ChatMessage[] {
    const scope =
      caller === 'chatWriting' ? 'writing' : ['chat', 'chatSessionSummary', 'judgmentIntent'].includes(caller) ? 'chat' : 'pipeline';
    const augmentation = loadPromptAugmentation(scope);
    if (!augmentation) return messages;
    const firstSystem = messages.findIndex((m) => m.role === 'system');
    if (firstSystem >= 0) {
      const next = messages.slice();
      next[firstSystem] = {
        ...next[firstSystem],
        content: `${next[firstSystem].content}

${augmentation}`,
      };
      return next;
    }
    return [{ role: 'system', content: augmentation }, ...messages];
  }

  /** 最近一次调用的总 token 数（流水线预算器打点用；每次调用覆盖） */
  lastTotalTokens = 0;

  /**
   * 按 caller 维度的最近一次 token 合计。
   * 用于并发场景（分章起草 p-limit 并行后逐个打点）——全局单值会被最后一次调用覆盖，
   * 导致预算系统性漏计 / 多任务串账。
   */
  private readonly lastTokensByCaller = new Map<string, number>();

  /** 读取某 caller 最近一次调用的 token 合计（未调用过返回 0） */
  lastTokensFor(caller: string): number {
    return this.lastTokensByCaller.get(caller) ?? 0;
  }

  /** LLM 调用成本追踪（token 用量审计，落 llm_call_log 表） */
  protected logLlmCall(opts: {
    caller: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    success: boolean;
    error?: string;
  }): void {
    try {
      this.lastTotalTokens = opts.promptTokens + opts.completionTokens;
      this.lastTokensByCaller.set(opts.caller || 'general', this.lastTotalTokens);
      db.insert(llmCallLogs)
        .values({
          id: randomUUID(),
          caller: opts.caller || 'general',
          kind: 'llm',
          model: opts.model,
          promptTokens: opts.promptTokens,
          completionTokens: opts.completionTokens,
          totalTokens: opts.promptTokens + opts.completionTokens,
          latencyMs: opts.latencyMs,
          success: opts.success ? 1 : 0,
          error: opts.error || '',
          createdAt: Date.now(),
        })
        .run();
    } catch {
      /* 日志写入失败不影响主流程 */
    }
  }

  /**
   * AI SDK v7 语义：system 消息不得混入 messages/prompt（真实厂家会直接 400：
   * "System messages are not allowed... Use the instructions option instead"；mock 网关不校验）。
   * 统一拆分：system → instructions，其余保持顺序。
   */
  private splitSystemMessages(messages: ChatMessage[]): { instructions: string | undefined; rest: ModelMessage[] } {
    const sys = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
      .trim();
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) =>
        m.parts?.length ? { role: m.role, content: m.parts } : { role: m.role, content: m.content },
      ) as unknown as ModelMessage[];
    return { instructions: sys || undefined, rest };
  }

  /** 上游限流判定：AI SDK 用 statusCode；兼容 status 字段与厂商文案（含中文"速率限制"/英文 rate limit/quota/429） */
  static isRetriableLimit(err: unknown): boolean {
    const e = err as { statusCode?: number; status?: number; message?: string } | null;
    if (e?.statusCode === 429 || e?.status === 429) return true;
    const msg = String(e?.message || '');
    return /\(429\)|\b429\b|rate.?limit|too many requests|quota|速率限制|限流|限额/i.test(msg);
  }

  /**
   * 是否超时类错误：AbortError/TimeoutError 且耗时接近上限（区分客户端主动断连）。
   */
  static isTimeoutError(err: unknown, elapsedMs: number, timeoutMs = AiTransportService.requestTimeoutMs()): boolean {
    if (timeoutMs <= 0) return false;
    const name = String((err as { name?: string })?.name || '');
    const msg = String((err as { message?: string })?.message || (err as unknown as string) || '');
    const looksTimeout = /abort|timeout|timed out|ETIMEDOUT|空闲超时/i.test(`${name} ${msg}`);
    return looksTimeout && elapsedMs >= timeoutMs * 0.9;
  }

  /** AI SDK usage（对象/数值两种版本兼容）→ 平铺 token 数 */ private usageTokens(usage: LanguageModelUsage | undefined): {
    prompt: number;
    completion: number;
  } {
    if (!usage) return { prompt: 0, completion: 0 };
    const num = (v: unknown): number =>
      typeof v === 'number' ? v : typeof (v as { total?: unknown })?.total === 'number' ? (v as { total: number }).total : 0;
    return { prompt: num(usage.inputTokens), completion: num(usage.outputTokens) };
  }

  /**
   * 请求级超时（毫秒）：`AI_REQUEST_TIMEOUT_MS`，默认 180s，0=禁用。
   * 历史事故：网关建立连接后不返回数据，fetch 永不结束；abortSignal 只来自客户端断连，
   * 无浏览器请求（流水线/CLI/MCP）时永不触发 → 流水线卡死在 running 无法自愈。
   */
  static requestTimeoutMs(): number {
    return envInt('AI_REQUEST_TIMEOUT_MS', 180_000, { min: 0, max: 3_600_000 });
  }

  /**
   * 合并「外部断连信号」与「请求超时信号」：任一触发即中止上游。
   * 超时 = 0 且无外部信号时返回一个永不 abort 的信号，保持调用方语义统一。
   */
  static withTimeout(signal: AbortSignal | undefined, timeoutMs = AiTransportService.requestTimeoutMs()): AbortSignal {
    if (timeoutMs <= 0) return signal ?? new AbortController().signal;
    const timeout = AbortSignal.timeout(timeoutMs);
    if (!signal) return timeout;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
    // 运行时无 AbortSignal.any（Node < 20.3）时手工桥接
    const ctrl = new AbortController();
    const abort = (reason: unknown) => {
      if (!ctrl.signal.aborted) ctrl.abort(reason);
    };
    if (signal.aborted) abort(signal.reason);
    else signal.addEventListener('abort', () => abort(signal.reason), { once: true });
    timeout.addEventListener('abort', () => abort(timeout.reason), { once: true });
    return ctrl.signal;
  }

  /** 构造 AI SDK 模型实例（每次调用读取当前 baseUrl/key，保证设置页切换立即生效） */
  protected buildModel(modelId: string, signal?: AbortSignal): LanguageModel {
    void signal;
    return this.buildModelWith(this.protocol, this.baseUrl, this._secretKey, modelId);
  }

  /** 按协议构造模型实例（连接测试用临时配置时也走这里，保证协议行为一致） */
  protected buildModelWith(protocolValue: string, baseUrl: string, apiKey: string, modelId: string): LanguageModel {
    const protocol = normalizeProtocol(protocolValue);
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (protocol === 'anthropic-messages') {
      const provider = createAnthropic({ name: 'sciflow', baseURL: base, apiKey, fetch: safeOutboundFetch });
      return provider(modelId);
    }
    if (protocol === 'google-gemini') {
      const provider = createGoogleGenerativeAI({ name: 'sciflow', baseURL: base, apiKey, fetch: safeOutboundFetch });
      return provider(modelId);
    }
    const provider = createOpenAICompatible({
      name: 'sciflow',
      baseURL: base,
      apiKey,
      headers: { Authorization: `Bearer ${apiKey}` },
      supportsStructuredOutputs: true,
      fetch: withOllamaNoThink(safeOutboundFetch),
      // 流式 usage：OpenAI 兼容端点默认不返回 usage 块，开启 includeUsage 后
      // AI SDK 会带 stream_options.include_usage，token 成本/上下文占比才不是全 0
      includeUsage: true,
    });
    return provider(modelId);
  }

  /** 非 stream_options.include_usage 兼容探测：某些网关拒绝该参数（保留容错语义由 AI SDK headers/参数层处理） */

  /** 降级链配置：AI_MODEL_FALLBACK 指定备选模型（同一端点），主模型重试耗尽后自动切换一次。
   *  动态读取 env 以便测试注入；流式路径不适用（中途失败已有增量输出，无法安全重放）。 */
  protected fallbackModel(): string {
    return (process.env.AI_MODEL_FALLBACK || '').trim();
  }

  /** 是否为本机 Ollama OpenAI 兼容端点（用于关闭 thinking / 跳过 json_schema）。 */
  protected isLocalRuntime(): boolean {
    return /^(http:\/\/)?(127\.0\.0\.1|localhost):11434(\/|$)/.test(this.baseUrl);
  }

  /** 单模型生成（含 p-retry 指数退避）：complete 与降级链共用的最小生成单元 */
  protected async generateWithRetry(
    messages: ChatMessage[],
    opts: CompleteOptions,
    model: string,
    caller: string,
    retries: number,
  ): Promise<{ text: string; usage?: LanguageModelUsage }> {
    return pRetry(
      async () => {
        const { instructions, rest } = this.splitSystemMessages(this.withConfigAugmentation(messages, caller));
        const callArgs = {
          model: this.buildModel(model),
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? this.defaultMaxOutput(),
          abortSignal: AiTransportService.withTimeout(opts.signal),
          instructions,
          messages: rest,
        };
        if (opts.jsonSchema) {
          // 本地 1B 模型对 response_format json_schema 支持不稳定，直接走纯文本 JSON；
          // 提示词本身已要求 JSON，上层 jsonOf 会做 jsonrepair。
          if (this.isLocalRuntime()) {
            const { text, usage } = await generateText({ ...callArgs, maxOutputTokens: Math.max(opts.maxTokens ?? 0, 4096) });
            if (!text.trim()) throw new AiEmptyResponseError();
            return { text, usage };
          }
          // 结构化路径：走 generateObject（v7 中 response_format json_schema 仅由它下发）
          try {
            const { object, usage } = await generateObject({
              ...callArgs,
              schema: aiJsonSchema(opts.jsonSchema.schema),
            });
            const text = JSON.stringify(object);
            if (!text.trim()) throw new AiEmptyResponseError();
            return { text, usage };
          } catch (err: any) {
            // 小参数本地模型（如 1B）常不支持 response_format json_schema，会返回截断 JSON 或
            // AI_NoObjectGeneratedError。此时退回纯文本生成，仍让模型按提示词输出 JSON，
            // 由上层 jsonOf 解析；比直接 502 更符合「本地模型只做轻任务」的降级口径。
            if (err?.name === 'AI_NoObjectGeneratedError' || err?.name === 'AI_JSONParseError') {
              this.logger.warn(`结构化输出失败，回退纯文本 JSON：${String(err?.message || err).slice(0, 80)}`);
              const { text, usage } = await generateText({ ...callArgs, maxOutputTokens: Math.max(opts.maxTokens ?? 0, 4096) });
              if (!text.trim()) throw new AiEmptyResponseError();
              return { text, usage };
            }
            throw err;
          }
        }
        const { text, usage } = await generateText(callArgs);
        if (!text.trim()) throw new AiEmptyResponseError();
        return { text, usage };
      },
      {
        retries,
        factor: 2,
        minTimeout: 2000,
        maxTimeout: 60_000,
        onFailedAttempt: (err) => {
          if (!AiTransportService.isRetriableLimit(err) && !(err instanceof AiEmptyResponseError)) throw err;
          this.logger.warn(
            `AI 调用重试：第 ${err.attemptNumber} 次失败，剩余 ${err.retriesLeft} 次（${String((err as { message?: string }).message || '').slice(0, 80)}）`,
          );
        },
      },
    );
  }

  /** 非流式补全（p-limit 限流 + p-retry 指数退避重试 + token 成本追踪 + 可选降级链） */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';

    return this.limit(async () => this.generateWithRetry(messages, opts, model, caller, opts.retries ?? 4))
      .then(({ text, usage }) => {
        const tokens = this.usageTokens(usage);
        this.logLlmCall({
          caller,
          model,
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          latencyMs: Date.now() - t0,
          success: true,
        });
        return text;
      })
      .catch(async (err: any) => {
        // 降级链：主模型重试耗尽后，若配置了备选模型且请求未被用户取消，用备选模型再试一次。
        // 只覆盖非流式路径——流式一旦吐出增量就无法安全重放。
        const fb = this.fallbackModel();
        if (fb && fb !== model && !opts.signal?.aborted) {
          const t1 = Date.now();
          try {
            this.logger.warn(`AI 主模型失败，启用降级链：${model} -> ${fb}（${String(err?.message || err).slice(0, 120)}）`);
            const { text, usage } = await this.generateWithRetry(messages, opts, fb, caller, 1);
            const tokens = this.usageTokens(usage);
            this.logLlmCall({
              caller: `${caller}:fallback`,
              model: fb,
              promptTokens: tokens.prompt,
              completionTokens: tokens.completion,
              latencyMs: Date.now() - t1,
              success: true,
            });
            return text;
          } catch (fbErr: any) {
            this.logLlmCall({
              caller: `${caller}:fallback`,
              model: fb,
              promptTokens: 0,
              completionTokens: 0,
              latencyMs: Date.now() - t1,
              success: false,
              error: fbErr?.message,
            });
            // 降级也失败：保留原始主模型错误（更有诊断价值），降级错误仅留痕
            this.logger.warn(`AI 降级模型也失败：${String(fbErr?.message || fbErr).slice(0, 120)}`);
          }
        }
        this.logLlmCall({
          caller,
          model,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - t0,
          success: false,
          error: err?.message,
        });
        if (err instanceof HttpException) throw err;
        if (err instanceof AiEmptyResponseError) {
          throw new HttpException('AI 返回空响应：模型未产出任何内容（已自动重试 4 次），请更换模型或稍后重试', HttpStatus.BAD_GATEWAY);
        }
        if (AiTransportService.isRetriableLimit(err))
          throw new HttpException('AI 限流 (429)：上游速率限制，请降低 AI_RPM_CAP 或升级模型配额', 429);
        const timeoutMs = AiTransportService.requestTimeoutMs();
        if (AiTransportService.isTimeoutError(err, t0, timeoutMs)) {
          throw new HttpException(
            `AI 请求超时（${Math.round(timeoutMs / 1000)}s 无响应，可通过 AI_REQUEST_TIMEOUT_MS 调整）：上游端点无响应，任务已中止以免永久挂起`,
            HttpStatus.GATEWAY_TIMEOUT,
          );
        }
        throw new HttpException(`AI 服务调用失败: ${AiTransportService.describeError(err).slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
      });
  }

  /** 结构化补全：zod schema 强约束输出（约束工程主路径，替代手写 JSON 抠取） */
  async completeStructured<T>(messages: ChatMessage[], schema: import('zod').core.$ZodType, opts: CompleteOptions = {}): Promise<T> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';

    /**
     * 真实模型（deepseek-v4.1-flash 等 OpenAI-compatible 网关）不一定支持
     * response_format=json_schema。实测它会无视 generateObject 的 schema，直接回一段
     * Markdown「假设/协议」，导致研究循环第一步就 AI_NoObjectGeneratedError。
     *
     * 这里把 Zod schema 转成 JSON Schema 文本塞进 system，让模型在纯文本路径也能看到
     * 字段约束；generateObject 仍优先走原生结构化输出，失败后再用同一份带 schema 的
     * prompt 走 generateText + jsonrepair 兜底。兜底仍用同一 Zod schema 校验，绝不放过
     * 结构不合法的对象。
     */
    const zodSchema = schema as unknown as { toJSONSchema?: () => Record<string, unknown> };
    let schemaText = '';
    try {
      schemaText = zodSchema.toJSONSchema ? JSON.stringify(zodSchema.toJSONSchema()) : '';
    } catch {
      schemaText = '';
    }
    const formatHint = [
      '【结构化输出硬约束】',
      '只输出一个合法 JSON 对象，不要 Markdown 标题、解释、前后缀或代码围栏。',
      '所有字段必须严格符合下面的 JSON Schema；无法确定的字段按 schema 的默认值或空数组处理，不要省略必填字段。',
      '字段名必须与 JSON Schema 的 properties 完全一致（通常是英文键），禁止把键名翻译成中文或改写；字段值可以用中文。',
      '布尔值必须是 true/false，不要写「是/否」「批准/驳回」这类自然语言值。',
      schemaText ? `JSON Schema：${schemaText}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return this.generateStructuredWithRetry<T>(messages, schema, schemaText, formatHint, opts, model, caller, opts.retries ?? 2)
      .catch(async (err: any) => {
        // 与 complete() 对齐：主模型重试耗尽后切备选模型。真实网关偶发空响应时，
        // 专家审批/评审节点不能因为一个模型失败就整轮 blocked（2026-11-24 实测）。
        const fb = this.fallbackModel();
        if (fb && fb !== model && !opts.signal?.aborted) {
          try {
            this.logger.warn(
              `结构化输出主模型失败，启用降级链：${model} -> ${fb}（${AiTransportService.describeError(err).slice(0, 120)}）`,
            );
            const result = await this.generateStructuredWithRetry<T>(
              messages,
              schema,
              schemaText,
              formatHint,
              opts,
              fb,
              `${caller}:fallback`,
              1,
            );
            return { ...result, usedFallback: true };
          } catch (fbErr: any) {
            this.logLlmCall({
              caller: `${caller}:fallback`,
              model: fb,
              promptTokens: 0,
              completionTokens: 0,
              latencyMs: Date.now() - t0,
              success: false,
              error: AiTransportService.describeError(fbErr),
            });
            this.logger.warn(`结构化输出降级模型也失败：${AiTransportService.describeError(fbErr).slice(0, 120)}`);
            throw err;
          }
        }
        throw err;
      })
      .then(({ object, usage, usedFallback }) => {
        const tokens = this.usageTokens(usage);
        this.logLlmCall({
          caller: usedFallback ? `${caller}:fallback` : caller,
          model: usedFallback ? this.fallbackModel() : model,
          promptTokens: tokens.prompt,
          completionTokens: tokens.completion,
          latencyMs: Date.now() - t0,
          success: true,
        });
        return object as T;
      })
      .catch((err) => {
        const detail = AiTransportService.describeError(err);
        this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: detail });
        throw new HttpException(`AI 结构化输出失败: ${detail}`.slice(0, 600), HttpStatus.BAD_GATEWAY);
      });
  }

  /** 单模型结构化生成（p-limit + p-retry）；抽成方法便于单测替换与降级链复用。 */
  protected async generateStructuredWithRetry<T>(
    messages: ChatMessage[],
    schema: import('zod').core.$ZodType,
    schemaText: string,
    formatHint: string,
    opts: CompleteOptions,
    runModel: string,
    runCaller: string,
    retries: number,
  ): Promise<{ object: T; usage?: LanguageModelUsage; usedFallback?: boolean }> {
    return this.limit(async () =>
      pRetry(
        async () => {
          const { instructions, rest } = this.splitSystemMessages(this.withConfigAugmentation(messages, runCaller));
          const structuredInstructions = [instructions, formatHint].filter(Boolean).join('\n\n');
          try {
            const { object, usage } = await generateObject({
              model: this.buildModel(runModel),
              temperature: opts.temperature ?? 0.3,
              maxOutputTokens: opts.maxTokens ?? this.defaultMaxOutput(),
              abortSignal: AiTransportService.withTimeout(opts.signal),
              schema,
              schemaName: runCaller.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'structured_output',
              schemaDescription: '严格按给定 JSON Schema 返回对象；只输出 JSON。',
              instructions: structuredInstructions,
              messages: rest,
            });
            return { object: object as T, usage };
          } catch (err: any) {
            const name = String(err?.name || '');
            const recoverable =
              name === 'AI_NoObjectGeneratedError' ||
              name === 'AI_JSONParseError' ||
              name === 'AI_TypeValidationError' ||
              /JSON|schema|object/i.test(String(err?.message || ''));
            if (!recoverable) throw err;
            this.logger.warn(`结构化输出回退纯文本 JSON：${String(err?.message || err?.name || err).slice(0, 100)}`);
            const { text, usage } = await generateText({
              model: this.buildModel(runModel),
              temperature: opts.temperature ?? 0.3,
              maxOutputTokens: Math.max(opts.maxTokens ?? 0, 4096),
              abortSignal: AiTransportService.withTimeout(opts.signal),
              instructions: structuredInstructions,
              messages: [
                ...rest,
                {
                  role: 'user' as const,
                  content: '请严格按上面的 JSON Schema 输出。只返回一个 JSON 对象，不要任何解释或 Markdown。',
                },
              ],
            });
            let candidate = text.trim();
            // 兼容模型偶尔加的 ```json 围栏；jsonrepair 会处理其余近合法 JSON。
            candidate = candidate
              .replace(/^```(?:json)?\s*/i, '')
              .replace(/\s*```$/i, '')
              .trim();
            const firstBrace = candidate.indexOf('{');
            const lastBrace = candidate.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace) candidate = candidate.slice(firstBrace, lastBrace + 1);
            if (!candidate) throw new Error('结构化输出为空：模型未返回任何 JSON');
            const normalized = normalizeStructuredObject(JSON.parse(jsonrepair(candidate)), schemaText);
            const parsed = (schema as any).safeParse(normalized) as {
              success: boolean;
              data?: T;
              error?: { message: string };
            };
            if (!parsed.success) {
              const validationError = new Error(`结构化输出不符合 schema：${(parsed.error?.message || 'unknown').slice(0, 300)}`);
              (validationError as any).text = text.slice(0, 600);
              throw validationError;
            }
            return { object: parsed.data as T, usage };
          }
        },
        {
          retries,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 15_000,
          // 以前这里 throw err 会直接中止 pRetry，等于“配了重试但从不重试”；
          // 真实网关偶发空响应时，必须让退避重试真正发生。
          onFailedAttempt: (err) => {
            const attempt = (err as { attemptNumber?: number }).attemptNumber ?? 1;
            this.logger.warn(`结构化输出第 ${attempt} 次失败，准备退避重试：${AiTransportService.describeError(err).slice(0, 160)}`);
          },
        },
      ),
    );
  }

  /**
   * 把 AI SDK / 上游返回的异常压成一句人话。
   *
   * 为什么需要：AI SDK v7 的 generateObject 失败时抛的对象**没有 message**，
   * 直接 String(err) 会得到「[object Object]」——线上排障时等于零信息。
   * 这里按优先级取：message → text → responseBody → cause → name。
   */
  private static describeError(err: unknown): string {
    if (typeof err === 'string') return err.slice(0, 400);
    if (!err || typeof err !== 'object') return `未知错误(${String(err)})`;
    const e = err as Record<string, any>;
    const parts: string[] = [];
    if (e.name && e.name !== 'Error') parts.push(String(e.name));
    for (const key of ['message', 'text', 'responseBody', 'cause', 'data', 'statusCode']) {
      const v = e[key];
      if (v === undefined || v === null || v === '') continue;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      parts.push(s.slice(0, 400));
      if (key === 'message' || key === 'text') break;
    }
    // 兜底：AI SDK 抛的异常对象可能没有任何可识别字段，打印结构本身以便定位
    const own = Object.getOwnPropertyNames(e);
    parts.push(`keys=[${own.join(',')}]`);
    try {
      parts.push(JSON.stringify(e).slice(0, 300));
    } catch {
      /* 循环引用等无法序列化的情况忽略 */
    }
    const out = parts.join(' | ').trim();
    return out || '未知错误';
  }

  /** 非流式工具补全：generateText 跑完整工具循环，返回最终文本（供 /api/chat 非流式入口） */
  async completeWithTools(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    if (!opts.tools || !this.toolCalling) return this.complete(messages, opts);
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    try {
      return await this.limit(async () => {
        const { instructions, rest } = this.splitSystemMessages(this.withConfigAugmentation(messages, caller));
        const r = await generateText({
          model: this.buildModel(model, opts.signal),
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? this.defaultMaxOutput(),
          abortSignal: AiTransportService.withTimeout(opts.signal, AiTransportService.requestTimeoutMs() * Math.max(1, opts.maxSteps ?? 1)),
          instructions,
          messages: rest,
          tools: opts.tools,
          stopWhen: stepCountIs(opts.maxSteps && opts.maxSteps > 1 ? opts.maxSteps : 1),
        });
        // totalUsage 才是多步工具循环的累计值；r.usage 只反映最后一步。
        const usage = r.totalUsage ?? r.usage;
        const pt = usage?.inputTokens ?? 0;
        const ct = usage?.outputTokens ?? 0;
        this.logLlmCall({ caller, model, promptTokens: pt, completionTokens: ct, latencyMs: Date.now() - t0, success: true });
        try {
          opts.onUsage?.({ promptTokens: pt, completionTokens: ct, totalTokens: pt + ct });
        } catch {
          /* 记账失败不影响主流程 */
        }
        return r.text ?? '';
      });
    } catch (err: any) {
      this.logLlmCall({
        caller,
        model,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        error: err?.message,
      });
      throw new HttpException(`AI 工具调用失败: ${AiTransportService.describeError(err).slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * 流式补全：返回 OpenAI 兼容 SSE 文本流（供 sse.helper 转发）。
   *
   * 关键行为（2026-10 重写）：
   *  - 遍历 `fullStream` 而不是 `textStream`：后者只吐正文，会把推理增量与工具调用全部丢弃，
   *    导致前端「深度思考」开关与折叠面板永远拿不到内容。
   *  - reasoning 增量编码成 `delta.reasoning_content`（OpenAI 兼容语义），
   *    由 sse.helper 决定是否透传给客户端（forwardReasoning 开关）。
   *  - 工具调用以 `delta.tool_calls` 形式下发，供上层 Agent 循环消费。
   */
  async completeStream(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<ReadableStream<Uint8Array>> {
    this.assertConfigured();
    // 厂商能力为「不支持工具调用」时静默移除工具集：模型直接文本作答，而不是被上游 400 拒绝
    if (!this.toolCalling && opts.tools) opts = { ...opts, tools: undefined, maxSteps: undefined };
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    const selfLog = this.logLlmCall.bind(this);

    // 兼容性兜底：部分 OpenAI 兼容网关（实测 Qwen3.8-Flash-Next @ hcnsec）
    // 在 stream=true 时把工具调用写成正文文本（<tool_call><function=...>），只在非流式返回标准 tool_calls。
    //
    // 策略：默认仍走流式（保留增量体验）；只有**已知不支持流式工具**的端点才走非流式回退。
    // 判定依据是 provider 已知问题清单 + 显式环境开关，而不是「只要带 tools 就回退」——
    // 后者会让所有项目内对话退化成「全文生成完才一次性吐出」，与流式目标冲突。
    if (opts.tools && this.needsNonStreamTools()) {
      const viaNonStream = await this.completeWithToolsNonStream(messages, opts, model, caller, t0, selfLog);
      if (viaNonStream) return viaNonStream;
    }

    return this.streamPlain(messages, opts, model, caller, t0, selfLog);
  }

  /**
   * 该端点是否需要「非流式工具回退」。
   *  - `AI_TOOLS_NONSTREAM=on`   → 强制所有端点走非流式（保守兜底）
   *  - `AI_TOOLS_NONSTREAM=off`  → 强制全部走流式（调试用）
   *  - 未设置 → 命中已知问题主机清单才回退
   */
  private needsNonStreamTools(): boolean {
    const flag = (process.env.AI_TOOLS_NONSTREAM || '').trim().toLowerCase();
    if (flag === 'off' || flag === '0' || flag === 'false') return false;
    if (flag === 'on' || flag === '1' || flag === 'true') return true;
    // 已知把流式 tool_calls 写成正文文本的端点（实测）
    const known = (process.env.AI_TOOLS_NONSTREAM_HOSTS || 'hcnsec.cn')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const host = (() => {
      try {
        return new URL(this.baseUrl).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    return known.some((k) => host.includes(k));
  }

  /**
   * 工具模式的非流式回退：用 generateText + stopWhen 跑完整工具循环，
   * 把「推理 / 工具调用 / 最终文本」按 SSE 契约回放。
   * 仅在检测到上游流式不支持标准 tool_calls 时使用（一次性），避免所有请求都退化成非流式。
   */
  private async completeWithToolsNonStream(
    messages: ChatMessage[],
    opts: CompleteOptions,
    model: string,
    caller: string,
    t0: number,
    selfLog: AiTransportService['logLlmCall'],
  ): Promise<ReadableStream<Uint8Array> | null> {
    const { instructions, rest } = this.splitSystemMessages(this.withConfigAugmentation(messages, caller));
    const encoder = new TextEncoder();
    const useFallback = process.env.AI_TOOLS_NONSTREAM !== 'off';
    if (!useFallback) return null;
    // 先取出模型实例与输出上限（依赖 this，必须在构造 ReadableStream 之前取值——
    // ReadableStream 的 start 回调里 this 指向 UnderlyingSource，不是 service 实例）
    const streamModel = this.buildModel(model, opts.signal);
    const maxOut = opts.maxTokens ?? this.defaultMaxOutput();
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const r = await generateText({
            model: streamModel,
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: maxOut,
            // 工具回退是一次性完整生成（可能含多步工具循环），按步数放宽总时长；
            // 单步仍受限，避免整个循环被一个挂起步骤拖死。
            abortSignal: AiTransportService.withTimeout(
              opts.signal,
              AiTransportService.requestTimeoutMs() * Math.max(1, opts.maxSteps ?? 1),
            ),
            instructions,
            messages: rest,
            tools: opts.tools,
            stopWhen: stepCountIs(opts.maxSteps && opts.maxSteps > 1 ? opts.maxSteps : 1),
          });
          // 推理内容：AI SDK v7 的 r.reasoning 是数组（ReasoningPart[]），
          // 字符串在 r.reasoningText（r.reasoning 直接当字符串会得到 "[object Object]"）
          const reasoningText = r.reasoningText ?? '';
          if (reasoningText) enqueue({ choices: [{ delta: { reasoning_content: reasoningText }, index: 0 }] });
          // 工具调用回放（供前端/轨迹消费）
          for (const tc of r.toolCalls ?? []) {
            enqueue({
              choices: [
                {
                  delta: {
                    tool_calls: [{ id: tc.toolCallId, function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) } }],
                  },
                  index: 0,
                },
              ],
            });
          }
          // 工具结果回放：非流式 fallback 已跑完整个工具循环，结果已确定；
          // 这里没有逐工具的起止时间，duration_ms 传 0 表示"未知"，不要编一个总耗时。
          for (const tr of r.toolResults ?? []) {
            const payload = describeToolPayload(tr.output);
            enqueue({
              tool_result: {
                id: tr.toolCallId,
                name: tr.toolName,
                status: 'ok',
                duration_ms: 0,
                output: payload.text,
                output_chars: payload.chars,
              },
            });
          }
          // 最终文本
          const text = r.text ?? '';
          if (text) enqueue({ choices: [{ delta: { content: text }, index: 0 }] });
          const usage = r.totalUsage ?? r.usage;
          const pt = usage?.inputTokens ?? 0;
          const ct = usage?.outputTokens ?? 0;
          const total = pt + ct;
          enqueue({
            choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
            usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: total },
          });
          try {
            opts.onUsage?.({ promptTokens: pt, completionTokens: ct, totalTokens: total });
          } catch {
            /* 记账失败不影响主流程 */
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          selfLog({ caller, model, promptTokens: pt, completionTokens: ct, latencyMs: Date.now() - t0, success: true });
        } catch (err: any) {
          selfLog({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
          if (!opts.signal?.aborted) enqueue({ error: String(err?.message || err) });
        } finally {
          controller.close();
        }
      },
    });
    return sse;
  }

  /** 纯流式路径（无工具，或上游支持标准 tool_calls 时） */
  private async streamPlain(
    messages: ChatMessage[],
    opts: CompleteOptions,
    model: string,
    caller: string,
    t0: number,
    selfLog: AiTransportService['logLlmCall'],
  ): Promise<ReadableStream<Uint8Array>> {
    return this.limit(async () => {
      const { instructions, rest } = this.splitSystemMessages(this.withConfigAugmentation(messages, caller));
      // 流式用「空闲看门狗」而不是总时长：正常长文流可以跑几分钟，
      // 但上游一旦停止出包（挂起/半死连接）必须及时中止，否则流水线永久卡 running。
      const idle = new AbortController();
      const idleMs = AiTransportService.requestTimeoutMs();
      let idleTimer: NodeJS.Timeout | undefined;
      const armIdle = () => {
        if (idleMs <= 0) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idle.abort(new Error(`AI 流式空闲超时（${idleMs}ms 无数据）`)), idleMs);
        idleTimer.unref?.();
      };
      armIdle();
      const result = streamText({
        model: this.buildModel(model, opts.signal),
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? this.defaultMaxOutput(),
        abortSignal: AiTransportService.withTimeout(idle.signal, idleMs),
        instructions,
        messages: rest,
        // AI SDK v7 用 stopWhen: stepCountIs(n) 控制多步工具循环（v6 的 maxSteps 已移除且会被静默忽略）
        ...(opts.tools ? { tools: opts.tools, stopWhen: stepCountIs(opts.maxSteps && opts.maxSteps > 1 ? opts.maxSteps : 1) } : {}),
      });
      const encoder = new TextEncoder();
      const sse = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueue = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          /** 记录每个 toolCall 的起始时间，tool-result 到达时算出真实耗时 */
          const toolStartedAt = new Map<string, number>();
          try {
            for await (const part of result.stream) {
              armIdle();
              switch (part.type) {
                case 'text-delta': {
                  const text = part.text ?? '';
                  if (text) enqueue({ choices: [{ delta: { content: text }, index: 0 }] });
                  break;
                }
                case 'reasoning-delta': {
                  const text = part.text ?? '';
                  if (text) enqueue({ choices: [{ delta: { reasoning_content: text }, index: 0 }] });
                  break;
                }
                case 'tool-call': {
                  toolStartedAt.set(part.toolCallId, Date.now());
                  enqueue({
                    choices: [
                      {
                        delta: {
                          tool_calls: [
                            { id: part.toolCallId, function: { name: part.toolName, arguments: JSON.stringify(part.input ?? {}) } },
                          ],
                        },
                        index: 0,
                      },
                    ],
                  });
                  break;
                }
                case 'tool-result': {
                  const payload = describeToolPayload(part.output);
                  const started = toolStartedAt.get(part.toolCallId);
                  enqueue({
                    tool_result: {
                      id: part.toolCallId,
                      name: part.toolName,
                      status: 'ok',
                      duration_ms: started ? Date.now() - started : 0,
                      output: payload.text,
                      output_chars: payload.chars,
                    },
                  });
                  break;
                }
                case 'tool-error': {
                  const payload = describeToolPayload(part.error);
                  const started = toolStartedAt.get(part.toolCallId);
                  enqueue({
                    tool_result: {
                      id: part.toolCallId,
                      name: part.toolName,
                      status: 'error',
                      duration_ms: started ? Date.now() - started : 0,
                      error: payload.text,
                      output_chars: payload.chars,
                    },
                  });
                  break;
                }
                case 'tool-output-denied': {
                  const started = toolStartedAt.get(part.toolCallId);
                  enqueue({
                    tool_result: {
                      id: part.toolCallId,
                      name: part.toolName,
                      status: 'denied',
                      duration_ms: started ? Date.now() - started : 0,
                      error: '工具输出被拒绝',
                    },
                  });
                  break;
                }
                case 'error': {
                  enqueue({ error: String((part as { error?: unknown }).error ?? '模型流式输出异常') });
                  break;
                }
                default:
                  break;
              }
            }
            // 多步工具循环必须用 totalUsage 累计，result.usage 只是最后一步。
            const usage = await result.totalUsage;
            const pt = usage?.inputTokens ?? 0;
            const ct = usage?.outputTokens ?? 0;
            const total = pt + ct;
            enqueue({
              choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: pt,
                completion_tokens: ct,
                total_tokens: total,
              },
            });
            try {
              opts.onUsage?.({ promptTokens: pt, completionTokens: ct, totalTokens: total });
            } catch {
              /* 记账失败不影响流 */
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            selfLog({
              caller,
              model,
              promptTokens: usage?.inputTokens ?? 0,
              completionTokens: usage?.outputTokens ?? 0,
              latencyMs: Date.now() - t0,
              success: true,
            });
          } catch (err: any) {
            selfLog({
              caller,
              model,
              promptTokens: 0,
              completionTokens: 0,
              latencyMs: Date.now() - t0,
              success: false,
              error: err?.message,
            });
            if (!opts.signal?.aborted) enqueue({ error: String(err?.message || err) });
          } finally {
            if (idleTimer) clearTimeout(idleTimer);
            controller.close();
          }
        },
      });
      return sse;
    });
  }

  /** 查询可用模型列表（协议感知；与设置页「检测模型」共用 model-catalog 单一实现） */
  async listModels(): Promise<string[]> {
    this.assertConfigured();
    const r = await fetchModelCatalog({
      baseUrl: this.baseUrl,
      apiKey: this._secretKey,
      protocol: this.protocol,
      timeoutMs: 15_000,
      fetchImpl: safeOutboundFetch as unknown as typeof fetch,
    });
    if (!r.ok) return [];
    return r.models.map((m) => m.id).slice(0, 50);
  }

  /** 用「尚未保存的表单配置」做连接测试：不改当前激活厂商、不落库 */
  async testProviderConfig(cfg: {
    baseUrl: string;
    apiKey?: string;
    protocol?: string;
    model: string;
    maxOutput?: number;
  }): Promise<{ ok: boolean; reply: string; model: string; latencyMs: number }> {
    const target = String(cfg.model || '').trim();
    const t0 = Date.now();
    try {
      const { text } = await generateText({
        model: this.buildModelWith(cfg.protocol || 'openai-compatible', cfg.baseUrl, cfg.apiKey || '', target),
        temperature: 0,
        maxOutputTokens: Math.min(512, Math.max(16, Number(cfg.maxOutput) || 512)),
        abortSignal: AbortSignal.timeout(60_000),
        messages: [{ role: 'user', content: '请只回复两个字：正常' }],
      });
      return { ok: true, reply: text.trim() || '（空回复）', model: target, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      const msg = String(e?.message || e);
      const friendly = /401|403|invalid api key|unauthorized|authentication/i.test(msg)
        ? `鉴权失败：Key 或协议不匹配（${msg.slice(0, 160)}）`
        : /404|not found|model_not_found/i.test(msg)
          ? `模型或端点不存在：${msg.slice(0, 160)}`
          : /abort|timeout|timed out/i.test(msg)
            ? '连接超时：端点无响应'
            : msg.slice(0, 300);
      return { ok: false, reply: friendly, model: target, latencyMs: Date.now() - t0 };
    }
  }

  /** 连接测试：发一条最小消息验证 Key/端点/模型 */
  async testConnection(model?: string): Promise<{ ok: boolean; reply: string; model: string; latencyMs: number }> {
    this.assertConfigured();
    const target = model || this.fastModel;
    const t0 = Date.now();
    try {
      const { text } = await generateText({
        model: this.buildModel(target),
        temperature: 0,
        maxOutputTokens: 512,
        abortSignal: AiTransportService.withTimeout(undefined),
        messages: [{ role: 'user', content: '请只回复两个字：正常' }],
      });
      const reply = text.trim() || '（空回复）';
      return { ok: true, reply, model: target, latencyMs: Date.now() - t0 };
    } catch (e: any) {
      return { ok: false, reply: e.message || String(e), model: target, latencyMs: Date.now() - t0 };
    }
  }

  // ----------------------------------------------------------------- //
  //  initialisation helpers (protected so subclasses can hook)     //
  // ----------------------------------------------------------------- //

  /** 从 model_provider 表读取激活厂商并覆盖连接配置（LiteLLM 式多厂商切换） */
  protected applyActiveProvider(): void {
    this.mockConnectionActive = false;
    this.setApiKey('');
    try {
      const row = sqlite.prepare('SELECT * FROM model_provider WHERE is_active = 1 LIMIT 1').get() as
        { base_url?: string; ['api_key']?: string; model?: string } | undefined;
      if (row) {
        if (row.base_url && row.model) {
          this.baseUrl = String(row.base_url).replace(/\/$/, '');
          this.setApiKey(row['api_key'] ? normalizeApiKey(decryptSecret(String(row['api_key']))) : '');
          this.fastModel = String(row.model);
          this.strongModel = String(row.model);
          this.applyProviderCapabilities(row as Record<string, unknown>);
        }
      } else {
        this.setApiKey(normalizeApiKey(process.env.AI_API_KEY || ''));
      }
    } catch {
      this.setApiKey(normalizeApiKey(process.env.AI_API_KEY || ''));
    }
  }
}
