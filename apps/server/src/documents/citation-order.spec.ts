import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';

/**
 * 引用编号一致性回归（2026-10）。
 *
 * 契约：正文里的 [n] 锚点，与 GET /api/documents/:id/citations 返回的第 n 条，
 * 必须指向同一篇文献。列表顺序 = citations.createdAt 升序 = 首次插入顺序。
 *
 * 历史缺陷：批量插入共用同一毫秒时间戳 → ORDER BY createdAt 的先后不稳定 →
 * 重跑/手工增删后正文编号与列表错位。修复为「每次插入 createdAt 严格递增」。
 */

import { db } from '../db/database';
import { citations, documents, projects, references } from '../db/schema';
import { DocumentsService } from './documents.service';
import { ReferencesService } from '../references/references.service';

const TEST_PROJ = 'test-proj-cite-order-001';

/** 最小 AiService 桩：本组用例不触碰 AI 能力 */
const fakeAi = {
  configured: false,
  config: { model: 'stub' },
} as unknown as ConstructorParameters<typeof ReferencesService>[0];

describe('引用列表顺序（正文 [n] ↔ 列表第 n 条）', () => {
  const refs = new ReferencesService(fakeAi);
  const docs = new DocumentsService(fakeAi, refs);
  let docId = '';

  beforeEach(() => {
    db.delete(citations).where(eq(citations.documentId, docId || '__none__')).run();
    db.delete(documents).where(eq(documents.projectId, TEST_PROJ)).run();
    db.delete(references).where(eq(references.projectId, TEST_PROJ)).run();
    db.delete(projects).where(eq(projects.id, TEST_PROJ)).run();

    db.insert(projects).values({ id: TEST_PROJ, name: 'cite-order', createdAt: Date.now(), updatedAt: Date.now() }).run();
    docId = docs.create(TEST_PROJ, { title: '引用顺序测试' }).id;

    // 三篇文献，标题刻意乱序，确保排序不受标题影响
    for (const t of ['Zeta Paper', 'Alpha Paper', 'Mu Paper']) {
      refs.create(TEST_PROJ, { title: t, authors: ['Tester One'], year: 2024 });
    }
  });

  afterEach(() => {
    db.delete(citations).where(eq(citations.documentId, docId || '__none__')).run();
    db.delete(documents).where(eq(documents.projectId, TEST_PROJ)).run();
    db.delete(references).where(eq(references.projectId, TEST_PROJ)).run();
    db.delete(projects).where(eq(projects.id, TEST_PROJ)).run();
  });

  it('连续添加三条引用：列表顺序 = 添加顺序（模拟同一毫秒批量插入）', () => {
    const all = refs.list(TEST_PROJ);
    // 先解析好 ID，再连续插入——不放任何其他 DB 调用在中间，尽量落在同一毫秒内
    const order = ['Zeta Paper', 'Alpha Paper', 'Mu Paper'].map((t) => all.find((r) => r.title === t)!.id);
    for (const rid of order) refs.addCitation({ documentId: docId, referenceId: rid });

    const list = docs.listCitations(docId);
    // 顺序必须严格等于插入顺序，与耗时无关（同一毫秒也必须稳定）
    expect(list.map((c) => c.reference.title)).toEqual(['Zeta Paper', 'Alpha Paper', 'Mu Paper']);
  });

  it('createdAt 严格递增（保证 ORDER BY 稳定）', () => {
    const all = refs.list(TEST_PROJ);
    const ids = all.map((r) => r.id);
    for (const id of ids) refs.addCitation({ documentId: docId, referenceId: id });

    const list = docs.listCitations(docId);
    const stamps = list.map((c) => c.createdAt);
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
    }
  });

  it('重复添加同一文献幂等：不产生第二条、不改变原有位置', () => {
    const all = refs.list(TEST_PROJ);
    const [a, b] = all;
    refs.addCitation({ documentId: docId, referenceId: a.id });
    refs.addCitation({ documentId: docId, referenceId: b.id });
    refs.addCitation({ documentId: docId, referenceId: a.id }); // 重复

    const list = docs.listCitations(docId);
    expect(list).toHaveLength(2);
    expect(list[0].referenceId).toBe(a.id);
    expect(list[1].referenceId).toBe(b.id);
  });

  it('删除中间一条后，剩余顺序不变（编号会前移，但相对序稳定）', () => {
    const all = refs.list(TEST_PROJ);
    for (const r of all) refs.addCitation({ documentId: docId, referenceId: r.id });
    const before = docs.listCitations(docId);
    expect(before).toHaveLength(3);

    docs.removeCitation(before[1].id);
    const after = docs.listCitations(docId);
    expect(after).toHaveLength(2);
    expect(after[0].referenceId).toBe(before[0].referenceId);
    expect(after[1].referenceId).toBe(before[2].referenceId);
  });

  it('跨文档互不干扰：另一文档的引用不影响本文档顺序', () => {
    const other = docs.create(TEST_PROJ, { title: '另一个文档' });
    const all = refs.list(TEST_PROJ);
    // 先给「另一个文档」加两条，再给本文档加两条
    refs.addCitation({ documentId: other.id, referenceId: all[0].id });
    refs.addCitation({ documentId: other.id, referenceId: all[1].id });
    refs.addCitation({ documentId: docId, referenceId: all[2].id });
    refs.addCitation({ documentId: docId, referenceId: all[0].id });

    const mine = docs.listCitations(docId);
    expect(mine.map((c) => c.referenceId)).toEqual([all[2].id, all[0].id]);
    const theirs = docs.listCitations(other.id);
    expect(theirs.map((c) => c.referenceId)).toEqual([all[0].id, all[1].id]);

    docs.remove(other.id);
  });
});
