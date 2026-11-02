import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sqlite } from '../db/database';
import { SettingsService } from './settings.service';
import type { AiService } from '../ai/ai.service';

/**
 * 厂商设置（设置页自定义连接）契约：
 * - 协议 / 上下文窗口 / 最大输出 / 工具调用 必须落库并回显
 * - 更新激活中的厂商后，运行中的 AI 连接参数必须同步刷新（否则页面显示新模型、实际还在打旧模型）
 * - 检测模型与连接测试接收「未保存的表单值」；掩码回显时复用库内真实 Key，绝不把掩码当 Key
 * - 用户填的地址先过 SSRF 守卫（内网/元数据地址默认拒绝）
 */

function fakeAi(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: { switched: string[]; tested: unknown[] } = { switched: [], tested: [] };
  const ai = {
    config: { baseUrl: 'https://env.invalid/v1', model: 'env-model', fastModel: 'env-model', strongModel: 'env-model', configured: true, protocol: 'openai-compatible', contextWindow: 0, maxOutput: 0, toolCalling: true },
    listModels: vi.fn(async () => ['env-model']),
    testConnection: vi.fn(async () => ({ ok: true, reply: '正常', model: 'env-model', latencyMs: 1 })),
    testProviderConfig: vi.fn(async (cfg: unknown) => {
      calls.tested.push(cfg);
      return { ok: true, reply: '正常', model: (cfg as { model: string }).model, latencyMs: 12 };
    }),
    switchProvider: vi.fn((id: string) => calls.switched.push(id)),
    resetToEnv: vi.fn(),
    getCustomPrompt: vi.fn(() => null),
    ...overrides,
  };
  return { ai: ai as unknown as AiService, raw: ai, calls };
}

function cleanup() {
  sqlite.prepare(`DELETE FROM model_provider WHERE name LIKE 'spec-%'`).run();
}

/** 单测不真跑 DNS：出站守卫放行；模型目录请求注入可控 fetch（不触网） */
class SpecSettingsService extends SettingsService {
  protected async guardOutbound() {
    return { ok: true, addresses: ['93.184.216.34'] };
  }
  protected outboundFetch(): typeof fetch {
    return globalThis.fetch;
  }
}

class RejectingSettingsService extends SettingsService {
  protected async guardOutbound() {
    return { ok: false, reason: '测试拒绝' };
  }
}

