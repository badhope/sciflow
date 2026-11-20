import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/src/database';
import { projects, knowledgeDocs, knowledgeChunks } from '../../db/src/schema';
import { KnowledgeService } from './knowledge.service';
import type { AiService } from '../../ai/src/ai.service';
import type { EmbeddingService } from './embedding.service';

function fakeDeps() {
  const ai = {
    complete: async () => 'ok',
    completeStructured: async () => ({ ok: true }),
    knowledgeQa: async (_q: string, _ctx: string) => 'answer',
  } as unknown as AiService;
  const embedding = {
    embedBatch: async (texts: string[]) => texts.map(() => Buffer.alloc(384 * 4)),
    embedOne: async () => Buffer.alloc(384 * 4),
    embed: async () => Buffer.alloc(384 * 4),
  } as unknown as EmbeddingService;
  return { ai, embedding };
}

describe('KnowledgeService.searchPassages：跨 chunk 全文检索', () => {
  let pid: string;
  let docId: string;
  let svc: KnowledgeService;

  beforeEach(async () => {
    pid = randomUUID();
    docId = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: '跨块检索测试', description: '', createdAt: now, updatedAt: now }).run();
    db.insert(knowledgeDocs).values({
      id: docId,
      projectId: pid,
      name: '长方法节论文',
      type: 'text',
      chunkCount: 5,
      createdAt: now,
    }).run();
    const rows = [
      '引言：异构图节点分类已有大量工作。',
      '方法背景：消息传递需要聚合多跳邻居特征。',
      '核心步骤：跨块扩展测试词命中这里，先计算邻居权重，再执行加权聚合。',
      '消融设置：去掉多跳聚合会显著掉点。',
      '讨论：长尾节点仍然不稳定。',
    ];
    rows.forEach((content, seq) => {
      db.insert(knowledgeChunks).values({
        id: randomUUID(),
        docId,
        content,
        seq,
        context: '论文上下文',
        embedding: null,
      }).run();
    });
    const { ai, embedding } = fakeDeps();
    svc = new KnowledgeService(ai, embedding);
  });

  afterEach(() => {
    db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, docId)).run();
    db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, docId)).run();
    db.delete(projects).where(eq(projects.id, pid)).run();
  });

  it('命中块向前后各扩一块，返回 passage 范围与邻块正文', async () => {
    const hits = await svc.searchPassages(pid, '跨块扩展测试词', 5, 1);
    expect(hits.length).toBeGreaterThan(0);
    const p = hits[0];
    expect(p.docId).toBe(docId);
    expect(p.startSeq).toBe(1);
    expect(p.endSeq).toBe(3);
    expect(p.chunkCount).toBe(3);
    expect(p.matchedChunkIds.length).toBe(1);
    expect(p.content).toContain('消息传递需要聚合多跳邻居特征');
    expect(p.content).toContain('消融设置：去掉多跳聚合');
    expect(p.content).not.toContain('长尾节点仍然不稳定');
  });

  it('contextChunks=0 保持单块命中契约', async () => {
    const hits = await svc.searchPassages(pid, '跨块扩展测试词', 5, 0);
    expect(hits[0].startSeq).toBe(hits[0].seq);
    expect(hits[0].endSeq).toBe(hits[0].seq);
    expect(hits[0].chunkCount).toBe(1);
  });

  it('query 的 sources 带跨块范围，且回答使用扩展正文', async () => {
    const r = await svc.query(pid, '跨块扩展测试词');
    expect(r.answer).toBe('answer');
    expect(r.sources.length).toBeGreaterThan(0);
    const s = r.sources[0];
    expect(s.chunkStartSeq).toBe(1);
    expect(s.chunkEndSeq).toBe(3);
    expect(s.chunkCount).toBe(3);
    expect(s.chunkText).toContain('消息传递需要聚合多跳邻居特征');
  });
});
