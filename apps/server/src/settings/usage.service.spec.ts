import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, sqlite } from '../db/database';
import { llmCallLogs } from '../db/schema';
import { UsageService } from './usage.service';

/**
 * 用量统计口径（v1.0.1）：
 * - 平均时延只算成功调用：失败调用的 latency_ms 被记成「快速失败」的几十毫秒，
 *   混进 AVG 会把真实耗时压到极低（实测失败 56ms vs 成功 146s，均值失真 3 个数量级）。
 * - 成功率与 token 仍按全部调用计。
 */
const CALLER = 'usage-spec-caller';

function insert(caller: string, latency: number, success: number, tokens: number) {
  db.insert(llmCallLogs).values({
    id: randomUUID(), caller, kind: 'llm', model: 'm',
    promptTokens: tokens, completionTokens: 0, totalTokens: tokens,
    latencyMs: latency, success, error: success ? '' : 'boom', createdAt: Date.now(),
  }).run();
}

describe('用量统计口径', () => {
  beforeEach(() => db.delete(llmCallLogs).where(eq(llmCallLogs.caller, CALLER)).run());
  afterEach(() => db.delete(llmCallLogs).where(eq(llmCallLogs.caller, CALLER)).run());

  it('平均时延只统计成功调用（失败调用的快速失败不拉低均值）', () => {
    insert(CALLER, 10_000, 1, 100);
    insert(CALLER, 20_000, 1, 100);
    insert(CALLER, 50, 0, 0); // 失败：50ms 快速失败
    const svc = new UsageService();
    const row = svc.summary().byCaller.find((r) => r.caller === CALLER)!;
    expect(row.calls).toBe(3);
    expect(row.avg_latency_ms).toBe(15_000);
    expect(row.success_rate).toBeCloseTo(66.7, 1);
    expect(row.total_tokens).toBe(200);
  });

  it('全部失败时不产生 NaN（平均时延回落 0）', () => {
    insert(CALLER, 30, 0, 0);
    const svc = new UsageService();
    const row = svc.summary().byCaller.find((r) => r.caller === CALLER)!;
    expect(row.avg_latency_ms).toBe(0);
    expect(row.success_rate).toBe(0);
  });

  it('工具调用（kind=tool）不进入 LLM 成本统计', () => {
    insert(CALLER, 500, 1, 100);
    sqlite.prepare(`INSERT INTO llm_call_log (id, caller, kind, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, success, error, created_at) VALUES (?,?,?,?,0,0,0,?,1,'',?)`)
      .run(randomUUID(), CALLER, 'tool', '', 20, Date.now());
    const svc = new UsageService();
    const row = svc.summary().byCaller.find((r) => r.caller === CALLER)!;
    expect(row.calls).toBe(1);
    expect(svc.summary().tools.calls).toBeGreaterThanOrEqual(1);
  });
});
