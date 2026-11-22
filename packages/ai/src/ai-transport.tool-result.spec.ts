import { describe, expect, it } from 'vitest';
import { describeToolPayload } from './ai-transport.service';

describe('describeToolPayload', () => {
  it('字符串原样返回并记录真实长度', () => {
    expect(describeToolPayload('2 个项目')).toEqual({ text: '2 个项目', chars: 5 });
  });

  it('对象序列化成可读 JSON', () => {
    const result = describeToolPayload({ total: 2, items: ['A', 'B'] });
    expect(result.text).toContain('"total": 2');
    expect(result.chars).toBeGreaterThan(0);
  });

  it('超长结果截断并明确标注原始字符数', () => {
    const result = describeToolPayload('x'.repeat(5000), 100);
    expect(result.chars).toBe(5000);
    expect(result.text.startsWith('x'.repeat(100))).toBe(true);
    expect(result.text).toContain('已截断，共 5000 字符');
  });
});
