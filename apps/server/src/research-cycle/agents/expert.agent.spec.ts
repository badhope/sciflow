import { describe, it, expect } from 'vitest';
import { reviewWithExpert } from './expert.agent';
import type { AiService } from '../../ai/ai.service';

/**
 * AI 专家审批的角色边界：
 *  - 只返回审批结论，不修改协议；
 *  - 驳回但没给修改项时补兜底，保证 PI 下一轮能拿到可执行信号。
 */
function fakeAi(out: any) {
  return { completeStructured: async () => out } as unknown as AiService;
}

function seqAi(outs: any[]) {
  let i = 0;
  return {
    calls: () => i,
    ai: {
      completeStructured: async () => outs[Math.min(i++, outs.length - 1)],
    } as unknown as AiService,
  };
}

const input = {
  question: '样本均值的标准误是否按 1/sqrt(n) 下降？',
  hypothesisStatement: 'SE 随 n 按 1/sqrt(n) 下降',
  predictions: ['SE(25)/SE(100)≈2'],
  design: { objective: '蒙特卡洛模拟', sample: 'n=25/100/400，B=10000', analysis: '比较实测与理论 SE' },
};

describe('AI 专家审批', () => {
  it('批准但 confidence=0（自相矛盾）→ 纠正重试一次', async () => {
    const seq = seqAi([
      { approved: true, confidence: 0, rationale: '看起来可以', concerns: [], requiredChanges: [] },
      { approved: true, confidence: 72, rationale: '判定标准明确', concerns: [], requiredChanges: [] },
    ]);
    const out = await reviewWithExpert(seq.ai, input);
    expect(seq.calls()).toBe(2);
    expect(out.approved).toBe(true);
    expect(out.confidence).toBe(72);
  });

  it('两次都自相矛盾 → 按驳回处理（fail-closed）', async () => {
    const seq = seqAi([
      { approved: true, confidence: 0, rationale: '看起来可以', concerns: [], requiredChanges: [] },
      { approved: true, confidence: 0, rationale: '还是零把握', concerns: [], requiredChanges: [] },
    ]);
    const out = await reviewWithExpert(seq.ai, input);
    expect(out.approved).toBe(false);
    expect(out.rationale).toContain('自相矛盾');
    expect(out.requiredChanges.length).toBeGreaterThan(0);
  });

  it('批准时保留理由与置信度', async () => {
    const out = await reviewWithExpert(
      fakeAi({ approved: true, confidence: 85, rationale: '判定标准明确', concerns: [], requiredChanges: [] }),
      input,
    );
    expect(out.approved).toBe(true);
    expect(out.confidence).toBe(85);
  });

  it('驳回且未给修改项时补一条兜底，避免空转', async () => {
    const out = await reviewWithExpert(
      fakeAi({ approved: false, confidence: 60, rationale: '缺少判定阈值', concerns: ['analysis 不具体'], requiredChanges: [] }),
      input,
    );
    expect(out.approved).toBe(false);
    expect(out.requiredChanges.length).toBe(1);
    expect(out.requiredChanges[0]).toContain('rationale');
  });
});
