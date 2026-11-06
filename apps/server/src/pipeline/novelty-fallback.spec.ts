import { describe, expect, it } from 'vitest';
import { noveltyFallback } from './novelty-fallback';

describe('noveltyFallback', () => {
  it('is never reported as skipped and always marks the offline basis', () => {
    const r = noveltyFallback({ topic: '图神经网络 药物发现', localTitles: [] });
    expect(r.skipped).toBe(false);
    expect(r.offline).toBe(true);
    expect(r.basis).toBe('offline-fallback');
  });

  it('flags heavy overlap with the local library', () => {
    const r = noveltyFallback({
      topic: 'graph neural network drug discovery',
      localTitles: ['graph neural network for drug discovery', 'unrelated title about weather'],
    });
    expect(r.overlap).toBeGreaterThanOrEqual(60);
    expect(r.advice).toContain('本地库');
  });

  it('flags a too-broad topic as low specificity', () => {
    const r = noveltyFallback({ topic: '研究 方法 分析', localTitles: [] });
    expect(r.specificity).toBeLessThan(35);
    expect(r.advice).toContain('宽泛');
  });

  it('treats a specific topic with no local hits as worth a follow-up check', () => {
    const r = noveltyFallback({
      topic: '基于图对比学习的小样本分子性质预测与评测协议',
      localTitles: ['完全不同领域的临床研究'],
    });
    expect(r.specificity).toBeGreaterThanOrEqual(35);
    expect(r.advice).toContain('联网');
  });

  it('is deterministic', () => {
    const a = noveltyFallback({ topic: '图对比学习 分子性质预测', localTitles: ['x'] });
    const b = noveltyFallback({ topic: '图对比学习 分子性质预测', localTitles: ['x'] });
    expect(a).toEqual(b);
  });
});
