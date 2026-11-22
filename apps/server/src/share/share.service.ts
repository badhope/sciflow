import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/database';
import { documents, projects, shareLinks } from '../db/schema';

export interface ShareTarget {
  projectId: string;
  targetType: 'document';
  targetId: string;
  expiresInDays?: number;
}

@Injectable()
export class ShareService {
  create(input: ShareTarget) {
    const doc = db
      .select()
      .from(documents)
      .where(and(eq(documents.id, input.targetId), eq(documents.projectId, input.projectId)))
      .get();
    if (!doc) throw new NotFoundException('文档不存在或不属于该项目');
    const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
    const days = Math.min(365, Math.max(1, Math.floor(input.expiresInDays || 30)));
    const now = Date.now();
    const token = randomBytes(24).toString('hex');
    const id = randomBytes(12).toString('hex');
    const snapshot = JSON.stringify({
      title: doc.title,
      content: doc.content || '',
      version: doc.version || 1,
      updatedAt: doc.updatedAt,
      projectTitle: project?.name || '',
    });
    db.insert(shareLinks).values({
      id,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      token,
      title: doc.title,
      snapshot,
      createdAt: now,
      expiresAt: now + days * 24 * 60 * 60 * 1000,
    }).run();
    return this.view({ id, token, title: doc.title, createdAt: now, expiresAt: now + days * 24 * 60 * 60 * 1000 });
  }

  list(projectId: string) {
    return db.select().from(shareLinks)
      .where(and(eq(shareLinks.projectId, projectId), isNull(shareLinks.revokedAt)))
      .orderBy(desc(shareLinks.createdAt))
      .all()
      .map((row) => this.view(row));
  }

  revoke(id: string, projectId: string) {
    const row = db.select().from(shareLinks).where(and(eq(shareLinks.id, id), eq(shareLinks.projectId, projectId))).get();
    if (!row) throw new NotFoundException('分享链接不存在');
    if (!row.revokedAt) db.update(shareLinks).set({ revokedAt: Date.now() }).where(eq(shareLinks.id, id)).run();
    return this.view({ ...row, revokedAt: row.revokedAt || Date.now() });
  }

  getPublic(token: string) {
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get();
    if (!row) throw new NotFoundException('分享链接不存在');
    if (row.revokedAt) throw new NotFoundException('分享链接已撤销');
    if (row.expiresAt && row.expiresAt < Date.now()) throw new NotFoundException('分享链接已过期');
    let snapshot: Record<string, unknown> = {};
    try { snapshot = JSON.parse(row.snapshot || '{}') as Record<string, unknown>; } catch { /* 旧数据损坏时返回空快照 */ }
    return {
      title: String(snapshot.title || row.title || '未命名文档'),
      content: String(snapshot.content || ''),
      version: Number(snapshot.version || 1),
      projectTitle: String(snapshot.projectTitle || ''),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  private view(row: { id: string; token: string; title: string | null; createdAt: number; expiresAt: number | null; revokedAt?: number | null }) {
    return {
      id: row.id,
      token: row.token,
      title: row.title || '',
      path: `/share/${row.token}`,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
      revoked: !!row.revokedAt,
    };
  }
}
