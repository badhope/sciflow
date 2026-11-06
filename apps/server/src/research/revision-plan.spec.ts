import { describe, expect, it } from 'vitest';
import { buildRevisionPlan } from './revision-plan';

describe('buildRevisionPlan', () => {
  it('parses numbered comments into items', () => {
    const plan = buildRevisionPlan('1) The experiments are missing baselines.\n2) Fix the abstract length.');
    expect(plan.length).toBe(2);
    expect(plan[0].id).toBe('R1');
    expect(plan[1].id).toBe('R2');
  });

  it('classifies experiment/method/citation/writing categories', () => {
    const plan = buildRevisionPlan(
      '1) 请补充对比实验与数据集说明。\n'
      + '2) 方法部分应说明算法收敛性。\n'
      + '3) 引用格式不符合 GB/T 7714。\n'
      + '4) 第 3 段语言表达口语化。',
    );
    expect(plan[0].category).toBe('experiment');
    expect(plan[1].category).toBe('method');
    expect(plan[2].category).toBe('citation');
    expect(plan[3].category).toBe('writing');
  });

  it('detects major/minor severity markers', () => {
    const plan = buildRevisionPlan('Major: 1) 需要补充实验。\nMinor: 2) 个别错别字。');
    expect(plan[0].severity).toBe('major');
    expect(plan[1].severity).toBe('minor');
  });

  it('falls back to a single writing item for unstructured text', () => {
    const plan = buildRevisionPlan('整体行文不错，但贡献点不够突出。');
    expect(plan.length).toBe(1);
    expect(plan[0].category).toBe('structure');
    expect(plan[0].excerpt.length).toBeGreaterThan(0);
  });

  it('keeps empty input empty', () => {
    expect(buildRevisionPlan('')).toEqual([]);
  });

  it('every item carries a suggested action', () => {
    const plan = buildRevisionPlan('1) 补充实验。\n2) 方法不清晰。');
    for (const item of plan) {
      expect(item.suggestedAction.length).toBeGreaterThan(4);
    }
  });
});
