import { describe, it, expect } from 'vitest';
import { evaluateWithCritic } from './critic.agent';
import type { AiService } from '../../ai/ai.service';

/**
 * 评审结论护栏：结论必须由证据支撑，模型说了不算。
 * 实测 agnes 会输出 {"verdict":"supported","confidence":0,"evidence":[]}——
 * 这种「零证据零置信度的支持」不能落库成 supported，否则循环会提前收口。
 */
function fakeAi(verdict: any) {
  return {
    completeStructured: async () => verdict,
  } as unknown as AiService;
}

const input = {
  hypothesisStatement: 'H1',
  predictions: ['p'],
  runOutput: 'n=25, SE=0.2022',
};

describe('Critic 结论证据护栏', () => {
  it('supported 但没有 supports 证据 → 降级 inconclusive', async () => {
    const out = await evaluateWithCritic(
      fakeAi({ verdict: 'supported', confidence: 80, topicAligned: true, evidence: [], feedback: '', revisionHint: '' }),
      input,
    );
    expect(out.verdict).toBe('inconclusive');
  });

  it('supported 但置信度为 0 → 降级 inconclusive', async () => {
    const out = await evaluateWithCritic(
      fakeAi({
        verdict: 'supported',
        confidence: 0,
        topicAligned: true,
        evidence: [{ quote: 'SE=0.2022', stance: 'supports', strength: 3 }],
        feedback: '',
        revisionHint: '',
      }),
      input,
    );
    expect(out.verdict).toBe('inconclusive');
  });

  it('refuted 但没有 refutes 证据 → 降级 inconclusive', async () => {
    const out = await evaluateWithCritic(
      fakeAi({
        verdict: 'refuted',
        confidence: 70,
        topicAligned: true,
        evidence: [{ quote: 'SE=0.2022', stance: 'supports', strength: 3 }],
        feedback: '',
        revisionHint: '',
      }),
      input,
    );
    expect(out.verdict).toBe('inconclusive');
  });

  it('证据与置信度都满足时保留 supported', async () => {
    const out = await evaluateWithCritic(
      fakeAi({
        verdict: 'supported',
        confidence: 85,
        topicAligned: true,
        evidence: [{ quote: 'SE=0.2022', stance: 'supports', strength: 4 }],
        feedback: 'ok',
        revisionHint: '',
      }),
      input,
    );
    expect(out.verdict).toBe('supported');
    expect(out.confidence).toBe(85);
  });

  it('inconclusive 时置信度收敛到 <=30（避免 95 分「没把握」）', async () => {
    const out = await evaluateWithCritic(
      fakeAi({
        verdict: 'inconclusive',
        confidence: 95,
        topicAligned: true,
        evidence: [],
        feedback: '输出缺少关键统计量',
        revisionHint: '',
      }),
      input,
    );
    expect(out.verdict).toBe('inconclusive');
    expect(out.confidence).toBe(30);
  });

  it('越界 verdict 收敛为 inconclusive', async () => {
    const out = await evaluateWithCritic(
      fakeAi({ verdict: 'maybe', confidence: 50, topicAligned: true, evidence: [], feedback: '', revisionHint: '' }),
      input,
    );
    expect(out.verdict).toBe('inconclusive');
  });
});
