import { describe, it, expect } from 'vitest';
import { sanitizeChapterBody, isBadSummary } from './longform.agent';

describe('长篇正文清洗', () => {
  it('剥掉与章节标题重复的首行标题，避免 compile 出现两个同名标题', () => {
    const raw = '## 第一章 午夜无邮戳\n\n雨停后雾更重了。';
    expect(sanitizeChapterBody(raw, '第一章 午夜无邮戳')).toBe('雨停后雾更重了。');
  });

  it('剥掉「第 X 章」形式的首行标题，即使标题文案略有差异', () => {
    const raw = '# 第二章 退潮缺席者\n北堤水闸响了一次。';
    expect(sanitizeChapterBody(raw, '第二章 退潮缺席者')).toBe('北堤水闸响了一次。');
  });

  it('不误删正文中间的二级标题', () => {
    const raw = '## 第一章 开篇\n\n第一段。\n\n## 场景二\n\n第二段。';
    expect(sanitizeChapterBody(raw, '第一章 开篇')).toContain('## 场景二');
  });

  it('对话式摘要会被判定为无效', () => {
    expect(isBadSummary('收到第一章。你希望我具体做哪项？可选：1. 润色')).toBe(true);
    expect(isBadSummary('周沉在邮局收到匿名信，前往旧码头，发现失踪者的鞋。')).toBe(false);
  });
});
