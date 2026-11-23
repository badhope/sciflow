import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { chatSessions, documents, projects, shareComments, shareLinks } from '../db/schema';
import { ShareService, sanitizeConversation } from './share.service';

const PROJ = 'test-share-001';
const service = new ShareService();
let docId = '';

function cleanup() {
  db.delete(shareComments).run();
  db.delete(shareLinks).where(eq(shareLinks.projectId, PROJ)).run();
  db.delete(documents).where(eq(documents.projectId, PROJ)).run();
  db.delete(chatSessions).where(eq(chatSessions.projectId, PROJ)).run();
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

  it('shares a sanitized conversation without tool results or attachments', () => {
    const now = Date.now();
    db.insert(chatSessions).values({
      id: 'sess-share-1', projectId: PROJ, title: '关于 RAG 的讨论', messageCount: 4, totalTokens: 30,
      messagesJson: JSON.stringify([
        { role: 'user', content: '问题一', attachments: [{ name: '私密.pdf' }] },
        { role: 'assistant', content: '回答一', reasoning: '内部推理', toolCalls: [{ name: 'x', result: 'secret' }] },
        { role: 'system', content: '系统提示不可见' },
        { role: 'assistant', content: '  第二段<script>alert(1)</script>  ' },
      ]), createdAt: now, updatedAt: now, lastMessageAt: now,
    }).run();
    const link = service.create({ projectId: PROJ, targetType: 'conversation', targetId: 'sess-share-1' });
    const pub = service.getPublic(link.token);
    expect(pub.targetType).toBe('conversation');
    expect(pub.messages.map((m) => m.content)).toEqual(['问题一', '回答一', '第二段<script>alert(1)</script>']);
    expect(JSON.stringify(pub)).not.toContain('私密.pdf');
    expect(JSON.stringify(pub)).not.toContain('内部推理');
    expect(JSON.stringify(pub)).not.toContain('secret');
  });

  it('comments are closed by default and can be opened, submitted and deleted', () => {
    const now = Date.now();
    db.insert(chatSessions).values({
      id: 'sess-share-1', projectId: PROJ, title: '讨论', messageCount: 1, totalTokens: 0,
      messagesJson: JSON.stringify([{ role: 'user', content: 'hi' }]), createdAt: now, updatedAt: now, lastMessageAt: now,
    }).run();
    const link = service.create({ projectId: PROJ, targetType: 'conversation', targetId: 'sess-share-1' });
    expect(() => service.addComment(link.token, { content: '你好' })).toThrow('未开启评论');
    const open = service.create({ projectId: PROJ, targetType: 'conversation', targetId: 'sess-share-1', allowComments: true });
    const c = service.addComment(open.token, { authorName: '<b>读者</b>', content: '这段结论有疑问' });
    expect(c.authorName).toBe('b读者/b');
    expect(service.listComments(open.token)).toHaveLength(1);
    service.deleteComment(open.id, c.id, PROJ);
    expect(service.listComments(open.token)).toHaveLength(0);
  });


  it('文档分享也展示已开启的只读评论', () => {
    const closed = service.create({ projectId: PROJ, targetType: 'document', targetId: docId });
    expect(closed.allowComments).toBe(false);
    const open = service.create({ projectId: PROJ, targetType: 'document', targetId: docId, allowComments: true });
    const c = service.addComment(open.token, { authorName: '读者', content: '文档评论' });
    const pub = service.getPublic(open.token);
    expect(pub.allowComments).toBe(true);
    expect(pub.comments.map((x) => x.content)).toEqual(['文档评论']);
    expect(pub.comments[0].id).toBe(c.id);
    service.deleteComment(open.id, c.id, PROJ);
    expect(service.getPublic(open.token).comments).toEqual([]);
  });
  it('sanitizeConversation drops unknown roles and caps content', () => {
    expect(sanitizeConversation('not-json')).toEqual([]);
    expect(sanitizeConversation(JSON.stringify([{ role: 'tool', content: 'x' }, { role: 'user', content: '\u0000ok' }]))).toEqual([{ role: 'user', content: 'ok' }]);
  });

  it('rejects a document from another project', () => {
    expect(() => service.create({ projectId: PROJ, targetType: 'document', targetId: 'missing' })).toThrow('文档不存在');
  });
});
