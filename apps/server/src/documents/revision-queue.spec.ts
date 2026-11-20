import { describe, expect, it } from 'vitest';
import { inferSectionTitle } from './revision-queue';

const TITLES = ['引言', '方法', '实验结果', '结论'];

describe('inferSectionTitle', () => {
  it('uses an explicit section title only when it exactly matches the document', () => {
    expect(inferSectionTitle({ sectionTitle: '方法' }, TITLES)).toBe('方法');
    expect(inferSectionTitle({ sectionTitle: '方法部分' }, TITLES)).toBe('');
  });

  it('matches the longest section title mentioned in the plan text', () => {
    expect(inferSectionTitle({ excerpt: '实验结果缺少误差棒，方法部分缺少对照。' }, TITLES)).toBe('实验结果');
    expect(inferSectionTitle({ excerpt: '结论需要补充局限。' }, TITLES)).toBe('结论');
  });

  it('returns empty instead of guessing when no section is named', () => {
    expect(inferSectionTitle({ excerpt: '整体语言需要更学术。' }, TITLES)).toBe('');
  });
});
