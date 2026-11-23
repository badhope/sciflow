import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { agentSchedules, projects } from '../db/schema';
import { AutomationService } from './automation.service';

const PROJ = 'test-automation-001';
const background = { start: vi.fn(() => ({ id: 'job' })) } as never;
const notifications = { notify: vi.fn(async () => ({ id: 'n' })) } as never;
const svc = new AutomationService(background, notifications);

function cleanup() {
  db.delete(agentSchedules).where(eq(agentSchedules.projectId, PROJ)).run();
  db.delete(projects).where(eq(projects.id, PROJ)).run();
}

function seed(triggerType: 'reference.created' | 'pipeline.completed' | 'quality.threshold' | 'experiment.failed', cfg: Record<string, unknown> = {}, enabled = 1) {
  const now = Date.now();
  const id = `${triggerType}-${Math.random().toString(36).slice(2)}`;
  db.insert(agentSchedules).values({
    id, projectId: PROJ, name: `任务-${triggerType}`, cadence: 'daily', minuteOfHour: 0, hourOfDay: 9, weekday: 1,
    message: '处理事件', sessionKey: 'automation', model: '', enabled, delayMinutes: 5, nextRunAt: now + 1000,
    triggerType, triggerConfig: JSON.stringify(cfg), notifyChannels: '["inapp"]', notifyTarget: '', lastStatus: '', lastRunAt: null,
    createdAt: now, updatedAt: now,
  }).run();
  return id;
}

describe('AutomationService', () => {
  beforeEach(() => {
    cleanup();
    const now = Date.now();
    db.insert(projects).values({ id: PROJ, name: '自动化测试', createdAt: now, updatedAt: now }).run();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('文献入库事件只触发 reference.created 任务', async () => {
    seed('reference.created');
    seed('pipeline.completed');
    await svc.onReferenceCreated({ projectId: PROJ, referenceId: 'r1', title: '新文献' });
    expect(background.start).toHaveBeenCalledTimes(1);
    expect(background.start).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJ, message: expect.stringContaining('新文献') }));
  });

  it('质量分低于阈值才触发，达到阈值不触发', async () => {
    seed('quality.threshold', { threshold: 80 });
    await svc.onQualityScored({ projectId: PROJ, documentId: 'd1', score: 72 });
    expect(background.start).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    await svc.onQualityScored({ projectId: PROJ, documentId: 'd1', score: 88 });
    expect(background.start).not.toHaveBeenCalled();
  });

  it('流水线事件按 documentId 过滤，禁用任务不触发', async () => {
    seed('pipeline.completed', { documentId: 'doc-a' });
    seed('pipeline.completed', {}, 0);
    await svc.onPipelineCompleted({ projectId: PROJ, documentId: 'doc-b' });
    expect(background.start).not.toHaveBeenCalled();
    await svc.onPipelineCompleted({ projectId: PROJ, documentId: 'doc-a' });
    expect(background.start).toHaveBeenCalledTimes(1);
  });

  it('实验失败只接受 error/timeout 状态，并写 lastStatus', async () => {
    const id = seed('experiment.failed');
    await svc.onExperimentFailed({ projectId: PROJ, experimentId: 'e1', status: 'success' });
    expect(background.start).not.toHaveBeenCalled();
    await svc.onExperimentFailed({ projectId: PROJ, experimentId: 'e1', status: 'timeout', error: '超时' });
    const row = db.select().from(agentSchedules).where(eq(agentSchedules.id, id)).get()!;
    expect(row.lastStatus).toBe('ok');
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJ, kind: 'automation' }));
  });
});
