import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db/database';
import { agentExecutions, agentSteps, llmCallLogs } from '../db/schema';

/**
 * Agent 指标 v0：把已有的工具调用日志与执行记录汇总成可观测数据。
 *
 * 作用域：llm_call_log 与 agent_execution 都带 project_id；传 projectId 时
 * 工具指标与 run 指标都按项目过滤，空串表示历史/全局行。
 * 工具口径：chat 工具写 llm_call_log，流水线图内工具写 agent_step，两者合并统计。
 */
export interface AgentToolMetric {
  tool: string;
  calls: number;
  ok: number;
  fail: number;
  successRate: number;
  avgMs: number;
  p95Ms: number;
}

export interface AgentMetrics {
  rangeDays: number;
  toolCalls: {
    total: number;
    ok: number;
    fail: number;
    successRate: number;
    avgMs: number;
    p95Ms: number;
  };
  byTool: AgentToolMetric[];
  byDay: { date: string; calls: number; fail: number; tokens: number }[];
  runs: {
    total: number;
    done: number;
    error: number;
    running: number;
    avgDurationMs: number;
    totalTokens: number;
  };
  /** 最近执行（驾驶舱直接渲染，替代再拉一次 /agent/executions） */
  recentRuns: {
    id: string;
    source: string;
    status: string;
    durationMs: number;
    tokens: number;
    createdAt: number;
  }[];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

@Injectable()
export class AgentMetricsService {
  get(days = 7, projectId?: string): AgentMetrics {
    const rangeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
    const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000;

    const toolRows = db
      .select({
        caller: llmCallLogs.caller,
        latencyMs: llmCallLogs.latencyMs,
        success: llmCallLogs.success,
        createdAt: llmCallLogs.createdAt,
      })
      .from(llmCallLogs)
      .where(and(
        eq(llmCallLogs.kind, 'tool'),
        gte(llmCallLogs.createdAt, since),
        projectId ? eq(llmCallLogs.projectId, projectId) : undefined,
      ))
      .all();

    // 流水线图内的工具调用写 agent_step（带 runId），chat 工具调用写 llm_call_log。
    // 两边必须合并统计，否则「Agent 工具成功率」只看到聊天的一半，流水线跑得越多越失真。
    const pipelineToolRows = db
      .select({
        toolName: agentSteps.toolName,
        latencyMs: agentSteps.durationMs,
        status: agentSteps.status,
        createdAt: agentSteps.createdAt,
      })
      .from(agentSteps)
      .innerJoin(agentExecutions, eq(agentSteps.runId, agentExecutions.id))
      .where(and(
        eq(agentSteps.kind, 'tool'),
        gte(agentSteps.createdAt, since),
        projectId ? eq(agentExecutions.projectId, projectId) : undefined,
      ))
      .all();
    const toolRowsAll = [
      ...toolRows,
      ...pipelineToolRows.map((r) => ({
        caller: `tool:${String(r.toolName ?? '')}`,
        latencyMs: r.latencyMs,
        success: r.status === 'ok' ? 1 : 0,
        createdAt: r.createdAt,
      })),
    ];

    const total = toolRowsAll.length;
    const ok = toolRowsAll.filter((r) => r.success === 1).length;
    const latencies = toolRowsAll.map((r) => r.latencyMs ?? 0);
    const avgMs = total ? Math.round(latencies.reduce((a, b) => a + b, 0) / total) : 0;

    const byToolMap = new Map<string, { calls: number; ok: number; fail: number; latencies: number[] }>();
    for (const r of toolRowsAll) {
      const name = String(r.caller ?? '').replace(/^tool:/, '') || 'unknown';
      const m = byToolMap.get(name) ?? { calls: 0, ok: 0, fail: 0, latencies: [] };
      m.calls += 1;
      if (r.success === 1) m.ok += 1;
      else m.fail += 1;
      m.latencies.push(r.latencyMs ?? 0);
      byToolMap.set(name, m);
    }
    const byTool = Array.from(byToolMap.entries())
      .map(([tool, m]) => ({
        tool,
        calls: m.calls,
        ok: m.ok,
        fail: m.fail,
        successRate: m.calls ? Math.round((m.ok / m.calls) * 1000) / 10 : 0,
        avgMs: m.calls ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.calls) : 0,
        p95Ms: percentile(m.latencies, 95),
      }))
      .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))
      .slice(0, 20);

    const runRows = db
      .select({
        id: agentExecutions.id,
        source: agentExecutions.source,
        status: agentExecutions.status,
        durationMs: agentExecutions.durationMs,
        totalTokens: agentExecutions.totalTokens,
        createdAt: agentExecutions.createdAt,
      })
      .from(agentExecutions)
      .where(projectId ? and(gte(agentExecutions.createdAt, since), eq(agentExecutions.projectId, projectId)) : gte(agentExecutions.createdAt, since))
      .orderBy(desc(agentExecutions.createdAt))
      .all();
    const runsTotal = runRows.length;
    const done = runRows.filter((r) => r.status === 'done').length;
    const error = runRows.filter((r) => r.status === 'error').length;
    const running = runRows.filter((r) => r.status === 'running').length;
    const runDurations = runRows.map((r) => r.durationMs ?? 0).filter((n) => n > 0);
    const runAvg = runDurations.length ? Math.round(runDurations.reduce((a, b) => a + b, 0) / runDurations.length) : 0;
    const runTokens = runRows.reduce((a, r) => a + (r.totalTokens ?? 0), 0);

    // 按天：工具调用 + 失败；tokens 取 run 记录（工具日志本身没有 token）
    const dayMap = new Map<string, { calls: number; fail: number; tokens: number }>();
    const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);
    for (const r of toolRowsAll) {
      const k = dayKey(r.createdAt ?? since);
      const m = dayMap.get(k) ?? { calls: 0, fail: 0, tokens: 0 };
      m.calls += 1;
      if (r.success !== 1) m.fail += 1;
      dayMap.set(k, m);
    }
    for (const r of runRows) {
      const k = dayKey(r.createdAt);
      const m = dayMap.get(k) ?? { calls: 0, fail: 0, tokens: 0 };
      m.tokens += r.totalTokens ?? 0;
      dayMap.set(k, m);
    }
    const byDay = Array.from(dayMap.entries())
      .map(([date, m]) => ({ date, ...m }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      rangeDays,
      toolCalls: {
        total,
        ok,
        fail: total - ok,
        successRate: total ? Math.round((ok / total) * 1000) / 10 : 0,
        avgMs,
        p95Ms: percentile(latencies, 95),
      },
      byTool,
      byDay,
      runs: {
        total: runsTotal,
        done,
        error,
        running,
        avgDurationMs: runAvg,
        totalTokens: runTokens,
      },
      recentRuns: runRows.slice(0, 6).map((r) => ({
        id: r.id,
        source: r.source,
        status: r.status ?? 'running',
        durationMs: r.durationMs ?? 0,
        tokens: r.totalTokens ?? 0,
        createdAt: r.createdAt,
      })),
    };
  }
}