describe('厂商设置：协议与能力落库', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('保存并回显协议/上下文/最大输出/工具调用；key 只回显掩码', async () => {
    const { ai } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const r = await svc.saveProvider({
      name: 'spec-unisound',
      baseUrl: 'https://maas-api.example.com/v1/',
      apiKey: 'real-secret-key-1234',
      model: 'u2-flash',
      protocol: 'openai-compatible',
      contextWindow: 1_048_576,
      maxOutput: 131_072,
      toolCalling: 1,
      models: [{ id: 'u2-flash', contextWindow: 1_048_576, maxOutput: 131_072, toolCalling: true }],
    });
    expect(r.ok).toBe(true);
    const [row] = svc.listProviders().filter((p) => p.name === 'spec-unisound');
    expect(row).toMatchObject({
      baseUrl: 'https://maas-api.example.com/v1',
      model: 'u2-flash',
      protocol: 'openai-compatible',
      contextWindow: 1_048_576,
      maxOutput: 131_072,
      toolCalling: 1,
    });
    expect(row.apiKey).toContain('*');
    expect(row.apiKey.endsWith('1234')).toBe(true);
    expect(JSON.stringify(row)).not.toContain('real-secret-key');
    expect(row.models).toHaveLength(1);
  });

  it('最大输出不得超过上下文窗口；非法数值回落默认并夹取区间', async () => {
    const { ai } = fakeAi();
    const svc = new SpecSettingsService(ai);
    await svc.saveProvider({
      name: 'spec-clamp',
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      protocol: 'openai-compatible',
      contextWindow: 1000,
      maxOutput: 999_999,
    });
    const [row] = svc.listProviders().filter((p) => p.name === 'spec-clamp');
    expect(row.contextWindow).toBe(1000);
    expect(row.maxOutput).toBe(1000);

    await svc.saveProvider({ name: 'spec-clamp-2', baseUrl: 'https://api.example.com/v1', model: 'm', protocol: 'bogus', contextWindow: -5, maxOutput: Number.NaN });
    const [row2] = svc.listProviders().filter((p) => p.name === 'spec-clamp-2');
    expect(row2.protocol).toBe('openai-compatible');
    expect(row2.contextWindow).toBe(0);
    expect(row2.maxOutput).toBe(0);
  });

  it('更新激活中的厂商后立即刷新运行中连接（switchProvider 再次调用）', async () => {
    const { ai, raw, calls } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const { id } = await svc.saveProvider({ name: 'spec-active', baseUrl: 'https://api.example.com/v1', apiKey: 'k-123456', model: 'm1', protocol: 'openai-compatible' });
    await svc.activateProvider(id);
    sqlite.prepare('UPDATE model_provider SET is_active = 1 WHERE id = ?').run(id);
    expect(calls.switched).toEqual([id]);

    await svc.saveProvider({ id, name: 'spec-active', baseUrl: 'https://api.example.com/v2', model: 'm2', protocol: 'anthropic-messages', apiKey: '' });
    expect(raw.switchProvider).toHaveBeenCalledTimes(2);
    expect(calls.switched).toEqual([id, id]);
  });

  it('编辑时提交掩码 key 不覆盖库内真实 key', async () => {
    const { ai } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const { id } = await svc.saveProvider({ name: 'spec-mask', baseUrl: 'https://api.example.com/v1', apiKey: 'keep-me-9876', model: 'm' });
    const masked = svc.listProviders().find((p) => p.id === id)!.apiKey;
    await svc.saveProvider({ id, name: 'spec-mask', baseUrl: 'https://api.example.com/v1', apiKey: masked, model: 'm2' });
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as Record<string, unknown>;
    expect(String(row.model)).toBe('m2');
    const stored = svc.listProviders().find((p) => p.id === id)!;
    expect(stored.apiKey.endsWith('9876')).toBe(true);
  });

  it('更新省略或留空 key 保留旧密钥，显式模板 key 不作为有效密钥', async () => {
    const { ai } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const { id } = await svc.saveProvider({ name: 'spec-keep-key', baseUrl: 'https://api.example.com/v1', apiKey: 'fixture-key-1234', model: 'm' });
    const original = svc.listProviders().find((p) => p.id === id)!.apiKey;
    await svc.saveProvider({ id, name: 'spec-keep-key', baseUrl: 'https://api.example.com/v1', model: 'm2' });
    expect(svc.listProviders().find((p) => p.id === id)!.apiKey).toBe(original);
    await svc.saveProvider({ id, name: 'spec-keep-key', baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm3' });
    expect(svc.listProviders().find((p) => p.id === id)!.apiKey).toBe(original);
    await svc.saveProvider({ id, name: 'spec-keep-key', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-your-api-key-here', model: 'm' });
    expect(svc.listProviders().find((p) => p.id === id)!.apiKey).toBe('');
  });

  it('保存和激活 provider 都经过 SSRF 守卫', async () => {
    const { ai } = fakeAi();
    const svc = new RejectingSettingsService(ai);
    await expect(svc.saveProvider({ name: 'spec-guarded', baseUrl: 'https://api.example.com/v1', model: 'm' })).rejects.toThrow(/地址被安全策略拒绝/);

    const allowed = new SpecSettingsService(ai);
    const { id } = await allowed.saveProvider({ name: 'spec-guarded', baseUrl: 'https://api.example.com/v1', model: 'm' });
    const rejecting = new RejectingSettingsService(ai);
    await expect(rejecting.activateProvider(id)).rejects.toThrow(/地址被安全策略拒绝/);
  });
});

describe('厂商设置：检测模型与连接测试（未保存表单值）', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('检测模型：使用表单 Key 调 /models，返回模型与元数据', async () => {
    const { ai } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const original = globalThis.fetch;
    const seen: { url: string; auth?: string }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ data: [{ id: 'u2-flash', context_window: 1048576, max_output: 131072 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const r = await svc.discoverModels({ baseUrl: 'https://maas-api.example.com/v1', apiKey: 'form-key', protocol: 'openai-compatible' });
      expect(r.ok).toBe(true);
      expect(r.models[0]).toMatchObject({ id: 'u2-flash', contextWindow: 1048576, maxOutput: 131072 });
      expect(seen[0].url).toBe('https://maas-api.example.com/v1/models');
      expect(seen[0].auth).toBe('Bearer form-key');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('检测模型：编辑态提交掩码 Key 时复用库内真实 Key', async () => {
    const { ai } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const { id } = await svc.saveProvider({ name: 'spec-key', baseUrl: 'https://api.example.com/v1', apiKey: 'stored-key-abcd', model: 'm' });
    const masked = svc.listProviders().find((p) => p.id === id)!.apiKey;
    const original = globalThis.fetch;
    let auth = '';
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ data: [{ id: 'm' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const r = await svc.discoverModels({ id, baseUrl: 'https://api.example.com/v1', apiKey: masked, protocol: 'openai-compatible' });
      expect(r.ok).toBe(true);
      expect(auth).toBe('Bearer stored-key-abcd');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('privateOk 不绕过管理员私网出站策略', async () => {
    const { ai, raw } = fakeAi();
    const svc = new SettingsService(ai);
    const old = process.env.ALLOW_PRIVATE_OUTBOUND;
    delete process.env.ALLOW_PRIVATE_OUTBOUND;
    try {
      const result = await svc.testProvider({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'm', privateOk: true });
      expect(result.ok).toBe(false);
      expect(raw.testProviderConfig).not.toHaveBeenCalled();
    } finally {
      if (old === undefined) delete process.env.ALLOW_PRIVATE_OUTBOUND;
      else process.env.ALLOW_PRIVATE_OUTBOUND = old;
    }
  });

  it('检测模型：内网/回环地址默认被 SSRF 守卫拒绝（不发起请求）', async () => {
    const { ai } = fakeAi();
    const svc = new SettingsService(ai);
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const r = await svc.discoverModels({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'x', protocol: 'openai-compatible' });
      expect(r.ok).toBe(false);
      expect(String(r.error)).toMatch(/内网|保留|回环|私有/);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('连接测试：走临时配置，不改变当前激活厂商', async () => {
    const { ai, raw } = fakeAi();
    const svc = new SpecSettingsService(ai);
    const r = await svc.testProvider({ baseUrl: 'https://maas-api.example.com/v1', apiKey: 'k', protocol: 'openai-compatible', model: 'u2-flash' });
    expect(r.ok).toBe(true);
    expect(raw.testProviderConfig).toHaveBeenCalledTimes(1);
    expect(raw.switchProvider).not.toHaveBeenCalled();
    expect((raw.testProviderConfig.mock.calls[0][0] as { model: string }).model).toBe('u2-flash');
  });

  it('连接测试：缺少模型或地址 → 可读错误（不发起上游请求）', async () => {
    const { ai, raw } = fakeAi();
    const svc = new SpecSettingsService(ai);
    await expect(svc.testProvider({ baseUrl: '', apiKey: 'k', protocol: 'openai-compatible', model: 'm' })).resolves.toMatchObject({ ok: false });
    await expect(svc.testProvider({ baseUrl: 'https://api.example.com/v1', apiKey: 'k', protocol: 'openai-compatible', model: '' })).resolves.toMatchObject({ ok: false });
    expect(raw.testProviderConfig).not.toHaveBeenCalled();
  });
});
