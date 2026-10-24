import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db/src/database';
import { llmCallLogs } from '../../db/src/schema';
import { AiTransportService } from './ai-transport.service';

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
