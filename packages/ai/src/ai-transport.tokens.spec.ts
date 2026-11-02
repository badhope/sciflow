import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../../db/src/database';
import { llmCallLogs } from '../../db/src/schema';
import { AiTransportService, normalizeApiKey } from './ai-transport.service';
import { encryptSecret } from '../../db/src/secret-crypto';
import { AiService } from './ai.service';
import { stopMockGateway } from './mock-gateway';

/**
 * token 打点隔离：`lastTotalTokens` 是实例级单值，pipeline 的 trackBudget 却在
 * 「多个分章起草并行完成」后逐个读取它 —— 读到的永远是最后一个完成的调用，
 * 并发起草（AI_DRAFT_CONCURRENCY=3）时预算被系统性低估（漏计），
 * 多任务并行时还会把 A 任务的 token 记到 B 头上（串账）。
 *
 * 修复：除全局值外维护 per-caller 最近值，pipeline 用固定 caller 读取。
 */
const C1 = 'unit-test-caller-1';
const C2 = 'unit-test-caller-2';

/** 直接走 transport 的真实落库路径（protected logLlmCall 通过子类暴露） */
class TestableTransport extends AiTransportService {
  record(caller: string, prompt: number, completion: number): void {
    this.logLlmCall({ caller, model: 'test-model', promptTokens: prompt, completionTokens: completion, latencyMs: 1, success: true });
  }
}

describe('LLM token 打点隔离', () => {
  const cleanup = () => db.delete(llmCallLogs).where(eq(llmCallLogs.caller, C1)).run();
  afterEach(() => {
    cleanup();
    db.delete(llmCallLogs).where(eq(llmCallLogs.caller, C2)).run();
  });

  it('按 caller 读取最近一次 token 合计，互不覆盖（并发起草不再串账）', () => {
    const svc = new TestableTransport();
    svc.record(C1, 100, 50);
    svc.record(C2, 7, 3);
    expect(svc.lastTokensFor(C1)).toBe(150);
    expect(svc.lastTokensFor(C2)).toBe(10);
    // 全局值保留最后一条（旧调用方兼容）
    expect(svc.lastTotalTokens).toBe(10);
  });

  it('未调用过的 caller 返回 0（不乱报别人的 token）', () => {
    const svc = new TestableTransport();
    svc.record(C2, 99, 1);
    expect(svc.lastTokensFor(C1)).toBe(0);
  });

  it('同一 caller 多次调用取最近一次', () => {
    const svc = new TestableTransport();
    svc.record(C1, 10, 10);
    svc.record(C1, 20, 20);
    expect(svc.lastTokensFor(C1)).toBe(40);
  });
});

class InspectableTransport extends AiTransportService {
  get currentKey(): string {
    return this.apiKey;
  }

  set currentKey(value: string) {
    this.setApiKey(value);
  }

  reloadActiveProvider(): void {
    this.applyActiveProvider();
  }

  configureConnection(baseUrl: string, model: string): void {
    this.baseUrl = baseUrl;
    this.fastModel = model;
  }
}

function cleanupTransportProviders(): void {
  sqlite.prepare("DELETE FROM model_provider WHERE name LIKE 'transport-spec-%'").run();
}

