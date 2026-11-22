import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import pLimit from 'p-limit';
import { db } from '../db/database';
import { agentBackgroundJobs } from '../db/schema';
import { ChatService } from './chat.service';
import { envInt } from '../common/env';

const MAX_JOBS = envInt('AGENT_BACKGROUND_MAX_JOBS', 20, { min: 1, max: 100 });
const CONCURRENCY = envInt('AGENT_BACKGROUND_CONCURRENCY', 2, { min: 1, max: 8 });
const MAX_MESSAGE_CHARS = 20_000;

export interface BackgroundJobView {
  id: string;
  projectId: string;
  sessionKey: string;
  message: string;
  model: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  output: string;
  error: string;
  runId: string;
  totalTokens: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * 后台多会话执行器。
 *
 * HTTP 请求只负责入队，真正的模型/工具循环在服务端继续跑；前端可轮询列表或
 * 详情。全局最多 CONCURRENCY 个任务，同一 sessionKey 串行（避免两个后台回合
 * 同时改同一份文档），不同 sessionKey 可并行。
 */
@Injectable()
export class BackgroundRunService {
  private readonly logger = new Logger(BackgroundRunService.name);
  private readonly globalLimit = pLimit(CONCURRENCY);
  private readonly sessionLimits = new Map<string, ReturnType<typeof pLimit>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly chat: ChatService) {}

  private sessionLimit(sessionKey: string) {
    let limit = this.sessionLimits.get(sessionKey);
    if (!limit) {
      limit = pLimit(1);
      this.sessionLimits.set(sessionKey, limit);
    }
    return limit;
  }

  private view(row: typeof agentBackgroundJobs.$inferSelect): BackgroundJobView {
    return {
      id: row.id,
      projectId: row.projectId,
      sessionKey: row.sessionKey || 'default',
      message: row.message,
      model: row.model || '',
      status: (row.status || 'queued') as BackgroundJobView['status'],
      output: row.output || '',
      error: row.error || '',
      runId: row.runId || '',
      totalTokens: row.totalTokens || 0,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? null,
      finishedAt: row.finishedAt ?? null,
    };
  }

  start(input: { projectId: string; message: string; sessionKey?: string; model?: string }): BackgroundJobView {
    const projectId = String(input.projectId || '').trim();
    const message = String(input.message || '').trim();
    if (!projectId) throw new BadRequestException('projectId 必填');
    if (!message) throw new BadRequestException('message 不能为空');
    if (message.length > MAX_MESSAGE_CHARS) throw new BadRequestException(`message 超过 ${MAX_MESSAGE_CHARS} 字`);
    const sessionKey = String(input.sessionKey || 'default').trim().slice(0, 80) || 'default';
    const queued = db.select().from(agentBackgroundJobs).where(eq(agentBackgroundJobs.status, 'queued')).all().length;
    if (queued >= MAX_JOBS) throw new BadRequestException(`后台队列已满（${MAX_JOBS} 个待执行任务）`);

    const now = Date.now();
    const id = randomUUID();
    db.insert(agentBackgroundJobs).values({
      id,
      projectId,
      sessionKey,
      message,
      model: String(input.model || '').trim(),
      status: 'queued',
      output: '',
      error: '',
      runId: '',
      totalTokens: 0,
      createdAt: now,
    }).run();

    const sessionKeyForLimit = `${projectId}::${sessionKey}`;
    void this.globalLimit(() => this.sessionLimit(sessionKeyForLimit)(() => this.execute(id)));
    return this.view(this.getRow(id));
  }

  list(projectId: string, limit = 20): BackgroundJobView[] {
    const rows = db.select()
      .from(agentBackgroundJobs)
      .where(eq(agentBackgroundJobs.projectId, projectId))
      .orderBy(desc(agentBackgroundJobs.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100))
      .all();
    return rows.map((r) => this.view(r));
  }

  get(id: string): BackgroundJobView {
    return this.view(this.getRow(id));
  }

  cancel(id: string): BackgroundJobView {
    const row = this.getRow(id);
    if (row.status === 'queued') {
      db.update(agentBackgroundJobs)
        .set({ status: 'cancelled', finishedAt: Date.now(), error: '用户取消（尚未开始）' })
        .where(eq(agentBackgroundJobs.id, id))
        .run();
      return this.get(id);
    }
    if (row.status !== 'running') return this.view(row);
    this.controllers.get(id)?.abort();
    db.update(agentBackgroundJobs)
      .set({ status: 'cancelled', finishedAt: Date.now(), error: '用户取消' })
      .where(eq(agentBackgroundJobs.id, id))
      .run();
    return this.get(id);
  }

  private getRow(id: string) {
    const row = db.select().from(agentBackgroundJobs).where(eq(agentBackgroundJobs.id, id)).get();
    if (!row) throw new NotFoundException('后台任务不存在');
    return row;
  }

  private async execute(id: string): Promise<void> {
    const row = db.select().from(agentBackgroundJobs).where(eq(agentBackgroundJobs.id, id)).get();
    if (!row || row.status !== 'queued') return;
    const ac = new AbortController();
    this.controllers.set(id, ac);
    db.update(agentBackgroundJobs)
      .set({ status: 'running', startedAt: Date.now() })
      .where(and(eq(agentBackgroundJobs.id, id), eq(agentBackgroundJobs.status, 'queued')))
      .run();
    let totalTokens = 0;
    try {
      const result = await this.chat.answer(
        row.message,
        [],
        row.projectId,
        undefined,
        {
          model: row.model || undefined,
          signal: ac.signal,
          onUsage: (usage) => { totalTokens += usage.totalTokens || 0; },
          onRunStarted: (id) => {
            db.update(agentBackgroundJobs).set({ runId: id }).where(eq(agentBackgroundJobs.id, row.id)).run();
          },
        },
      );
      // cancel() 可能先把 DB 标成 cancelled，再 abort；以 DB 状态为准，避免完成回写覆盖取消。
      const latest = db.select().from(agentBackgroundJobs).where(eq(agentBackgroundJobs.id, id)).get();
      const cancelled = ac.signal.aborted || latest?.status === 'cancelled';
      db.update(agentBackgroundJobs)
        .set({
          status: cancelled ? 'cancelled' : 'done',
          output: String(result.answer || '').slice(0, 20_000),
          error: cancelled ? '用户取消' : '',
          totalTokens,
          finishedAt: Date.now(),
        })
        .where(eq(agentBackgroundJobs.id, id))
        .run();
    } catch (e: any) {
      const latest = db.select().from(agentBackgroundJobs).where(eq(agentBackgroundJobs.id, id)).get();
      const cancelled = ac.signal.aborted || latest?.status === 'cancelled';
      if (!cancelled) this.logger.warn(`后台任务 ${id} 失败：${e?.message || e}`);
      db.update(agentBackgroundJobs)
        .set({
          status: cancelled ? 'cancelled' : 'error',
          error: (e?.message || String(e)).slice(0, 1_000),
          totalTokens,
          finishedAt: Date.now(),
        })
        .where(eq(agentBackgroundJobs.id, id))
        .run();
    } finally {
      this.controllers.delete(id);
    }
  }
}
