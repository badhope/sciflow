import { describe, expect, it } from 'vitest';
import { buildPassages, joinChunkTexts, type PassageChunk, type PassageHit } from './passage';

const CHUNKS: PassageChunk[] = [
  { id: 'c0', docId: 'd1', seq: 0, content: '方法开头的背景说明。' },
  { id: 'c1', docId: 'd1', seq: 1, content: '实验设置：三个数据集、五折交叉验证。' },
  { id: 'c2', docId: 'd1', seq: 2, content: '结果：准确率提升，但长尾节点仍不稳定。' },
  { id: 'c3', docId: 'd1', seq: 3, content: '讨论：长尾问题需要单独分析。' },
  { id: 'c4', docId: 'd1', seq: 4, content: '结论：方法仍可改进。' },
  { id: 'x0', docId: 'd2', seq: 0, content: '另一篇文档，不应被拼进来。' },
];

function hit(seq: number, score: number, id = `c${seq}`, docId = 'd1'): PassageHit {
  const chunk = CHUNKS.find((c) => c.id === id)!;
  return { id, docId, docName: docId === 'd1' ? '方法论文' : '其他', seq, content: chunk.content, score };
}

describe('joinChunkTexts', () => {
  it('removes the splitter overlap between adjacent chunks', () => {
    const prev = '第一段结尾：异构图神经网络需要聚合邻居特征。';
    const next = '异构图神经网络需要聚合邻居特征。第二段继续说明消息传递。';
    expect(joinChunkTexts([prev, next])).toBe(
      '第一段结尾：异构图神经网络需要聚合邻居特征。\n\n第二段继续说明消息传递。',
    );
  });

  it('keeps short repeated phrases instead of treating them as overlap', () => {
    expect(joinChunkTexts(['结果稳定。', '结果稳定。但误差较大。'])).toContain('但误差较大。');
  });
});

describe('buildPassages', () => {
  it('expands a hit by one chunk on each side', () => {
    const passages = buildPassages([hit(1, 100)], CHUNKS, { contextChunks: 1 });
    const p = passages[0];
    expect(p.startSeq).toBe(0);
    expect(p.endSeq).toBe(2);
    expect(p.chunkCount).toBe(3);
    expect(p.content).toContain('方法开头的背景说明。');
    expect(p.content).toContain('实验设置：三个数据集');
    expect(p.content).toContain('结果：准确率提升');
    expect(p.chunkIds).toEqual(['c0', 'c1', 'c2']);
    expect(p.matchedChunkIds).toEqual(['c1']);
  });

  it('merges overlapping windows from the same document', () => {
    const passages = buildPassages([hit(1, 100), hit(2, 80)], CHUNKS, { contextChunks: 1 });
    expect(passages).toHaveLength(1);
    const p = passages[0];
    expect(p.startSeq).toBe(0);
    expect(p.endSeq).toBe(3);
    expect(p.chunkCount).toBe(4);
    expect(p.matchedChunkIds).toEqual(['c1', 'c2']);
    expect(p.content).toContain('讨论：长尾问题');
  });

  it('never merges chunks across documents', () => {
    const passages = buildPassages([hit(1, 100), hit(0, 90, 'x0', 'd2')], CHUNKS, { contextChunks: 1 });
    expect(passages).toHaveLength(2);
    expect(passages.map((p) => p.docId).sort()).toEqual(['d1', 'd2']);
    expect(passages.find((p) => p.docId === 'd1')?.content).not.toContain('另一篇文档');
  });

  it('keeps a window intact when contextChunks is zero', () => {
    const passages = buildPassages([hit(2, 100)], CHUNKS, { contextChunks: 0 });
    expect(passages[0].startSeq).toBe(2);
    expect(passages[0].endSeq).toBe(2);
    expect(passages[0].chunkCount).toBe(1);
  });
});
