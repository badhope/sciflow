import { describe, expect, it } from 'vitest';
import { mmrSelect, normalizeScores } from './mmr';
import { resolveEmbeddingBackend, toVectorBlob, EMBEDDING_DIM } from './embedding-config';

/**
 * 检索层纯函数回归：
 *  - MMR 必须真的压掉「同一文档相邻块」的重复，而不是简单按分数排序
 *  - 嵌入后端选择必须与声明一致（此前唯一实现调用不存在的 API，等于永远 none）
 *  - 维度守卫必须拒绝非 384 维向量（否则 vec0 insert 抛错会把上传事务回滚）
 */

describe('normalizeScores', () => {
  it('min-max 归一化到 0-1', () => {
    expect(normalizeScores([1, 3, 5])).toEqual([0, 0.5, 1]);
  });
  it('全等分数统一给 1（避免除零）', () => {
    expect(normalizeScores([2, 2, 2])).toEqual([1, 1, 1]);
  });
  it('空数组返回空', () => {
    expect(normalizeScores([])).toEqual([]);
  });
});

describe('mmrSelect', () => {
  const chunk = (id: string, relevance: number, text: string) => ({ id, relevance, text });

  it('第一条永远是最相关的', () => {
    const picked = mmrSelect([chunk('a', 0.3, 'x'), chunk('b', 0.9, 'y'), chunk('c', 0.5, 'z')], 1);
    expect(picked[0].id).toBe('b');
  });

  it('相邻重复块被压掉：4 条几乎相同的块 + 1 条不同块，选 2 条时不同块必须入选', () => {
    const same = '这是一段关于图神经网络消息传递机制的长文本，用于测试多样性重排。';
    const cands = [
      chunk('a', 1.0, same + ' 变体一'),
      chunk('b', 0.99, same + ' 变体二'),
      chunk('c', 0.98, same + ' 变体三'),
      chunk('d', 0.97, same + ' 变体四'),
      chunk('e', 0.6, '完全不同的一段内容：贝叶斯推断与变分下界。'),
    ];
    const picked = mmrSelect(cands, 2, { lambda: 0.5 });
    expect(picked.map((p) => p.id)).toContain('e');
  });

  it('候选不足 k 时原样返回，不重复填充', () => {
    const picked = mmrSelect([chunk('a', 1, 'x')], 5);
    expect(picked).toHaveLength(1);
  });

  it('向量余弦优先于文本前缀（有向量时按语义判重）', () => {
    const cands = [
      { id: 'a', relevance: 1, text: 'text-a', vector: [1, 0, 0] },
      { id: 'b', relevance: 0.9, text: 'text-b', vector: [0.99, 0.01, 0] }, // 与 a 语义几乎相同
      { id: 'c', relevance: 0.5, text: 'text-c', vector: [0, 1, 0] }, // 正交，语义不同
    ];
    const picked = mmrSelect(cands, 2, { lambda: 0.5 });
    expect(picked.map((p) => p.id)).toEqual(['a', 'c']);
  });
});

describe('resolveEmbeddingBackend', () => {
  it('显式 local 且模型存在 → local', () => {
    expect(resolveEmbeddingBackend({ provider: 'local', hasLocalModel: true, aiConfigured: true })).toBe('local');
  });
  it('显式 local 但模型缺失 → none（不偷偷改走 api）', () => {
    expect(resolveEmbeddingBackend({ provider: 'local', hasLocalModel: false, aiConfigured: true })).toBe('none');
  });
  it('显式 api 且 AI 已配置 → api', () => {
    expect(resolveEmbeddingBackend({ provider: 'api', hasLocalModel: false, aiConfigured: true })).toBe('api');
  });
  it('auto：本地模型优先于远程', () => {
    expect(resolveEmbeddingBackend({ hasLocalModel: true, aiConfigured: true })).toBe('local');
  });
  it('auto：无本地模型但 AI 已配置 → api', () => {
    expect(resolveEmbeddingBackend({ hasLocalModel: false, aiConfigured: true })).toBe('api');
  });
  it('auto：mock 模式不访问外网 → none', () => {
    expect(resolveEmbeddingBackend({ hasLocalModel: false, aiConfigured: true, mockMode: true })).toBe('none');
  });
});

describe('toVectorBlob', () => {
  it('384 维转 BLOB，字节数 = 384×4', () => {
    const blob = toVectorBlob(new Array(EMBEDDING_DIM).fill(0.5));
    expect(blob).not.toBeNull();
    expect(blob!.byteLength).toBe(EMBEDDING_DIM * 4);
  });
  it('维度不符返回 null（防止 vec0 insert 抛错回滚整个上传事务）', () => {
    expect(toVectorBlob([1, 2, 3])).toBeNull();
    expect(toVectorBlob(new Array(768).fill(0))).toBeNull();
  });
  it('空值返回 null', () => {
    expect(toVectorBlob(null)).toBeNull();
    expect(toVectorBlob(undefined)).toBeNull();
  });
});
