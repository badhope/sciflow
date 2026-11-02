import { describe, expect, it } from 'vitest';
import { applyMention, extractMentions, filterMentions, parseMentionQuery, type MentionItem } from './MentionPicker';

/**
 * `@` 提及的纯函数回归。
 *
 * 关键约束：只在词首触发（避免邮箱误触），选中后能正确替换，
 * 提交时能抽回被引用的标签。这些逻辑脱离 UI 单测，比点界面可靠得多。
 */

describe('parseMentionQuery', () => {
  it('行首 @ 触发', () => {
    expect(parseMentionQuery('@图神经', 4)).toEqual({ query: '图神经', start: 0 });
  });

  it('空格后的 @ 触发', () => {
    // '请看 @图神经' 共 7 个字符，光标在末尾
    expect(parseMentionQuery('请看 @图神经', 7)).toEqual({ query: '图神经', start: 3 });
  });

  it('邮箱等词中 @ 不触发', () => {
    expect(parseMentionQuery('mail@example', 12)).toBeNull();
  });

  it('@ 后出现空格视为已结束', () => {
    expect(parseMentionQuery('@图神经 继续', 8)).toBeNull();
  });

  it('没有 @ 返回 null', () => {
    expect(parseMentionQuery('普通文本', 4)).toBeNull();
  });
});

describe('applyMention', () => {
  it('把查询替换为标签并补空格', () => {
    const r = applyMention('@图神经', 0, 4, '图神经网络综述');
    expect(r.text).toBe('@图神经网络综述 ');
    expect(r.caret).toBe(r.text.length);
  });

  it('保留前后文', () => {
    const r = applyMention('前文 @abc 后文', 3, 7, '文档A');
    expect(r.text).toBe('前文 @文档A  后文');
  });
});

describe('extractMentions', () => {
  it('抽出全部被引用的标签并去重', () => {
    expect(extractMentions('看 @A 和 @B，还有 @A')).toEqual(['A', 'B']);
  });

  it('无提及时返回空数组', () => {
    expect(extractMentions('普通问题')).toEqual([]);
  });

  it('邮箱不被当成提及', () => {
    expect(extractMentions('联系 mail@example.com')).toEqual([]);
  });
});

describe('filterMentions', () => {
  const items: MentionItem[] = [
    { id: '1', kind: 'reference', label: '图神经网络综述' },
    { id: '2', kind: 'knowledge', label: '实验记录 2026' },
    { id: '3', kind: 'document', label: '论文初稿' },
  ];

  it('空查询返回全部（受 limit 限制）', () => {
    expect(filterMentions(items, '')).toHaveLength(3);
    expect(filterMentions(items, '', 2)).toHaveLength(2);
  });

  it('按标签模糊匹配', () => {
    expect(filterMentions(items, '图').map((i) => i.id)).toEqual(['1']);
    expect(filterMentions(items, '论文').map((i) => i.id)).toEqual(['3']);
  });

  it('大小写不敏感', () => {
    const list: MentionItem[] = [{ id: 'x', kind: 'reference', label: 'Graph Neural Network' }];
    expect(filterMentions(list, 'graph')).toHaveLength(1);
  });

  it('无匹配返回空', () => {
    expect(filterMentions(items, '不存在的东西')).toEqual([]);
  });
});
