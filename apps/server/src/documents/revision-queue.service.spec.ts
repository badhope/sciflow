import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { documents, projects } from '../db/schema';
import { DocumentsService } from './documents.service';

const PID = 'revision-queue-project';
const DOC_ID = 'revision-queue-doc';
const CONTENT = '# 标题\n\n## 方法\n\n原始方法正文。\n\n## 结果\n\n原始结果正文。\n';

describe('DocumentsService revision queue', () => {
  let svc: DocumentsService;

  beforeEach(() => {
    db.delete(documents).where(eq(documents.id, DOC_ID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
    const now = Date.now();
    db.insert(projects).values({ id: PID, name: '队列测试项目', description: '', status: 'active', createdAt: now, updatedAt: now }).run();
    db.insert(documents).values({ id: DOC_ID, projectId: PID, title: '队列测试', content: CONTENT, createdAt: now, updatedAt: now }).run();
    svc = new DocumentsService(
      {
        reviseSection: async (_title: string, body: string, points: string) => `${body}\n\n补充：${points}`,
      } as any,
      {} as any,
    );
  });

  afterEach(() => {
    db.delete(documents).where(eq(documents.id, DOC_ID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('runs mapped items serially and records before/after for each item', async () => {
    const queue = svc.startRevisionQueue(DOC_ID, [
      { planItemId: 'R1', sectionTitle: '方法', reviewPoints: '补重复次数' },
      { planItemId: 'R2', excerpt: '结果需要误差范围', suggestedAction: '补误差棒' },
    ]);
    expect(queue.items[0].status).toBe('pending');
    expect(queue.items[1].sectionTitle).toBe('结果');

    let latest = queue;
    for (let i = 0; i < 20; i += 1) {
      latest = svc.getRevisionQueue(DOC_ID, queue.id);
      if (latest.status === 'completed' || latest.status === 'partial' || latest.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(latest.status).toBe('completed');
    expect(latest.items[0].status).toBe('done');
    expect(latest.items[0].before).toBe('原始方法正文。');
    expect(latest.items[0].after).toContain('补充：补重复次数');
    expect(latest.items[1].sectionTitle).toBe('结果');
    expect(latest.items[1].after).toContain('补充：结果需要误差范围');
    const doc = svc.get(DOC_ID);
    expect(doc.content).toContain('补充：补重复次数');
    expect(doc.content).toContain('补充：结果需要误差范围');
  });

  it('marks unmatched plan items as skipped instead of guessing a section', () => {
    const queue = svc.startRevisionQueue(DOC_ID, [
      { planItemId: 'R3', excerpt: '整体语言需要更学术', reviewPoints: '润色全文' },
      { planItemId: 'R4', sectionTitle: '方法', reviewPoints: '补对照' },
    ]);
    expect(queue.items[0].status).toBe('skipped');
    expect(queue.items[0].error).toContain('没有点名任何现有章节');
    expect(queue.items[1].status).toBe('pending');
  });

  it('stop marks pending items skipped and lets the running item finish', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    svc = new DocumentsService(
      {
        reviseSection: async (_title: string, body: string, points: string) => {
          calls += 1;
          await gate;
          return `${body}\n\n补充：${points}`;
        },
      } as any,
      {} as any,
    );
    const queue = svc.startRevisionQueue(DOC_ID, [
      { planItemId: 'R5', sectionTitle: '方法', reviewPoints: '补重复次数' },
      { planItemId: 'R6', sectionTitle: '结果', reviewPoints: '补误差范围' },
    ]);
    for (let i = 0; i < 20; i += 1) {
      if (svc.getRevisionQueue(DOC_ID, queue.id).items[0].status === 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const stopped = svc.stopRevisionQueue(DOC_ID, queue.id);
    expect(stopped.status).toBe('stopped');
    expect(stopped.items[0].status).toBe('running');
    expect(stopped.items[1].status).toBe('skipped');
    release();
    for (let i = 0; i < 20; i += 1) {
      if (svc.getRevisionQueue(DOC_ID, queue.id).items[0].status === 'done') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    const latest = svc.getRevisionQueue(DOC_ID, queue.id);
    expect(latest.status).toBe('stopped');
    expect(latest.items[0].status).toBe('done');
    expect(latest.items[0].after).toContain('补充：补重复次数');
    expect(latest.items[1].status).toBe('skipped');
    expect(calls).toBe(1);
  });
});
