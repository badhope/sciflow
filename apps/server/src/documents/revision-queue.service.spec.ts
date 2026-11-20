import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { documents, projects, reviewComments } from '../db/schema';
import { DocumentsService } from './documents.service';

const PID = 'revision-queue-project';
const DOC_ID = 'revision-queue-doc';
const CONTENT = '# 标题\n\n## 方法\n\n原始方法正文。\n\n## 结果\n\n原始结果正文。\n';

async function waitForTerminal(svc: DocumentsService, queueId: string) {
  let latest = svc.getRevisionQueue(DOC_ID, queueId);
  for (let i = 0; i < 40; i += 1) {
    latest = svc.getRevisionQueue(DOC_ID, queueId);
    if (['completed', 'partial', 'failed', 'stopped'].includes(latest.status)) return latest;
    await new Promise((r) => setTimeout(r, 15));
  }
  return latest;
}

describe('DocumentsService revision queue', () => {
  let svc: DocumentsService;

  beforeEach(() => {
    db.delete(reviewComments).where(eq(reviewComments.documentId, DOC_ID)).run();
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
    db.delete(reviewComments).where(eq(reviewComments.documentId, DOC_ID)).run();
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

  it('auto-resolves the linked review comment only when the section actually changed', async () => {
    const commentId = 'queue-comment-1';
    db.insert(reviewComments).values({
      id: commentId,
      documentId: DOC_ID,
      reviewer: 'R1',
      commentText: '方法需要补重复次数',
      category: 'major',
      status: 'open',
      responseText: '',
      sectionRef: '',
      quote: '',
      anchorStart: null,
      anchorEnd: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run();
    const queue = svc.startRevisionQueue(DOC_ID, [
      { planItemId: 'R1', sectionTitle: '方法', reviewPoints: '补重复次数', reviewCommentId: commentId },
    ]);
    const latest = await waitForTerminal(svc, queue.id);
    expect(latest.status).toBe('completed');
    expect(latest.items[0].commentResolved).toBe(true);
    expect(latest.resolvedCommentIds).toContain(commentId);
    const row = db.select().from(reviewComments).where(eq(reviewComments.id, commentId)).get();
    expect(row?.status).toBe('resolved');
  });

  it('keeps completed queues as history and lets a historical queue be read by id', async () => {
    const q1 = svc.startRevisionQueue(DOC_ID, [{ planItemId: 'R1', sectionTitle: '方法', reviewPoints: '补重复次数' }]);
    await waitForTerminal(svc, q1.id);
    const q2 = svc.startRevisionQueue(DOC_ID, [{ planItemId: 'R2', sectionTitle: '结果', reviewPoints: '补误差范围' }]);
    await waitForTerminal(svc, q2.id);
    const history = svc.listRevisionQueues(DOC_ID).queues;
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe(q2.id);
    expect(history[1].id).toBe(q1.id);
    expect(svc.getRevisionQueue(DOC_ID, q1.id).status).toBe('completed');
  });

  it('retries a skipped item with a newly chosen section in a fresh auditable queue', async () => {
    const q1 = svc.startRevisionQueue(DOC_ID, [
      { planItemId: 'R3', excerpt: '整体语言需要更学术', reviewPoints: '润色全文' },
      { planItemId: 'R4', sectionTitle: '方法', reviewPoints: '补对照' },
    ]);
    await waitForTerminal(svc, q1.id);
    const skipped = q1.items.find((i) => i.status === 'skipped');
    expect(skipped).toBeTruthy();

    const retried = svc.retryRevisionQueueItem(DOC_ID, q1.id, skipped!.id, '结果');
    const latest = await waitForTerminal(svc, retried.id);
    expect(latest.items[0].status).toBe('done');
    expect(latest.items[0].sectionTitle).toBe('结果');
    expect(svc.getRevisionQueue(DOC_ID, q1.id).items.find((i) => i.id === skipped!.id)?.status).toBe('skipped');
    const history = svc.listRevisionQueues(DOC_ID).queues;
    expect(history[0].id).toBe(retried.id);
    expect(history).toHaveLength(2);
  });
});
