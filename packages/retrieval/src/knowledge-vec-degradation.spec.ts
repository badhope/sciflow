import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/src/database';
import { projects, knowledgeDocs, knowledgeChunks } from '../../db/src/schema';
import { KnowledgeService } from './knowledge.service';
import type { AiService } from '../../ai/src/ai.service';
import type { EmbeddingService } from './embedding.service';

/**
 * sqlite-vec 缺失时的降级契约。
 *
 * 缺陷背景：`knowledge_chunks_embedding` 是 vec0 虚拟表，只在扩展加载成功时存在。
 * 上传走事务写 doc + chunk + vec0，扩展缺失时 prepare 直接抛 "no such table"，
 * 事务回滚 → 整个上传 500。而检索侧本来就有 FTS5/LIKE 兜底，
 * 「没有向量索引」不该导致连文档都存不进去（无 GPU / 无预编译包的部署都会踩到）。
 *
 * vitest 进程固定 SCIFLOW_NO_VEC=1（见 vitest.config.mts），
 * 所以这里天然就是「扩展未加载」环境——只要上传成功即证明降级生效。
 */
function fakeDeps() {
  const ai = { complete: async () => 'ok', completeStructured: async () => ({}) } as unknown as AiService;
  const embedding = {
    // 返回非 null 向量：只要有向量就会尝试写 vec0 表，正是会炸的那条路
    embedBatch: async (texts: string[]) => texts.map(() => Buffer.alloc(384 * 4)),
    embedOne: async () => Buffer.alloc(384 * 4),
    embed: async () => Buffer.alloc(384 * 4),
  } as unknown as EmbeddingService;
  return { ai, embedding };
}

describe('KnowledgeService：sqlite-vec 不可用时的降级', () => {
  let pid: string;
  let svc: KnowledgeService;

  beforeEach(() => {
    pid = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: '知识降级测试', description: '', createdAt: now, updatedAt: now }).run();
    const { ai, embedding } = fakeDeps();
    svc = new KnowledgeService(ai, embedding);
  });

  afterEach(() => {
    const docs = db.select({ id: knowledgeDocs.id }).from(knowledgeDocs).where(eq(knowledgeDocs.projectId, pid)).all();
    for (const d of docs) {
      db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, d.id)).run();
    }
    db.delete(knowledgeDocs).where(eq(knowledgeDocs.projectId, pid)).run();
    db.delete(projects).where(eq(projects.id, pid)).run();
  });

  it('向量表不存在时上传仍成功，且 chunk 已落库', async () => {
    const r = await svc.upload(pid, '无向量索引的文档', 'text', '消息传递机制是图神经网络的核心。'.repeat(40));
    expect(r.id).toBeTruthy();
    expect(r.chunkCount).toBeGreaterThan(0);

    const rows = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.docId, r.id)).all();
    expect(rows.length).toBe(r.chunkCount);
  });

  it('向量表不存在时删除文档不报错，且 chunk 一并清理', async () => {
    const r = await svc.upload(pid, '待删除文档', 'text', '内容'.repeat(400));
    await expect(svc.remove(r.id)).resolves.toEqual({ ok: true });
    const left = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.docId, r.id)).all();
    expect(left).toHaveLength(0);
  });

  it('降级后仍能通过全文检索命中（LIKE/FTS 兜底未被破坏）', async () => {
    const r = await svc.upload(pid, '检索兜底', 'text', '异构图神经网络在节点分类任务上通过消息传递聚合邻居特征。'.repeat(20));
    const hits = await svc.search(pid, '消息传递聚合邻居', 5);
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h: { docId?: string; doc_id?: string }) => (h.docId || h.doc_id) === r.id)).toBe(true);
  });
});
