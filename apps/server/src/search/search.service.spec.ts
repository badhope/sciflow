import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { chatSessions, documents, experiments, knowledgeChunks, knowledgeDocs, projects, references } from '../db/schema';
import { SearchService, buildSnippet, scoreHit } from './search.service';

const P = 'test-proj-search-001';

function seed() {
  const now = Date.now();
  db.insert(projects).values({ id: P, name: '叙事研究项目', description: '研究叙事身份与算法推荐', createdAt: now, updatedAt: now }).run();
  db.insert(documents).values({ id: 'd1', projectId: P, title: '算法推荐与叙事身份', content: '本文讨论算法推荐如何重塑叙事身份。', createdAt: now, updatedAt: now }).run();
  db.insert(chatSessions).values({ id: 'c1', projectId: P, title: '叙事身份讨论', summary: '关于算法推荐', messagesJson: JSON.stringify([{ role: 'user', content: '算法推荐会影响叙事身份吗？' }]), messageCount: 2, totalTokens: 10, createdAt: now, updatedAt: now, lastMessageAt: now, source: 'cloud' }).run();
  db.insert(experiments).values({ id: 'e1', projectId: P, goal: '检验算法推荐对叙事身份的影响', code: '', conclusion: '推荐多样性提升身份反思', createdAt: now, updatedAt: now }).run();
  db.insert(references).values({ id: 'r1', projectId: P, title: '算法推荐中的叙事身份', abstract: '综述算法推荐与叙事身份研究', authors: '[]', tags: '[]', createdAt: now }).run();
  db.insert(knowledgeDocs).values({ id: 'k1', projectId: P, name: '叙事身份读书笔记', type: 'markdown', chunkCount: 1, createdAt: now }).run();
  db.insert(knowledgeChunks).values({ id: 'kc1', docId: 'k1', content: '算法推荐让叙事身份碎片化。', seq: 0, context: '', createdAt: now }).run();
}

describe('search helpers', () => {
  it('片段围绕命中词', () => {
    expect(buildSnippet('前文 '.repeat(30) + '算法推荐' + ' 后文'.repeat(30), '算法推荐')).toContain('算法推荐');
  });
  it('标题命中权重高于正文', () => {
    expect(scoreHit('算法推荐', '正文', '算法推荐')).toBeGreaterThan(scoreHit('标题', '算法推荐', '算法推荐'));
  });
});

describe('SearchService', () => {
  const svc = new SearchService();
  beforeEach(() => seed());
  afterEach(() => {
    db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, 'k1')).run();
    db.delete(knowledgeDocs).where(eq(knowledgeDocs.projectId, P)).run();
    db.delete(references).where(eq(references.projectId, P)).run();
    db.delete(experiments).where(eq(experiments.projectId, P)).run();
    db.delete(chatSessions).where(eq(chatSessions.projectId, P)).run();
    db.delete(documents).where(eq(documents.projectId, P)).run();
    db.delete(projects).where(eq(projects.id, P)).run();
  });

  it('同一关键词命中六类并给出可跳转路由', () => {
    const hits = svc.search(P, '算法推荐');
    const types = new Set(hits.map((h) => h.type));
    expect(types).toEqual(new Set(['document', 'chat', 'project', 'experiment', 'reference', 'knowledge']));
    expect(hits.find((h) => h.type === 'document')?.route).toContain('/writing?doc=d1');
    expect(hits.find((h) => h.type === 'chat')?.route).toContain('/workspace?session=c1');
  });

  it('空查询与限定类型', () => {
    expect(svc.search(P, '   ')).toEqual([]);
    const only = svc.search(P, '算法推荐', 'document,reference');
    expect(new Set(only.map((h) => h.type))).toEqual(new Set(['document', 'reference']));
  });

  it('跨项目不泄露', () => {
    const hits = svc.search('another-project', '算法推荐');
    expect(hits).toEqual([]);
  });
});
