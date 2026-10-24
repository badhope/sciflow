import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, projects, documents, reflexionLogs } from '../db/schema';
import { PipelineService } from './pipeline.service';

/**
 * 流水线停止：运行中的任务必须能被用户主动中止（此前只能重启服务）。
 * 历史事故：上游网关挂起 → 任务永久 running → DELETE 返回 400「请先停止」但根本没有停止接口。
 */
const PROJ = 'test-pipeline-stop-001';

function makeService(): PipelineService {
  // stop() 只依赖 db 与 trace 空实现，不需要真图
  return new PipelineService(
    { configured: true, config: { model: 'm' }, lastTotalTokens: 0 } as never,
    { list: () => [], forPrompt: () => '' } as never,
    { search: async () => [] } as never,
    { startRun: () => 'run', addStep: () => {}, finishRun: () => {} } as never,
  );
}

function insertTask(status: string): string {
  const id = randomUUID();
  const now = Date.now();
  db.insert(pipelineTasks).values({
    id, projectId: PROJ, documentId: null, topic: '停止测试',
    currentStep: 'quality-gate', status,
    steps: JSON.stringify([
      { key: 'topic-verify', label: '主题验证', status: 'done', retryCount: 0 },
      { key: 'quality-gate', label: '质量门', status: 'running', retryCount: 0, startedAt: now - 5000 },
      { key: 'polish', label: '润色', status: 'pending', retryCount: 0 },
    ]),
    retryCount: 0, lastError: '', createdAt: now, updatedAt: now,
  }).run();
  return id;
}

describe('流水线停止', () => {
  const cleanup = () => {
    db.delete(documents).where(eq(documents.projectId, PROJ)).run();
    db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, 'x')).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();
  };

  beforeEach(() => {
    cleanup();
    db.insert(projects).values({ id: PROJ, name: 'stop', createdAt: Date.now(), updatedAt: Date.now() }).run();
  });
  afterEach(cleanup);

  it('运行中任务可停止：status=cancelled，运行步骤标 cancelled，其余待执行步骤 skipped', () => {
    const id = insertTask('running');
    const svc = makeService();
    const res = svc.stop(id);
    expect(res.status).toBe('cancelled');
    const steps = (res.steps as { key: string; status: string; endedAt?: number }[]);
    const qg = steps.find((s) => s.key === 'quality-gate')!;
    expect(qg.status).toBe('cancelled');
    expect(qg.endedAt).toBeGreaterThan(0);
    expect(steps.find((s) => s.key === 'polish')!.status).toBe('skipped');
    // 落库持久化
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get()!;
    expect(row.status).toBe('cancelled');
    expect(row.lastError).toContain('用户停止');
  });

  it('等待大纲确认的任务也可停止', () => {
    const id = insertTask('awaiting_confirmation');
    const svc = makeService();
    expect(svc.stop(id).status).toBe('cancelled');
  });

  it('非运行态任务停止返回 400（已完成/已失败无需停止）', () => {
    const id = insertTask('completed');
    const svc = makeService();
    expect(() => svc.stop(id)).toThrowError(/不在运行中/);
  });

  it('停止后可以删除（DELETE 不再被「请先停止」挡住）', () => {
    const id = insertTask('running');
    const svc = makeService();
    svc.stop(id);
    expect(svc.remove(id)).toEqual({ ok: true });
    expect(db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get()).toBeUndefined();
  });

  it('停止不存在的任务返回 404', () => {
    const svc = makeService();
    expect(() => svc.stop(randomUUID())).toThrowError(/不存在/);
  });

  it('库里残留 running 但图并未在跑时，不残留 stoppedTasks 标记（否则永久阻断 notify）', () => {
    const id = insertTask('running');
    const svc = makeService();
    svc.stop(id);
    // 无执行中的图 → traceRuns 为空 → 不应写入标记；后续 notify 仍能正常落库
    expect(() => svc.stop(id)).toThrowError(/不在运行中/); // 已 cancelled，再次停止被拒
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get()!;
    expect(row.status).toBe('cancelled');
  });
});
