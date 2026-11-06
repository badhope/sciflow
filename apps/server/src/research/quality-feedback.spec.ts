import { describe, expect, it } from 'vitest';
import { structureFeedback } from './quality-feedback';

const DOC = `# 摘要

摘要正文。

## 引言

引言正文。

## 方法

方法正文。

## 实验

实验正文。
`;

describe('structureFeedback', () => {
  it('splits feedback into discrete items', () => {
    const items = structureFeedback('第一处问题描述足够长；第二处问题描述也足够长。', DOC);
    expect(items.length).toBe(2);
  });

  it('locates an item to an explicitly named section', () => {
    const items = structureFeedback('方法部分缺少收敛性证明，需要补充。', DOC);
    expect(items[0].section).toBe('方法');
  });

  it('leaves section empty when no section is named', () => {
    const items = structureFeedback('整体表述偏口语化，需要统一学术语气。', DOC);
    expect(items[0].section).toBe('');
  });

  it('classifies severity', () => {
    const items = structureFeedback('严重缺陷：实验无法复现。\n引用格式不一致。\n个别错别字。', DOC);
    expect(items[0].severity).toBe('blocker');
    expect(items[1].severity).toBe('major');
    expect(items[2].severity).toBe('minor');
  });

  it('maps dimension keys matching report scores', () => {
    const items = structureFeedback('参考文献著录不符合 GB/T 7714。\n图表编号不连续。', DOC);
    expect(items[0].dimension).toBe('citation');
    expect(items[1].dimension).toBe('figures');
  });

  it('returns an empty list for empty feedback', () => {
    expect(structureFeedback('', DOC)).toEqual([]);
  });

  it('is deterministic for identical input', () => {
    const a = structureFeedback('方法部分缺少对比实验。', DOC);
    const b = structureFeedback('方法部分缺少对比实验。', DOC);
    expect(a).toEqual(b);
  });
});
