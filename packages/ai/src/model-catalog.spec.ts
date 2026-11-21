import { describe, expect, it } from 'vitest';
import {
  fetchModelCatalog,
  isChatModelId,
  normalizeProtocol,
  parseAnthropicCatalog,
  parseCatalog,
  parseGoogleCatalog,
  parseOllamaShowCapabilities,
  parseOpenAICompatibleCatalog,
} from './model-catalog';

/**
 * 模型目录发现（设置页「地址 + Key → 自动检测模型」）契约：
 * - 三种主流协议各自解析，元数据（上下文 / 最大输出）尽量从网关读取
 * - 嵌入 / 语音 / 图像等非聊天模型不得进入可选列表
 * - 失败返回可读原因而不是抛错（设置页要能原地展示）
 */

describe('parseOpenAICompatibleCatalog', () => {
  it('读取 id 与网关上报的上下文/输出元数据，并保留厂商', () => {
    const models = parseOpenAICompatibleCatalog({
      data: [
        { id: 'u2-flash', owned_by: 'unisound', context_window: 1048576, max_output: 131072 },
        { id: 'glm-5.3', context_length: '202000', max_output_tokens: 16000 },
      ],
    });
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: 'u2-flash', contextWindow: 1048576, maxOutput: 131072, ownedBy: 'unisound', toolCalling: true });
    expect(models[1]).toMatchObject({ id: 'glm-5.3', contextWindow: 202000, maxOutput: 16000 });
  });

  it('过滤嵌入式/语音/图像等非聊天模型', () => {
    const models = parseOpenAICompatibleCatalog({
      data: [
        { id: 'text-embedding-3-large' },
        { id: 'whisper-1' },
        { id: 'dall-e-3' },
        { id: 'qwen-plus' },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(['qwen-plus']);
  });

  it('畸形载荷返回空数组而不是崩溃', () => {
    for (const raw of [null, undefined, {}, { data: 'x' }, { data: [null, 1, { id: 42 }] }]) {
      expect(parseOpenAICompatibleCatalog(raw)).toEqual([]);
    }
  });
});

describe('parseAnthropicCatalog / parseGoogleCatalog', () => {
  it('Anthropic 读取 data[].id 与 display_name', () => {
    const models = parseAnthropicCatalog({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] });
    expect(models[0]).toMatchObject({ id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', toolCalling: true });
  });

  it('Google 去掉 models/ 前缀并读取 input/outputTokenLimit，只保留 generateContent 模型', () => {
    const models = parseGoogleCatalog({
      models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ id: 'gemini-2.5-pro', contextWindow: 1048576, maxOutput: 65536 });
  });
});

describe('normalizeProtocol / isChatModelId / parseCatalog', () => {
  it('未知协议回落到 openai-compatible', () => {
    expect(normalizeProtocol()).toBe('openai-compatible');
    expect(normalizeProtocol('whatever')).toBe('openai-compatible');
    expect(normalizeProtocol('google-gemini')).toBe('google-gemini');
  });

  it('parseCatalog 按协议分派', () => {
    expect(parseCatalog('anthropic-messages', { data: [{ id: 'claude-x' }] })[0].id).toBe('claude-x');
    expect(parseCatalog('google-gemini', { models: [{ name: 'models/gemini-x', supportedGenerationMethods: ['generateContent'] }] })[0].id).toBe('gemini-x');
  });

  it('模型名判定不误伤正常聊天模型', () => {
    expect(isChatModelId('u2-flash')).toBe(true);
    expect(isChatModelId('deepseek-v4.1-flash')).toBe(true);
    expect(isChatModelId('text-embedding-3-large')).toBe(false);
    expect(isChatModelId('')).toBe(false);
  });
});

describe('parseOllamaShowCapabilities / fetchModelCatalog', () => {
  it('Ollama 优先读取运行时 num_ctx，并识别最大输出', () => {
    expect(parseOllamaShowCapabilities({
      parameters: 'num_ctx 16384\nnum_predict 2048',
      model_info: { 'llama.context_length': 131072 },
    })).toEqual({ contextWindow: 16384, maxOutput: 2048 });
    expect(parseOllamaShowCapabilities({ model_info: { 'llama.context_length': '131072' } }))
      .toEqual({ contextWindow: 131072, maxOutput: undefined });
    expect(parseOllamaShowCapabilities({ parameters: 'stop <eos>' })).toEqual({ contextWindow: undefined, maxOutput: undefined });
  });

  it('本机 Ollama 目录会用 /api/show 补齐上下文与输出能力', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      if (String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'sciflow-test-minicpm5-2b:latest' }] }), { status: 200 });
      }
      if (String(url).endsWith('/api/version')) {
        return new Response(JSON.stringify({ version: '0.12.0' }), { status: 200 });
      }
      if (String(url).endsWith('/api/show')) {
        return new Response(JSON.stringify({ parameters: 'num_ctx 16384', model_info: { 'llama.context_length': 131072 } }), { status: 200 });
      }
      return new Response('no', { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const r = await fetchModelCatalog({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama', protocol: 'openai-compatible' });
      expect(r.ok).toBe(true);
      expect(r.models[0]).toMatchObject({ id: 'sciflow-test-minicpm5-2b:latest', contextWindow: 16384 });
      expect(calls).toEqual([
        'http://127.0.0.1:11434/v1/models',
        'http://127.0.0.1:11434/api/version',
        'http://127.0.0.1:11434/api/show',
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('按协议拼接 /models 并带对应鉴权头', async () => {
    const original = globalThis.fetch;
    const calls: { url: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: (init.headers || {}) as Record<string, string> });
      return new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const r = await fetchModelCatalog({ baseUrl: 'https://example.invalid/v1/', apiKey: 'k1', protocol: 'openai-compatible' });
      expect(r.ok).toBe(true);
      expect(r.models[0].id).toBe('m1');
      expect(calls[0].url).toBe('https://example.invalid/v1/models');
      expect(calls[0].headers.Authorization).toBe('Bearer k1');

      await fetchModelCatalog({ baseUrl: 'https://example.invalid/v1', apiKey: 'k2', protocol: 'anthropic-messages' });
      expect(calls[1].headers['x-api-key']).toBe('k2');
      expect(calls[1].headers['anthropic-version']).toBeTruthy();

      await fetchModelCatalog({ baseUrl: 'https://example.invalid/v1beta', apiKey: 'k3', protocol: 'google-gemini' });
      expect(calls[2].headers['x-goog-api-key']).toBe('k3');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('非 2xx 返回 ok=false 且带状态与可读原因', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch;
    try {
      const r = await fetchModelCatalog({ baseUrl: 'https://example.invalid/v1', apiKey: 'bad' });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(401);
      expect(r.error).toContain('401');
    } finally {
      globalThis.fetch = original;
    }
  });
});
