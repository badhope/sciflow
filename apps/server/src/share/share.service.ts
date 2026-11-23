import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/database';
import { chatSessions, documents, projects, shareComments, shareLinks } from '../db/schema';

export interface ShareTarget {
  projectId: string;
  targetType: 'document' | 'conversation';
  targetId: string;
  expiresInDays?: number;
  allowComments?: boolean;
}

export interface ShareMessage { role: 'user' | 'assistant'; content: string }

/** 对话快照只保留可见气泡；工具结果、推理、附件名一律不入公开快照。 */
export function sanitizeConversation(raw: string): ShareMessage[] {
  let rows: unknown[] = [];
  try { rows = JSON.parse(raw || '[]') as unknown[]; } catch { return []; }
  const out: ShareMessage[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as { role?: string; content?: unknown };
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    const content = String(r.content || '').replace(/\u0000/g, '').trim();
    if (!content) continue;
    out.push({ role: r.role, content: content.slice(0, 50_000) });
    if (out.length >= 200) break;
  }
  return out;
}

export function sanitizeComment(input: { authorName?: string; content?: string }) {
  const authorName = String(input.authorName || '匿名读者').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || '匿名读者';
  const content = String(input.content || '').replace(/\u0000/g, '').trim().slice(0, 1000);
  if (content.length < 2) throw new BadRequestException('评论至少 2 个字');
  return { authorName, content };
}

@Injectable()
export class ShareService {
  create(input: ShareTarget) {
    const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
    if (!project) throw new NotFoundException('项目不存在');
    let title = '';
    let snapshot: Record<string, unknown>;
    if (input.targetType === 'conversation') {
      const session = db.select().from(chatSessions)
        .where(and(eq(chatSessions.id, input.targetId), eq(chatSessions.projectId, input.projectId)))
        .get();
      if (!session) throw new NotFoundException('会话不存在或不属于该项目');
      title = session.title || '未命名会话';
      snapshot = {
        kind: 'conversation',
        title,
        messages: sanitizeConversation(session.messagesJson || '[]'),
        projectTitle: project.name || '',
        allowComments: !!input.allowComments,
      };
    } else {
      const doc = db.select().from(documents)
        .where(and(eq(documents.id, input.targetId), eq(documents.projectId, input.projectId)))
        .get();
      if (!doc) throw new NotFoundException('文档不存在或不属于该项目');
      title = doc.title;
      snapshot = {
        kind: 'document',
        title: doc.title,
        content: doc.content || '',
        version: doc.version || 1,
        updatedAt: doc.updatedAt,
        projectTitle: project.name || '',
        allowComments: !!input.allowComments,
      };
    }
    const days = Math.min(365, Math.max(1, Math.floor(input.expiresInDays || 30)));
    const now = Date.now();
    const token = randomBytes(24).toString('hex');
    const id = randomBytes(12).toString('hex');
    db.insert(shareLinks).values({
      id,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      token,
      title,
      snapshot: JSON.stringify(snapshot),
      createdAt: now,
      expiresAt: now + days * 24 * 60 * 60 * 1000,
      allowComments: input.allowComments ? 1 : 0,
    }).run();
    return this.view({ id, token, title, createdAt: now, expiresAt: now + days * 24 * 60 * 60 * 1000, allowComments: input.allowComments ? 1 : 0 });
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
    const row = this.activeShare(token);
    let snapshot: Record<string, unknown> = {};
    try { snapshot = JSON.parse(row.snapshot || '{}') as Record<string, unknown>; } catch { /* 旧数据损坏时返回空快照 */ }
    const targetType = row.targetType === 'conversation' ? 'conversation' : 'document';
    // 只读评论对文档和对话都开放；是否展示只看分享开关，不能按 targetType 吞掉。
    const comments = row.allowComments ? this.listComments(row.token) : [];
    return {
      targetType,
      title: String(snapshot.title || row.title || '未命名内容'),
      content: targetType === 'document' ? String(snapshot.content || '') : '',
      messages: targetType === 'conversation' ? sanitizeConversation(JSON.stringify(snapshot.messages || [])) : [],
      version: Number(snapshot.version || 1),
      projectTitle: String(snapshot.projectTitle || ''),
      allowComments: !!row.allowComments,
      comments,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  listComments(token: string) {
    const row = this.activeShare(token);
    return db.select().from(shareComments)
      .where(and(eq(shareComments.shareId, row.id), eq(shareComments.status, 'visible')))
      .orderBy(asc(shareComments.createdAt)).all()
      .map((c) => ({ id: c.id, authorName: c.authorName || '匿名读者', content: c.content, createdAt: c.createdAt }));
  }

  addComment(token: string, input: { authorName?: string; content?: string }) {
    const row = this.activeShare(token);
    if (!row.allowComments) throw new BadRequestException('该分享未开启评论');
    const clean = sanitizeComment(input);
    const id = randomBytes(12).toString('hex');
    db.insert(shareComments).values({ id, shareId: row.id, authorName: clean.authorName, content: clean.content, status: 'visible', createdAt: Date.now() }).run();
    return { id, ...clean, createdAt: Date.now() };
  }

  deleteComment(shareId: string, commentId: string, projectId: string) {
    const share = db.select().from(shareLinks).where(and(eq(shareLinks.id, shareId), eq(shareLinks.projectId, projectId))).get();
    if (!share) throw new NotFoundException('分享链接不存在');
    const comment = db.select().from(shareComments).where(and(eq(shareComments.id, commentId), eq(shareComments.shareId, shareId))).get();
    if (!comment) throw new NotFoundException('评论不存在');
    db.update(shareComments).set({ status: 'hidden' }).where(eq(shareComments.id, commentId)).run();
    return { deleted: true };
  }

  commentsForShare(shareId: string, projectId: string) {
    const share = db.select().from(shareLinks).where(and(eq(shareLinks.id, shareId), eq(shareLinks.projectId, projectId))).get();
    if (!share) throw new NotFoundException('分享链接不存在');
    return db.select().from(shareComments).where(eq(shareComments.shareId, shareId)).orderBy(desc(shareComments.createdAt)).all();
  }

  private activeShare(token: string) {
    const row = db.select().from(shareLinks).where(eq(shareLinks.token, token)).get();
    if (!row) throw new NotFoundException('分享链接不存在');
    if (row.revokedAt) throw new NotFoundException('分享链接已撤销');
    if (row.expiresAt && row.expiresAt < Date.now()) throw new NotFoundException('分享链接已过期');
    return row;
  }

  private view(row: {
    id: string; token: string; title: string | null; createdAt: number; expiresAt: number | null;
    revokedAt?: number | null; targetType?: string; allowComments?: number | null;
  }) {
    return {
      id: row.id,
      token: row.token,
      title: row.title || '',
      targetType: row.targetType === 'conversation' ? 'conversation' : 'document',
      allowComments: !!row.allowComments,
      path: `/share/${row.token}`,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt ?? null,
      revoked: !!row.revokedAt,
    };
  }
}
