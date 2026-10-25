import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pRetry from 'p-retry';
import pLimit from 'p-limit';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, generateObject, streamText, stepCountIs, jsonSchema as aiJsonSchema, type ModelMessage, type LanguageModelUsage } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { decryptSecret } from '../../db/src/secret-crypto';
import { sqlite } from '../../db/src/database';
import { db } from '../../db/src/database';
import { llmCallLogs, customPrompts } from '../../db/src/schema';
import { eq } from 'drizzle-orm';
import { envInt } from '../../core/src/env';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  private _secretKey = process.env.AI_API_KEY || '';
  /** fast 档：轻量快速模型（默认） */
  protected fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '';
  /** strong 档：强模型（高难任务；未配置则回落 fast） */
  protected strongModel = process.env.AI_MODEL_STRONG || this.fastModel;

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
    this._secretKey = v;
  }

  /** 切换激活厂商（设置页调用，立即生效） */
  switchProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as
      | { base_url?: string; ['api_key']?: string; model?: string }
      | undefined;
    if (!row) throw new HttpException('模型厂商不存在', HttpStatus.NOT_FOUND);
    this.baseUrl = String(row.base_url).replace(/\/$/, '');
    if (row['api_key']) this.setApiKey(decryptSecret(String(row['api_key'])));
    this.fastModel = String(row.model);
    this.strongModel = String(row.model);
    sqlite.prepare('UPDATE model_provider SET is_active = 0 WHERE is_active = 1').run();
    sqlite.prepare('UPDATE model_provider SET is_active = 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  /** 回退到环境变量配置（删除激活中的厂商时调用，避免内存残留失效厂商） */
  resetToEnv() {
    this.baseUrl = (process.env.AI_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    this.setApiKey(process.env.AI_API_KEY || '');
    this.fastModel = process.env.AI_MODEL_FAST || process.env.AI_MODEL || '';
    this.strongModel = process.env.AI_MODEL_STRONG || this.fastModel;
  }

  /** 是否已配置 AI：仅当确有可用密钥时为 true（不再对未配置状态谎报可用） */
  get configured(): boolean {
    return !!this.apiKey;
  }

  get config(): { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean } {
    return { baseUrl: this.baseUrl, model: this.fastModel, fastModel: this.fastModel, strongModel: this.strongModel, configured: this.configured };
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

  protected resolveModel(opts: CompleteOptions): string {
    if (opts.modelName) return opts.modelName;
    return opts.model === 'strong' ? this.strongModel : this.fastModel;
  }

  protected assertConfigured(): void {
    if (!this.apiKey) {
      throw new HttpException(
        'AI 服务未配置：请在 apps/server/.env 中设置 AI_API_KEY（支持 OpenAI、DeepSeek、通义等 OpenAI 兼容接口）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
  protected logLlmCall(opts: { caller: string; model: string; promptTokens: number; completionTokens: number; latencyMs: number; success: boolean; error?: string }): void {
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
    const rest = messages.filter((m) => m.role !== 'system') as unknown as ModelMessage[];
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

  /** AI SDK usage（对象/数值两种版本兼容）→ 平铺 token 数 */  private usageTokens(usage: LanguageModelUsage | undefined): { prompt: number; completion: number } {
    if (!usage) return { prompt: 0, completion: 0 };
    const num = (v: unknown): number => (typeof v === 'number' ? v : typeof (v as { total?: unknown })?.total === 'number' ? (v as { total: number }).total : 0);
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
    const provider = createOpenAICompatible({
      name: 'sciflow',
      baseURL: this.baseUrl,
      apiKey: this._secretKey,
      headers: { Authorization: `Bearer ${this._secretKey}` },
      supportsStructuredOutputs: true,
    });
    return provider(modelId);
  }

  /** 非 stream_options.include_usage 兼容探测：某些网关拒绝该参数（保留容错语义由 AI SDK headers/参数层处理） */

  /** 非流式补全（p-limit 限流 + p-retry 指数退避重试 + token 成本追踪） */
  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<string> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';

    return this.limit(async () =>
      pRetry(
        async () => {
          const { instructions, rest } = this.splitSystemMessages(messages);
          const callArgs = {
            model: this.buildModel(model),
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxTokens ?? 4096,
            abortSignal: AiTransportService.withTimeout(opts.signal),
            instructions,
            messages: rest,
          };
          if (opts.jsonSchema) {
            // 结构化路径：走 generateObject（v7 中 response_format json_schema 仅由它下发）
            const { object, usage } = await generateObject({
              ...callArgs,
              schema: aiJsonSchema(opts.jsonSchema.schema),
            });
            const text = JSON.stringify(object);
            if (!text.trim()) throw new AiEmptyResponseError();
            return { text, usage };
          }
          const { text, usage } = await generateText(callArgs);
          if (!text.trim()) throw new AiEmptyResponseError();
          return { text, usage };
        },
        {
          retries: 4,
          factor: 2,
          minTimeout: 2000,
          maxTimeout: 60_000,
          onFailedAttempt: (err) => {
            if (!AiTransportService.isRetriableLimit(err) && !(err instanceof AiEmptyResponseError)) throw err;
            this.logger.warn(`AI 调用重试：第 ${err.attemptNumber} 次失败，剩余 ${err.retriesLeft} 次（${String((err as { message?: string }).message || '').slice(0, 80)}）`);
          },
        },
      ),
    ).then(({ text, usage }) => {
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
    }).catch((err) => {
      this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
      if (err instanceof HttpException) throw err;
      if (err instanceof AiEmptyResponseError) {
        throw new HttpException('AI 返回空响应：模型未产出任何内容（已自动重试 4 次），请更换模型或稍后重试', HttpStatus.BAD_GATEWAY);
      }
      if (AiTransportService.isRetriableLimit(err)) throw new HttpException('AI 限流 (429)：上游速率限制，请降低 AI_RPM_CAP 或升级模型配额', 429);
      const timeoutMs = AiTransportService.requestTimeoutMs();
      if (AiTransportService.isTimeoutError(err, t0, timeoutMs)) {
        throw new HttpException(`AI 请求超时（${Math.round(timeoutMs / 1000)}s 无响应，可通过 AI_REQUEST_TIMEOUT_MS 调整）：上游端点无响应，任务已中止以免永久挂起`, HttpStatus.GATEWAY_TIMEOUT);
      }
      throw new HttpException(`AI 服务调用失败: ${String(err?.message || err).slice(0, 300)}`, HttpStatus.BAD_GATEWAY);
    });
  }

  /** 结构化补全：zod schema 强约束输出（约束工程主路径，替代手写 JSON 抠取） */
  async completeStructured<T>(messages: ChatMessage[], schema: import('zod').core.$ZodType, opts: CompleteOptions = {}): Promise<T> {
    this.assertConfigured();
    const t0 = Date.now();
    const model = this.resolveModel(opts);
    const caller = opts.context || 'general';
    return this.limit(async () =>
      pRetry(
        async () => {
          const { instructions, rest } = this.splitSystemMessages(messages);
          const { object, usage } = await generateObject({
            model: this.buildModel(model),
            temperature: opts.temperature ?? 0.3,
            maxOutputTokens: opts.maxTokens ?? 4096,
            abortSignal: AiTransportService.withTimeout(opts.signal),
            schema,
            instructions,
            messages: rest,
          });
          return { object: object as T, usage };
        },
        { retries: 2, factor: 2, minTimeout: 1000, maxTimeout: 15_000, onFailedAttempt: (err) => { throw err; } },
      ),
    ).then(({ object, usage }) => {
      const tokens = this.usageTokens(usage);
      this.logLlmCall({ caller, model, promptTokens: tokens.prompt, completionTokens: tokens.completion, latencyMs: Date.now() - t0, success: true });
      return object;
    }).catch((err) => {
      this.logLlmCall({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
      throw new HttpException(`AI 结构化输出失败: ${String(err?.message || err).slice(0, 200)}`, HttpStatus.BAD_GATEWAY);
    });
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
    const { instructions, rest } = this.splitSystemMessages(messages);
    const encoder = new TextEncoder();
    const useFallback = process.env.AI_TOOLS_NONSTREAM !== 'off';
    if (!useFallback) return null;
    // 先取出模型实例（buildModel 依赖 this，必须在构造 ReadableStream 之前调用一次）
    const streamModel = this.buildModel(model, opts.signal);
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const r = await generateText({
            model: streamModel,
            temperature: opts.temperature ?? 0.7,
            maxOutputTokens: opts.maxTokens ?? 4096,
            // 工具回退是一次性完整生成（可能含多步工具循环），按步数放宽总时长；
            // 单步仍受限，避免整个循环被一个挂起步骤拖死。
            abortSignal: AiTransportService.withTimeout(opts.signal, AiTransportService.requestTimeoutMs() * Math.max(1, opts.maxSteps ?? 1)),
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
            enqueue({ choices: [{ delta: { tool_calls: [{ id: tc.toolCallId, function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) } }] }, index: 0 }] });
          }
          // 最终文本
          const text = r.text ?? '';
          if (text) enqueue({ choices: [{ delta: { content: text }, index: 0 }] });
          const usage = r.usage;
          const pt = usage?.inputTokens ?? 0;
          const ct = usage?.outputTokens ?? 0;
          enqueue({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct } });
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
      const { instructions, rest } = this.splitSystemMessages(messages);
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
        maxOutputTokens: opts.maxTokens ?? 4096,
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
                  enqueue({
                    choices: [
                      {
                        delta: {
                          tool_calls: [{ id: part.toolCallId, function: { name: part.toolName, arguments: JSON.stringify(part.input ?? {}) } }],
                        },
                        index: 0,
                      },
                    ],
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
            const usage = await result.usage;
            enqueue({
              choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
              usage: {
                prompt_tokens: usage?.inputTokens ?? 0,
                completion_tokens: usage?.outputTokens ?? 0,
                total_tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
              },
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            selfLog({ caller, model, promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, latencyMs: Date.now() - t0, success: true });
          } catch (err: any) {
            selfLog({ caller, model, promptTokens: 0, completionTokens: 0, latencyMs: Date.now() - t0, success: false, error: err?.message });
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

  /** 查询可用模型列表（OpenAI 兼容 /models；openai-compatible v4 未暴露列表方法，保留 fetch） */
  async listModels(): Promise<string[]> {
    this.assertConfigured();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this._secretKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id?: string } | null> };
      const ids: string[] = (data.data || []).filter((m): m is { id?: string } => !!m).map((m) => m.id).filter((id): id is string => !!id && !id.includes('image') && !id.includes('video'));
      return ids.slice(0, 20);
    } catch {
      return [];
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
    try {
      const row = sqlite
        .prepare('SELECT * FROM model_provider WHERE is_active = 1 LIMIT 1')
        .get() as { base_url?: string; ['api_key']?: string; model?: string } | undefined;
      if (row?.base_url && row?.model) {
        this.baseUrl = String(row.base_url).replace(/\/$/, '');
        if (row['api_key']) this.setApiKey(decryptSecret(String(row['api_key'])));
        this.fastModel = String(row.model);
        this.strongModel = String(row.model);
      }
    } catch {
      /* 表不存在时回退环境变量 */
    }
  }
}
