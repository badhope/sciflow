import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, memoryLogs } from '../db/schema';
import { MemoryService } from './memory.service';
import { toVectorBlob } from '../knowledge/embedding.service';

const PID = 'memory-recall-spec-project';
const NOW = Date.now();

function unit(dim: number): number[] {
  const v = new Array(384).fill(0);
  v[dim] = 1;
  return v;
}

function fakeEmbedding() {
  return {
    embed: vi.fn(async (text: string) => toVectorBlob(text.includes('alpha') ? unit(0) : unit(1))),
    embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => toVectorBlob(t.includes('alpha') ? unit(0) : unit(1)))),
  };
}

describe('MemoryService recall', () => {
  beforeEach(() => {
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
    db.insert(projects).values({ id: PID, name: '记忆召回测试', description: '', status: 'active', createdAt: NOW, updatedAt: NOW }).run();
  });

  afterEach(() => {
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('无嵌入后端时按中英字面相关性召回，而不是只按时间', () => {
    const svc = new MemoryService();
    svc.add('episodic', '图神经网络在低资源文本分类上做对照实验，F1 提升不明显', PID, ['图神经网络', '低资源']);
    svc.add('procedural', '投稿前先检查期刊格式与参考文献样式', PID, ['投稿', '格式']);

    return svc.recall(PID, '低资源分类', 2).then((hits) => {
      expect(hits[0].content).toContain('低资源');
      expect(hits[0].match).toBe('lexical');
      expect(hits[0].score).toBeGreaterThan(0);
    });
  });

  it('有语义向量时优先语义相似，并懒补历史记忆向量', async () => {
    const embed = fakeEmbedding();
    const svc = new MemoryService(embed as never);
    svc.add('episodic', 'alpha experiment result', PID);
    svc.add('episodic', 'beta experiment result', PID);

    const hits = await svc.recall(PID, 'alpha', 2);
    expect(hits[0].content).toContain('alpha');
    expect(hits[0].match).toMatch(/semantic|hybrid/);
    expect(embed.embedBatch).toHaveBeenCalled();
    // 懒补后，下一次召回不需要再为两条历史记忆算嵌入
    embed.embedBatch.mockClear();
    await svc.recall(PID, 'alpha', 2);
    expect(embed.embedBatch).not.toHaveBeenCalled();
  });

  it('列表不把 embedding BLOB 暴露给 API', () => {
    const svc = new MemoryService();
    svc.add('episodic', '内容', PID);
    const list = svc.list(undefined, undefined, PID);
    expect(list[0]).not.toHaveProperty('embedding');
  });
});
