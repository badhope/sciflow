import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/database';
import {
  citations, documents, experiments, projects, qualityReports, references, reviewComments,
} from '../db/schema';
import { DocumentsService } from './documents.service';
import { ReferencesService } from '../references/references.service';

/**
 * 文档/引用完整性回归（2026-10-23 审计 C1/C2/H1/H2/H4/H5）。
 * 全部走真实 SQLite：这组缺陷的共同点是「无外键 + service 手写级联 + CSL 按 id 去重」，
 * mock 掉数据库就测不出来。
 */

const PROJ = 'test-doc-integrity-001';

const fakeAi = {
  configured: false,
  config: { model: 'stub' },
} as unknown as ConstructorParameters<typeof ReferencesService>[0];

describe('文档与引用完整性', () => {
  const refs = new ReferencesService(fakeAi);
  const docs = new DocumentsService(fakeAi, refs);
  let docId = '';

  const cleanup = () => {
    const ids = db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, PROJ)).all().map((d) => d.id);
    if (ids.length) {
      db.delete(citations).where(inArray(citations.documentId, ids)).run();
      db.delete(qualityReports).where(inArray(qualityReports.documentId, ids)).run();
      db.delete(reviewComments).where(inArray(reviewComments.documentId, ids)).run();
      db.delete(experiments).where(inArray(experiments.documentId, ids)).run();
    }
    db.delete(documents).where(eq(documents.projectId, PROJ)).run();
    const refIds = db.select({ id: references.id }).from(references).where(eq(references.projectId, PROJ)).all().map((r) => r.id);
    if (refIds.length) db.delete(citations).where(inArray(citations.referenceId, refIds)).run();
    db.delete(references).where(eq(references.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();
    docId = '';
  };

  beforeEach(() => {
    cleanup();
    db.insert(projects).values({ id: PROJ, name: 'integrity', createdAt: Date.now(), updatedAt: Date.now() }).run();
    docId = docs.create(PROJ, { title: '完整性测试' }).id;
  });
  afterEach(cleanup);

  it('PATCH 只接受白名单字段：projectId/id/version 不可被改写（C1）', () => {
    docs.update(docId, { title: '新标题', projectId: 'hijacked', id: 'evil', version: 99 });
    const row = db.select().from(documents).where(eq(documents.id, docId)).get();
    expect(row).toBeTruthy();
    expect(row!.projectId).toBe(PROJ);
    expect(row!.version).toBe(1);
    expect(row!.title).toBe('新标题');
    expect(db.select().from(documents).where(eq(documents.id, 'evil')).get()).toBeUndefined();
  });

  it('全文恢复历史版本：恢复前自动快照，可再恢复回去', () => {
    docs.update(docId, { content: '版本 A 正文' });
    docs.update(docId, { content: '版本 B 正文' });
    const before = docs.get(docId);
    expect(before.content).toBe('版本 B 正文');
    expect(before.version).toBe(3);
    const versions = JSON.parse(before.versions) as { version: number; content: string }[];
    const v2 = versions.find((v) => v.content === '版本 A 正文');
    expect(v2).toBeTruthy();

    const restored = docs.restoreVersion(docId, v2!.version);
    expect(restored.changed).toBe(true);
    expect(restored.content).toBe('版本 A 正文');
    expect(restored.version).toBe(4);
    const after = docs.get(docId);
    expect(after.content).toBe('版本 A 正文');
    const snapshots = JSON.parse(after.versions) as { version: number; content: string; commitMessage?: string }[];
    expect(snapshots.some((v) => v.content === '版本 B 正文' && /恢复全文/.test(v.commitMessage || ''))).toBe(true);

    // 再恢复到刚才的 B，验证「恢复动作本身也可回退」
    const b = snapshots.find((v) => v.content === '版本 B 正文');
    const back = docs.restoreVersion(docId, b!.version);
    expect(back.content).toBe('版本 B 正文');
  });

  it('删除文档级联清理质检/审稿意见/实验（H2）', () => {
    const now = Date.now();
    db.insert(qualityReports).values({ id: 'qr-1', documentId: docId, totalScore: 70, scores: '{}', feedback: '', createdAt: now }).run();
    db.insert(reviewComments).values({ id: 'rc-1', documentId: docId, reviewer: 'r', commentText: 'c', createdAt: now, updatedAt: now }).run();
    db.insert(experiments).values({ id: 'ex-1', projectId: PROJ, documentId: docId, code: 'print(1)', createdAt: now, updatedAt: now }).run();
    docs.remove(docId);
    expect(db.select().from(qualityReports).where(eq(qualityReports.documentId, docId)).all()).toHaveLength(0);
    expect(db.select().from(reviewComments).where(eq(reviewComments.documentId, docId)).all()).toHaveLength(0);
    expect(db.select().from(experiments).where(eq(experiments.documentId, docId)).all()).toHaveLength(0);
    docId = '';
  });

  it('删除文献同时清理 citation/筛选/编码子行（H1）', () => {
    const a = refs.create(PROJ, { title: 'Ref A', authors: ['Alice A'], year: 2020 });
    const b = refs.create(PROJ, { title: 'Ref B', authors: ['Bob B'], year: 2021 });
    const c = refs.create(PROJ, { title: 'Ref C', authors: ['Cara C'], year: 2022 });
    [a, b, c].forEach((r, i) => {
      db.insert(citations).values({ id: `cit-${i}`, documentId: docId, referenceId: r.id, createdAt: Date.now() + i }).run();
    });
    refs.remove(b.id);
    const rows = db.select().from(citations).where(eq(citations.documentId, docId)).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.referenceId)).not.toContain(b.id);
  });

  it('顺序编码样式渲染全部引用，不被 CSL id 去重吞掉（C2）', () => {
    const list = [['Alpha', 2019], ['Beta', 2020], ['Gamma', 2021]] as const;
    list.forEach(([title, year], i) => {
      const r = refs.create(PROJ, { title, authors: [`${title} Author`], year });
      db.insert(citations).values({ id: `c-${i}`, documentId: docId, referenceId: r.id, createdAt: Date.now() + i }).run();
    });
    docs.update(docId, { content: '正文锚点[1][2][3]。' });
    for (const style of ['ieee', 'vancouver', 'gbt', 'nature', 'acs']) {
      const out = docs.renderCitations(docId, style);
      expect(out.references, `${style} 应渲染 3 条`).toHaveLength(3);
    }
  });

  it('手动快照版本号不再与自动快照同号（H4）', () => {
    docs.update(docId, { content: '第一版内容' });
    docs.createSnapshot(docId, '手动快照');
    docs.update(docId, { content: '第二版内容' });
    const row = db.select().from(documents).where(eq(documents.id, docId)).get();
    const versions = JSON.parse(row!.versions || '[]') as { version: number }[];
    const nums = versions.map((v) => v.version);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('导出参考文献按 citation 插入序（H5）', () => {
    const order = [['Gamma', 2021], ['Alpha', 2019], ['Beta', 2020]] as const;
    order.forEach(([title, year], i) => {
      const r = refs.create(PROJ, { title, authors: [`${title} Author`], year });
      db.insert(citations).values({ id: `o-${i}`, documentId: docId, referenceId: r.id, createdAt: Date.now() + i }).run();
    });
    const out = docs.exportMarkdown(docId).markdown;
    expect(out.indexOf('Gamma')).toBeLessThan(out.indexOf('Alpha'));
    expect(out.indexOf('Alpha')).toBeLessThan(out.indexOf('Beta'));
  });
});
