import { describe, it, expect, afterEach, vi } from 'vitest';
import { AiTransportService } from './ai-transport.service';

/**
 * 模型降级链（AI_MODEL_FALLBACK）行为测试。
 *
 * 契约（ARCHITECTURE §2.25-2）：主模型重试耗尽且用户未取消 → 备选模型再试一次，
 * 成功以 `caller:fallback` 留痕；降级也失败则保留主模型错误语义。
 * 流式路径明确不适用（增量已出无法安全重放），这里只测非流式 complete()。
 *
 * 隔离方式：spy 掉 generateWithRetry（p-retry 包裹的最小生成单元），
 * 让「主模型」抛错、「备选模型」成功——不 mock AI SDK 本身，也不用真实网络。
 */
class FallbackTestTransport extends AiTransportService {
  markConfigured(primary: string): void {
    // configured 是只读 getter（按 _secretKey 判定），走 setApiKey 真实路径
    (this as unknown as { setApiKey: (v: string) => void }).setApiKey('sk-test-fallback');
    (this as unknown as { fastModel: string }).fastModel = primary;
    (this as unknown as { strongModel: string }).strongModel = primary;
  }
}

describe('模型降级链（AI_MODEL_FALLBACK）', () => {
  afterEach(() => {
    delete process.env.AI_MODEL_FALLBACK;
    vi.restoreAllMocks();
  });

  it('主模型耗尽重试 → 降级模型成功返回，并以 caller:fallback 留痕', async () => {
    process.env.AI_MODEL_FALLBACK = 'fallback-model';
    const svc = new FallbackTestTransport();
    svc.markConfigured('primary-model');
    const gen = vi.spyOn(svc as unknown as { generateWithRetry: FallbackTestTransport['generateWithRetry'] }, 'generateWithRetry')
      .mockImplementation(async (_m, _o, model: string) => {
        if (model === 'primary-model') throw new Error('primary endpoint down');
        return { text: 'fallback-ok', usage: { inputTokens: 1, outputTokens: 1 } };
      });
    const log = vi.spyOn(svc as unknown as { logLlmCall: FallbackTestTransport['logLlmCall'] }, 'logLlmCall').mockReturnValue(undefined);

    const text = await svc.complete([{ role: 'user', content: 'hi' }], { retries: 0 });

    expect(text).toBe('fallback-ok');
    expect(gen.mock.calls.some((c) => c[2] === 'primary-model')).toBe(true);
    expect(gen.mock.calls.some((c) => c[2] === 'fallback-model')).toBe(true);
    // 降级成功即返回：只留 fallback 成功日志（主模型失败不单独留痕，warn 日志可见）
    expect(log.mock.calls.some((c) => c[0]?.caller === 'general:fallback' && c[0]?.model === 'fallback-model' && c[0]?.success === true)).toBe(true);
    expect(log.mock.calls.every((c) => c[0]?.success === true)).toBe(true);
  });

  it('未配置降级模型 → 失败照常抛出（行为与旧版一致）', async () => {
    delete process.env.AI_MODEL_FALLBACK;
    const svc = new FallbackTestTransport();
    svc.markConfigured('primary-model');
    vi.spyOn(svc as unknown as { generateWithRetry: FallbackTestTransport['generateWithRetry'] }, 'generateWithRetry')
      .mockRejectedValue(new Error('primary down'));

    await expect(svc.complete([{ role: 'user', content: 'hi' }], { retries: 0 })).rejects.toThrow(/AI 服务调用失败/);
  });

  it('降级模型也失败 → 仍抛 HttpException（保留主模型错误语义，不静默成功）', async () => {
    process.env.AI_MODEL_FALLBACK = 'fallback-model';
    const svc = new FallbackTestTransport();
    svc.markConfigured('primary-model');
    vi.spyOn(svc as unknown as { generateWithRetry: FallbackTestTransport['generateWithRetry'] }, 'generateWithRetry')
      .mockRejectedValue(new Error('everything down'));

    await expect(svc.complete([{ role: 'user', content: 'hi' }], { retries: 0 })).rejects.toThrow(/AI 服务调用失败/);
  });

  it('用户已取消（signal aborted）时不触发降级', async () => {
    process.env.AI_MODEL_FALLBACK = 'fallback-model';
    const svc = new FallbackTestTransport();
    svc.markConfigured('primary-model');
    const gen = vi.spyOn(svc as unknown as { generateWithRetry: FallbackTestTransport['generateWithRetry'] }, 'generateWithRetry')
      .mockRejectedValue(new Error('primary down'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      svc.complete([{ role: 'user', content: 'hi' }], { retries: 0, signal: controller.signal }),
    ).rejects.toThrow();
    // 只有主模型那一次调用，没有降级重试
    expect(gen.mock.calls.every((c) => c[2] === 'primary-model')).toBe(true);
  });
});
