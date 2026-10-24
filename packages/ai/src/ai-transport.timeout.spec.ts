import { describe, it, expect } from 'vitest';
import { AiTransportService } from './ai-transport.service';

/**
 * 请求级超时：上游挂起（不回包、不断连）时必须有硬超时兜底。
 * 历史事故：UNISOUND 网关连接建立后不返回，流水线在 quality-gate 卡死 17.5 分钟，
 * 因为 abortSignal 只来自客户端断连（无浏览器请求时永不触发）。
 */
describe('AiTransportService 请求级超时', () => {
  it('env 非法值回落默认，合法值生效（AI_REQUEST_TIMEOUT_MS）', () => {
    const prev = process.env.AI_REQUEST_TIMEOUT_MS;
    try {
      process.env.AI_REQUEST_TIMEOUT_MS = 'abc';
      expect(AiTransportService.requestTimeoutMs()).toBe(180_000);
      process.env.AI_REQUEST_TIMEOUT_MS = '5000';
      expect(AiTransportService.requestTimeoutMs()).toBe(5_000);
      process.env.AI_REQUEST_TIMEOUT_MS = '10';
      expect(AiTransportService.requestTimeoutMs()).toBe(10);
      process.env.AI_REQUEST_TIMEOUT_MS = '0';
      expect(AiTransportService.requestTimeoutMs()).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = prev;
    }
  });

  it('合并外部信号与超时信号：任一触发即 abort', () => {
    const outer = new AbortController();
    const merged = AiTransportService.withTimeout(outer.signal, 60_000);
    expect(merged.aborted).toBe(false);
    outer.abort(new Error('client gone'));
    expect(merged.aborted).toBe(true);

    const timed = AiTransportService.withTimeout(undefined, 30);
    expect(timed.aborted).toBe(false);
  });

  it('超时到点后信号 abort（真实计时，非 mock）', async () => {
    const sig = AiTransportService.withTimeout(undefined, 40);
    await new Promise((r) => setTimeout(r, 90));
    expect(sig.aborted).toBe(true);
  });

  it('超时值为 0 表示禁用：不注入额外信号', () => {
    const sig = AiTransportService.withTimeout(undefined, 0);
    expect(sig.aborted).toBe(false);
  });
});
