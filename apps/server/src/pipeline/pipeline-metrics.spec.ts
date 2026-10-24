import { describe, it, expect } from 'vitest';
import { normalizeKnScore, normalizeAgentDate } from './pipeline-metrics';

/**
 * 数据口径修复（v1.0.1）：
 * 1) 知识库检索分是百分制（packages/retrieval/src/knowledge.service.ts 归一为 1-100），
 *    旧实现按 /8 归一 → 任何命中都夹到 1.0，跨库匹配度分数全部失去区分度。
 * 2) Agent 用量按日聚合用 toISOString()（UTC），与 SQL 报表的 localtime 口径不一致 → 跨时区日界错位。
 */
describe('知识库匹配度归一', () => {
  it('百分制分数映射到 0-1（100 → 1.0，50 → 0.5，1 → 0.01）', () => {
    expect(normalizeKnScore(100)).toBe(1);
    expect(normalizeKnScore(50)).toBe(0.5);
    expect(normalizeKnScore(1)).toBe(0.01);
  });

  it('越界与非法值夹紧/归零（负数、>100、NaN）', () => {
    expect(normalizeKnScore(-10)).toBe(0);
    expect(normalizeKnScore(180)).toBe(1);
    expect(normalizeKnScore(Number.NaN)).toBe(0);
  });
});

describe('Agent 用量按日聚合的本地日界', () => {
  it('本地年月日格式 YYYY-MM-DD（与 SQL localtime 口径一致）', () => {
    const ts = new Date(2026, 0, 5, 23, 30).getTime(); // 本地 2026-01-05 23:30
    expect(normalizeAgentDate(ts)).toBe('2026-01-05');
  });

  it('跨日边界：本地 00:05 归当天而非前一天（UTC 实现会错判）', () => {
    const ts = new Date(2026, 5, 1, 0, 5).getTime();
    expect(normalizeAgentDate(ts)).toBe('2026-06-01');
  });
});
