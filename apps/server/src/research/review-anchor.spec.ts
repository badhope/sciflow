import { describe, expect, it } from 'vitest';
import { resolveReviewAnchor } from './review-anchor';

const DOC = '# 方法\n\n我们使用图神经网络进行药物筛选。\n\n结果稳定。';

describe('resolveReviewAnchor', () => {
  it('locates a unique quote and returns exact offsets', () => {
    const anchor = resolveReviewAnchor(DOC, '我们使用图神经网络进行药物筛选。');
    expect(anchor).toEqual({
      quote: '我们使用图神经网络进行药物筛选。',
      start: DOC.indexOf('我们使用图神经网络进行药物筛选。'),
      end: DOC.indexOf('我们使用图神经网络进行药物筛选。') + '我们使用图神经网络进行药物筛选。'.length,
    });
  });

  it('uses the editor selection start to disambiguate a repeated quote', () => {
    const doc = '第一段重复句。\n\n第二段重复句。';
    const second = doc.lastIndexOf('重复句。');
    expect(resolveReviewAnchor(doc, '重复句。')).toBeNull();
    expect(resolveReviewAnchor(doc, '重复句。', second)).toEqual({ quote: '重复句。', start: second, end: second + 4 });
  });

  it('rejects a stale preferredStart that no longer matches the document', () => {
    expect(resolveReviewAnchor(DOC, '结果稳定。', 0)).toEqual({
      quote: '结果稳定。',
      start: DOC.indexOf('结果稳定。'),
      end: DOC.indexOf('结果稳定。') + 5,
    });
  });

  it('rejects empty, too short, missing and oversized quotes', () => {
    expect(resolveReviewAnchor(DOC, '')).toBeNull();
    expect(resolveReviewAnchor(DOC, '我')).toBeNull();
    expect(resolveReviewAnchor(DOC, '不存在的句子。')).toBeNull();
    expect(resolveReviewAnchor(DOC, 'x'.repeat(4001))).toBeNull();
  });

  it('trims outer whitespace while keeping the inner text exact', () => {
    const anchor = resolveReviewAnchor(DOC, '  结果稳定。  ');
    expect(anchor?.quote).toBe('结果稳定。');
  });
});
