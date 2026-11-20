import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../db/database';
import { projects, documents, reviewComments } from '../db/schema';
import { BUNDLE_TABLES, bundleSelectSql } from './project-bundle';
import { ProjectsService } from './projects.service';

/**
 * 项目包导出/导入的间接子表回归。
 *
 * 缺陷背景：`review_comment` 只有 `document_id`，没有 `project_id`。
 * 旧 BUNDLE_TABLES 统一按 `project_id` 查询，异常被 catch 吞掉 →
 * 导出包里 `reviewComments` 恒为空；导入时又强塞 `projectId`，
 * 即使手工塞了行也会因目标表无该列而整行失败。
 */
const PID = 'test-bundle-project';
const DOC = 'test-bundle-doc';
const COMMENT = 'test-bundle-review-1';

function cleanupProject(id: string) {
  try {
    db.delete(reviewComments).where(eq(reviewComments.documentId, DOC)).run();
    db.delete(documents).where(eq(documents.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
  } catch {
    /* 表可能已被级联清理 */
  }
}

describe('项目包导出/导入：间接子表按父表定位', () => {
  const svc = new ProjectsService();
  let importedId = '';

  beforeEach(() => {
    cleanupProject(PID);
    const now = Date.now();
    db.insert(projects).values({ id: PID, name: '项目包间接子表测试', description: '', status: 'active', createdAt: now, updatedAt: now }).run();
    db.insert(documents).values({ id: DOC, projectId: PID, title: '带审稿意见的稿件', content: '正文', status: 'draft', createdAt: now, updatedAt: now }).run();
    db.insert(reviewComments).values({
      id: COMMENT,
      documentId: DOC,
      reviewer: '审稿人 A',
      commentText: '方法节缺少重复实验说明。',
      category: 'method',
      status: 'open',
      sectionRef: '方法',
      createdAt: now,
      updatedAt: now,
    }).run();
  });

  afterEach(() => {
    if (importedId) svc.remove(importedId);
    cleanupProject(PID);
  });

  it('所有导出表查询都能在真实 schema 上执行', () => {
    for (const spec of BUNDLE_TABLES) {
      expect(() => sqlite.prepare(bundleSelectSql(spec)).all('missing-project'), spec.key).not.toThrow();
    }
  });

  it('导出包包含审稿意见，而不是静默为空', () => {
    const bundle = svc.exportBundle(PID);
    expect(bundle.counts.reviewComments).toBe(1);
    expect(bundle.tables.reviewComments).toHaveLength(1);
    expect(bundle.tables.reviewComments[0].documentId).toBe(DOC);
    expect(bundle.tables.reviewComments[0].commentText).toContain('重复实验');
  });

  it('导入后审稿意见仍在，documentId 已重映射到新文档', () => {
    const bundle = svc.exportBundle(PID);
    const imported = svc.importBundle(bundle);
    importedId = imported.projectId;
    expect(imported.stats.reviewComments).toBe(1);

    const doc = db.select().from(documents).where(eq(documents.projectId, imported.projectId)).all()[0];
    expect(doc).toBeTruthy();
    const newDocId = doc.id;
    expect(newDocId).not.toBe(DOC);

    const comments = db.select().from(reviewComments).where(eq(reviewComments.documentId, newDocId)).all();
    expect(comments).toHaveLength(1);
    expect(comments[0].commentText).toContain('重复实验');
  });
});
