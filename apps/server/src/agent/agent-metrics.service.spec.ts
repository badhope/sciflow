import { beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { agentExecutions, llmCallLogs } from '../db/schema';
import { AgentMetricsService } from './agent-metrics.service';

const svc = new AgentMetricsService();

beforeEach(() => {
  db.delete(llmCallLogs).run();
  db.delete(agentExecutions).run();
});

describe('AgentMetricsService', () => {
  it('汇总工具调用成功率、耗时与按工具分布', () => {
    const now = Date.now();
    for (const [tool, ok, ms] of [
      ['document.get', 1, 10],
      ['document.get', 1, 20],
      ['document.get', 0, 30],
      ['experiment.run', 1, 100],
    ] as const) {
      db.insert(llmCallLogs)
        .values({
          id: randomUUID(),
          caller: `tool:${tool}`,
          kind: 'tool',
          latencyMs: ms,
          success: ok,
          createdAt: now,
        })
        .run();
    }
    const m = svc.get(7);
    expect(m.toolCalls.total).toBe(4);
    expect(m.toolCalls.successRate).toBe(75);
    expect(m.byTool[0]).toMatchObject({ tool: 'document.get', calls: 3, ok: 2, fail: 1 });
    expect(m.byTool.find((x) => x.tool === 'experiment.run')?.avgMs).toBe(100);
  });

  it('汇总 run 状态与 token，并支持项目过滤', () => {
    for (const [pid, status, tokens] of [
      ['p1', 'done', 100],
      ['p1', 'error', 50],
      ['p2', 'done', 200],
    ] as const) {
      db.insert(agentExecutions)
        .values({
          id: randomUUID(),
          projectId: pid,
          source: 'chat',
          status,
          durationMs: 1000,
          totalTokens: tokens,
          createdAt: Date.now(),
        })
        .run();
    }
    const all = svc.get(7);
    expect(all.runs.total).toBe(3);
    expect(all.runs.done).toBe(2);
    expect(all.runs.error).toBe(1);
    expect(all.runs.totalTokens).toBe(350);

    const p1 = svc.get(7, 'p1');
    expect(p1.runs.total).toBe(2);
    expect(p1.runs.totalTokens).toBe(150);
    expect(p1.recentRuns).toHaveLength(2);
    expect(p1.recentRuns.every((r) => r.status === 'done' || r.status === 'error')).toBe(true);
  });

  it('工具指标按项目过滤，不再混入其他项目', () => {
    const now = Date.now();
    for (const [pid, tool] of [
      ['p1', 'document.get'],
      ['p1', 'document.get'],
      ['p2', 'experiment.run'],
    ] as const) {
      db.insert(llmCallLogs)
        .values({
          id: randomUUID(),
          caller: `tool:${tool}`,
          kind: 'tool',
          projectId: pid,
          latencyMs: 10,
          success: 1,
          createdAt: now,
        })
        .run();
    }
    expect(svc.get(7).toolCalls.total).toBe(3);
    const p1 = svc.get(7, 'p1');
    expect(p1.toolCalls.total).toBe(2);
    expect(p1.byTool.map((x) => x.tool)).toEqual(['document.get']);
  });

  it('days 被夹在 1..90', () => {
    expect(svc.get(0).rangeDays).toBe(7);
    expect(svc.get(999).rangeDays).toBe(90);
  });
});