function insertTransportProvider(input: { name: string; key?: string; active?: boolean }): string {
  if (input.active) sqlite.prepare('UPDATE model_provider SET is_active = 0').run();
  const id = randomUUID();
  const now = Date.now();
  sqlite.prepare(
    'INSERT INTO model_provider (id, name, base_url, api_key, model, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, input.name, 'https://provider.example.test/v1', input.key ? encryptSecret(input.key) : '', 'transport-model', input.active ? 1 : 0, now, now);
  return id;
}

describe('AI provider key 生命周期', () => {
  const previousEnvKey = process.env.AI_API_KEY;
  let activeProviderIdsBeforeTest: string[] = [];

  beforeEach(() => {
    activeProviderIdsBeforeTest = (sqlite.prepare('SELECT id FROM model_provider WHERE is_active = 1').all() as Array<{ id: string }>).map((row) => row.id);
    cleanupTransportProviders();
    delete process.env.AI_API_KEY;
  });

  afterEach(() => {
    cleanupTransportProviders();
    sqlite.prepare('UPDATE model_provider SET is_active = 0').run();
    for (const id of activeProviderIdsBeforeTest) sqlite.prepare('UPDATE model_provider SET is_active = 1 WHERE id = ?').run(id);
    if (previousEnvKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousEnvKey;
  });

  it('空值与模板值 fail-closed，正常值保留', () => {
    expect(normalizeApiKey('')).toBe('');
    expect(normalizeApiKey('sk-your-api-key-here')).toBe('');
    expect(normalizeApiKey('${AI_API_KEY}')).toBe('');
    expect(normalizeApiKey('provider-key-a')).toBe('provider-key-a');
    expect(normalizeApiKey('sk-test')).toBe('sk-test');
    expect(normalizeApiKey('demo-actual-value')).toBe('demo-actual-value');
  });

  it('configured 和请求入口要求有效 HTTP 地址、模型和 key', async () => {
    const svc = new InspectableTransport();
    svc.currentKey = 'fixture-value';
    for (const [url, model] of [['not-a-url', 'model'], ['file:///tmp/model', 'model'], ['https://example.com/v1', '   ']]) {
      svc.configureConnection(url, model);
      expect(svc.configured).toBe(false);
      await expect(svc.complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 503 });
    }
    svc.configureConnection('https://example.com/v1', 'model');
    expect(svc.configured).toBe(true);
  });

  it('mock 状态启用后可实际调用，切换真实 provider 后失效', async () => {
    const previous = process.env.AI_MOCK;
    process.env.AI_MOCK = '1';
    try {
      const svc = new AiService();
      expect(svc.configured).toBe(true);
      expect(svc.config.mock).toBe(true);
      expect(await svc.chat('你好')).toBeTruthy();
      const id = insertTransportProvider({ name: 'transport-spec-mock-switch' });
      svc.switchProvider(id);
      expect(svc.configured).toBe(false);
      expect(svc.config.mock).toBe(false);
    } finally {
      stopMockGateway();
      if (previous === undefined) delete process.env.AI_MOCK;
      else process.env.AI_MOCK = previous;
    }
  });

  it('切换到无 key provider 时无条件清空旧运行时 key', () => {
    const id = insertTransportProvider({ name: 'transport-spec-empty', active: false });
    const svc = new InspectableTransport();
    svc.currentKey = 'runtime-key-a';

    svc.switchProvider(id);

    expect(svc.currentKey).toBe('');
    expect(svc.config.configured).toBe(false);
  });

  it('启动加载 provider 时用 provider key 替换环境 key，空 provider key 不继承环境 key', () => {
    process.env.AI_API_KEY = 'environment-key-a';
    insertTransportProvider({ name: 'transport-spec-active-empty', active: true });
    const emptyProvider = new InspectableTransport();
    expect(emptyProvider.currentKey).toBe('');

    cleanupTransportProviders();
    process.env.AI_API_KEY = 'environment-key-b';
    insertTransportProvider({ name: 'transport-spec-active-value', key: 'provider-key-b', active: true });
    const configuredProvider = new InspectableTransport();
    expect(configuredProvider.currentKey).toBe('provider-key-b');
  });

  it('重新加载 active provider 前先清空旧 key', () => {
    const id = insertTransportProvider({ name: 'transport-spec-reload', active: true });
    const svc = new InspectableTransport();
    svc.currentKey = 'runtime-key-c';
    sqlite.prepare('UPDATE model_provider SET api_key = ? WHERE id = ?').run('', id);

    svc.reloadActiveProvider();

    expect(svc.currentKey).toBe('');
  });
});
