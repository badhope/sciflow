import { describe, it, expect } from 'vitest';
import { weightedQualityTotal } from './ai.service';

/**
 * 质量总分加权（读取端加固）。
 * 写入端校验 (0,5]，但旧库/手工改库/部分写入可能留下非法权重：
 * 全 0 → 分母 0 → NaN；负数 → 总分越界。纯函数必须恒返回 0-100 整数。
 */
const DIMS = ['literature', 'logic', 'citation', 'language', 'novelty', 'figures', 'format'] as const;
const equal = (v: number) => Object.fromEntries(DIMS.map((d) => [d, v])) as Record<string, number>;

describe('weightedQualityTotal', () => {
  it('等权时等于算术平均', () => {
    const scores = equal(80);
    expect(weightedQualityTotal(scores, {})).toBe(80);
  });

  it('权重全为 0 时不产生 NaN（回落等权）', () => {
    const scores = equal(80);
    expect(weightedQualityTotal(scores, equal(0))).toBe(80);
    expect(Number.isFinite(weightedQualityTotal(scores, equal(0)))).toBe(true);
  });

  it('负权重/超上限权重被钳制（总分不越界）', () => {
    const scores = equal(60);
    const weights = Object.fromEntries(DIMS.map((d) => [d, -100])) as Record<string, number>;
    const t = weightedQualityTotal(scores, weights);
    expect(t).toBe(60);
    expect(weightedQualityTotal(scores, equal(99))).toBe(60);
  });

  it('按权重倾斜（高权重维度主导总分）', () => {
    const scores = { literature: 100, logic: 0, citation: 0, language: 0, novelty: 0, figures: 0, format: 0 };
    const weights = { literature: 5 };
    expect(weightedQualityTotal(scores, weights)).toBe(45); // 100*5 / (5 + 其余6维各1) = 500/11 ≈ 45
  });

  it('空维度返回 0，不 NaN', () => {
    expect(weightedQualityTotal({}, {})).toBe(0);
  });

  it('分数越界/非数字被钳制到合法总分', () => {
    const scores = { a: 999, b: -50 } as Record<string, number>;
    const t = weightedQualityTotal(scores, {});
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(100);
  });
});
