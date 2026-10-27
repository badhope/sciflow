import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, projects } from '../db/schema';
import { PipelineService } from './pipeline.service';

/**
 * 任务重跑：失败/中断任务必须能沿用原主题一条命令重来。
 * 历史体验缺陷：失败任务只能「删除 + 重新输入主题」，而用户在流水线页看到的是
 * 「不提供单任务重跑，请删除本任务后重新启动」。
 */
const PROJ = 'test-pipeline-rerun-001';

function makeService(aiConfigured = true): PipelineService {
  return new PipelineService(
    { configured: aiConfigured, config: { model: 'm' }, lastTotalTokens: 0 } as never, // ai
    { list: () => [], search: () => [], forPrompt: () => '' } as never,               // references
    { search: async () => [] } as never,                                             // knowledge
    { startRun: () => 'run', addStep: () => {}, finishRun: () => {} } as never,      // trace
    { search: async () => [] } as never,                                             // websearch
    { runEventHooks: async () => ({ blocked: '' }) } as never,                       // config
    { isEnabled: () => false, search: async () => [] } as never,                     // scholar
  );
}

function insertTask(status: string, topic = '异配图残差聚合'): string {
  const id = randomUUID();
  const now = Date.now();
  db.insert(pipelineTasks).values({
    id, projectId: PROJ, documentId: null, topic,
    currentStep: 'polish', status,
    steps: JSON.stringify([{ key: 'topic-verify', label: '主题验证', status: 'pending', retryCount: 0 }]),
    retryCount: 0, lastError: '', createdAt: now, updatedAt: now,
  }).run();
  return id;
}

describe('流水线重跑', () => {
  const cleanup = () => {
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();
  };
  beforeEach(() => {
    cleanup();
    db.insert(projects).values({ id: PROJ, name: 'rerun', createdAt: Date.now(), updatedAt: Date.now() }).run();
  });
  afterEach(cleanup);

  it('失败任务可重跑：新建一条同主题任务（原任务保留）', async () => {
    const srcId = insertTask('failed');
    const svc = makeService();
    const created = await svc.rerun(srcId);
    expect(created.id).not.toBe(srcId);
    expect(created.topic).toBe('异配图残差聚合');
    // 新建即入库（异步图执行在测试环境会失败，这里只验证创建语义）
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, created.id)).get();
    expect(row?.topic).toBe('异配图残差聚合');
    // 原任务保持不变（重跑不改历史记录）
    const src = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, srcId)).get()!;
    expect(src.status).toBe('failed');
  });

  it('运行中的任务不允许重跑（避免同项目并发双跑）', async () => {
    const srcId = insertTask('running');
    const svc = makeService();
    await expect(svc.rerun(srcId)).rejects.toThrow(/仍在运行中/);
  });

  it('AI 未配置时重跑被拒（与新建同一前置校验）', async () => {
    const srcId = insertTask('failed');
    const svc = makeService(false);
    await expect(svc.rerun(srcId)).rejects.toThrow(/AI 服务未配置/);
  });

  it('不存在的任务重跑返回 404', async () => {
    const svc = makeService();
    await expect(svc.rerun('no-such-task')).rejects.toThrow(/不存在/);
  });
});
