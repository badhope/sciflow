import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { documents, projects, reviewComments } from '../db/schema';
import { ResearchService } from './research.service';

const PID = 'review-anchor-project';
const DOC_ID = 'review-anchor-doc';
const CONTENT = '# 方法\n\n我们使用图神经网络进行药物筛选。\n\n结果稳定。';

describe('ResearchService review anchors', () => {
  const svc = new ResearchService({} as any);

  beforeEach(() => {
    db.delete(reviewComments).where(eq(reviewComments.documentId, DOC_ID)).run();
    db.delete(documents).where(eq(documents.id, DOC_ID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
    const now = Date.now();
    db.insert(projects).values({ id: PID, name: '锚点测试项目', description: '', status: 'active', createdAt: now, updatedAt: now }).run();
    db.insert(documents).values({ id: DOC_ID, projectId: PID, title: '锚点测试', content: CONTENT, createdAt: now, updatedAt: now }).run();
  });

  afterEach(() => {
    db.delete(reviewComments).where(eq(reviewComments.documentId, DOC_ID)).run();
    db.delete(documents).where(eq(documents.id, DOC_ID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('stores the exact quote and offsets', () => {
    const created = svc.addReviewComments(DOC_ID, [
      { reviewer: '审稿人 2', commentText: '这句话的方法描述不够具体。', quote: '我们使用图神经网络进行药物筛选。' },
    ]);
    expect(created).toHaveLength(1);
    expect(created[0].quote).toBe('我们使用图神经网络进行药物筛选。');
    expect(created[0].anchorStart).toBe(CONTENT.indexOf('我们使用图神经网络进行药物筛选。'));
    expect(created[0].anchorEnd).toBe(CONTENT.indexOf('我们使用图神经网络进行药物筛选。') + '我们使用图神经网络进行药物筛选。'.length);
  });

  it('rejects a quote that is not in the document, without partially inserting rows', () => {
    expect(() =>
      svc.addReviewComments(DOC_ID, [
        { reviewer: '审稿人 1', commentText: '这条可以插入。' },
        { reviewer: '审稿人 2', commentText: '这条引文已过期。', quote: '正文里没有这句话。' },
      ]),
    ).toThrow(/唯一定位/);
    expect(svc.listReviewComments(DOC_ID)).toHaveLength(0);
  });

  it('clears the anchor when an update sends an empty quote', () => {
    const created = svc.addReviewComments(DOC_ID, [
      { reviewer: '审稿人 1', commentText: '需要改。', quote: '结果稳定。' },
    ]);
    const updated = svc.updateReviewComment(created[0].id, { quote: '' });
    expect(updated?.quote).toBe('');
    expect(updated?.anchorStart).toBeNull();
    expect(updated?.anchorEnd).toBeNull();
  });
});
