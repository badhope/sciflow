import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { documents, projects, shareLinks } from '../db/schema';
import { ShareService } from './share.service';

const PROJ = 'test-share-001';
const service = new ShareService();
let docId = '';

function cleanup() {
  db.delete(shareLinks).where(eq(shareLinks.projectId, PROJ)).run();
  db.delete(documents).where(eq(documents.projectId, PROJ)).run();
  db.delete(projects).where(eq(projects.id, PROJ)).run();
}

describe('ShareService', () => {
  beforeEach(() => {
    cleanup();
    const now = Date.now();
    db.insert(projects).values({ id: PROJ, name: '分享测试项目', createdAt: now, updatedAt: now }).run();
    docId = `doc-${now}`;
    db.insert(documents).values({ id: docId, projectId: PROJ, title: '分享文档', content: '# 正文\n内容', version: 2, createdAt: now, updatedAt: now }).run();
  });
  afterEach(cleanup);

  it('creates a snapshot and reads it publicly', () => {
    const link = service.create({ projectId: PROJ, targetType: 'document', targetId: docId, expiresInDays: 7 });
    const pub = service.getPublic(link.token);
    expect(pub.title).toBe('分享文档');
    expect(pub.content).toContain('# 正文');
    expect(pub.projectTitle).toBe('分享测试项目');
    expect(pub.version).toBe(2);
  });

  it('stops reading after revoke', () => {
    const link = service.create({ projectId: PROJ, targetType: 'document', targetId: docId });
    service.revoke(link.id, PROJ);
    expect(() => service.getPublic(link.token)).toThrow('已撤销');
    expect(service.list(PROJ)).toHaveLength(0);
  });

  it('stops reading after expiry', () => {
    const link = service.create({ projectId: PROJ, targetType: 'document', targetId: docId });
    db.update(shareLinks).set({ expiresAt: Date.now() - 1000 }).where(eq(shareLinks.id, link.id)).run();
    expect(() => service.getPublic(link.token)).toThrow('已过期');
  });

  it('rejects a document from another project', () => {
    expect(() => service.create({ projectId: PROJ, targetType: 'document', targetId: 'missing' })).toThrow('文档不存在');
  });
});
