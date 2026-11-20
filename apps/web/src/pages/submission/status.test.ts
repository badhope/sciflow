import { describe, expect, it } from 'vitest';
import { STATUS_OPTIONS, inferStatusFromComments } from './status';

describe('submission status helpers', () => {
  it('大修意见优先推断为 major_revision', () => {
    expect(inferStatusFromComments([{ category: 'minor' }, { category: 'major' }])).toBe('major_revision');
    expect(inferStatusFromComments([{ category: '大修' }])).toBe('major_revision');
  });

  it('小修意见推断为 minor_revision', () => {
    expect(inferStatusFromComments([{ category: 'minor' }, { category: 'method' }])).toBe('minor_revision');
    expect(inferStatusFromComments([{ category: '小改' }])).toBe('minor_revision');
  });

  it('没有修回类意见时回退到外审', () => {
    expect(inferStatusFromComments([{ category: 'method' }, {}])).toBe('external_review');
  });

  it('状态下拉覆盖全部 13 个投稿状态', () => {
    expect(STATUS_OPTIONS).toHaveLength(13);
    expect(STATUS_OPTIONS[0]).toEqual({ value: 'submitted', label: '收稿' });
  });
});
