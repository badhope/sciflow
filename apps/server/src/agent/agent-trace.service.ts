/**
 * Agent 执行轨迹服务（对标 Cursor/Cline 调用链追踪 + OpenHands 轨迹面板）
 *
 * 记录每次 Agent 执行的完整步骤链（LLM 调用 / 工具调用 / 检索 / 思考），
 * 供前端展示 Agent 行为、排查异常、统计 token 成本。
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/database';
import { agentExecutions, agentSteps } from '../db/schema';
import { normalizeAgentDate } from '../pipeline/pipeline-metrics';

export interface AgentStepInput {
  kind: 'llm' | 'tool' | 'search' | 'retrieve' | 'thinking';
  title?: string;
  input?: string;
  output?: string;
  durationMs?: number;
  tokens?: number;
  toolName?: string;
  status?: 'ok' | 'error';
  error?: string;
}

@Injectable()
export class AgentTraceService {
  private readonly logger = new Logger(AgentTraceService.name);
  private static readonly MAX_IO_BYTES = 16 * 1024; // 16KB 截断保护

  /** 开始一次 Agent 执行，返回 runId 用于后续步骤关联 */
  startRun(params: { projectId: string; source: string; input?: string; model?: string }): string {
    const id = randomUUID();
    db.insert(agentExecutions)
      .values({
        id,
        projectId: params.projectId,
        source: params.source,
        input: this.truncate(params.input || ''),
        model: params.model || '',
        status: 'running',
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /** 追加一个执行步骤 */
  addStep(runId: string, step: AgentStepInput): void {
    try {
      const seq = db.select().from(agentSteps).where(eq(agentSteps.runId, runId)).all().length;
      db.insert(agentSteps)
        .values({
          id: randomUUID(),
          runId,
          seq,
          kind: step.kind,
          title: step.title || '',
          input: this.truncate(step.input || ''),
          output: this.truncate(step.output || ''),
          durationMs: step.durationMs || 0,
          tokens: step.tokens || 0,
          toolName: step.toolName || '',
          status: step.status || 'ok',
          error: step.error || '',
          createdAt: Date.now(),
        })
        .run();
    } catch (e: any) {
      this.logger.warn(`addStep 失败: ${e?.message || e}`);
    }
  }

  /** 完成一次 Agent 执行 */
  finishRun(runId: string, result: { outputSummary?: string; status?: string; error?: string; totalTokens?: number }): void {
    try {
      const run = db.select().from(agentExecutions).where(eq(agentExecutions.id, runId)).get();
      if (!run) return;
      db.update(agentExecutions)
        .set({
          outputSummary: this.truncate(result.outputSummary || ''),
          status: result.status || 'done',
          error: result.error || '',
          totalTokens: result.totalTokens || 0,
          durationMs: Date.now() - run.createdAt,
        })
        .where(eq(agentExecutions.id, runId))
        .run();
    } catch (e: any) {
      this.logger.warn(`finishRun 失败: ${e?.message || e}`);
    }
  }

  /** 列出项目最近的 Agent 执行历史 */
  listRuns(projectId: string, limit = 20) {
    return db.select().from(agentExecutions).where(eq(agentExecutions.projectId, projectId)).orderBy(desc(agentExecutions.createdAt)).limit(limit).all();
  }

  /** 获取单次执行的完整步骤链 */
  getRunDetail(runId: string) {
    const run = db.select().from(agentExecutions).where(eq(agentExecutions.id, runId)).get();
    if (!run) return null;
    const steps = db.select().from(agentSteps).where(eq(agentSteps.runId, runId)).all();
    return { ...run, steps };
  }

  /** 统计项目 token 用量走势（按日聚合） */
  tokenUsageTrend(projectId: string, days = 14): { date: string; tokens: number; runs: number }[] {
    const since = Date.now() - days * 86400000;
    const runs = db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.projectId, projectId))
      .all()
      .filter((r) => r.createdAt >= since);

    const buckets = new Map<string, { tokens: number; runs: number }>();
    for (const r of runs) {
      const date = normalizeAgentDate(r.createdAt);
      const b = buckets.get(date) || { tokens: 0, runs: 0 };
      b.tokens += r.totalTokens || 0;
      b.runs += 1;
      buckets.set(date, b);
    }
    return Array.from(buckets.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private truncate(text: string): string {
    const buf = Buffer.from(text || '', 'utf-8');
    if (buf.length <= AgentTraceService.MAX_IO_BYTES) return text;
    return buf.subarray(0, AgentTraceService.MAX_IO_BYTES).toString('utf-8') + '\n…[truncated]';
  }
}
