import { describe, expect, it } from 'vitest';
import { deriveChainState, type ChainNode } from './EvidenceChain';

/**
 * 证据链状态推导的回归。
 *
 * 核心价值：把「引用断了」这件事变成可判定的规则，而不是靠人眼扫。
 * 这些用例覆盖了伪引用最典型的三种形态：完全没文献、有锚点没条目、条目少于锚点。
 */

function node(stage: ChainNode['stage'], count: number): ChainNode {
  return { stage, label: stage, count, state: 'ok' };
}

describe('deriveChainState', () => {
  it('全链完整时每环都是 ok', () => {
    const r = deriveChainState([
      node('question', 1),
      node('evidence', 8),
      node('anchor', 8),
      node('citation', 8),
      node('reference', 8),
    ]);
    expect(r.every((n) => n.state === 'ok')).toBe(true);
  });

  it('某一环为 0 判定为 missing（断链）', () => {
    const r = deriveChainState([node('question', 1), node('evidence', 5), node('anchor', 0)]);
    expect(r[2].state).toBe('missing');
  });

  it('有锚点但条目更少 → warn 并给出未闭环数量', () => {
    const r = deriveChainState([node('question', 1), node('evidence', 10), node('anchor', 6)]);
    expect(r[2].state).toBe('warn');
    expect(r[2].note).toContain('4');
  });

  it('数量递增不算断点（文献多于锚点是正常的，不是每篇都被引用）', () => {
    const r = deriveChainState([node('question', 1), node('evidence', 10), node('anchor', 3)]);
    // evidence(10) -> anchor(3) 属于递减，应告警
    expect(r[2].state).toBe('warn');
    // 但 question(1) -> evidence(10) 是递增，不告警
    expect(r[1].state).toBe('ok');
  });

  it('空数组返回空', () => {
    expect(deriveChainState([])).toEqual([]);
  });

  it('首环为 0 也标 missing', () => {
    const r = deriveChainState([node('question', 0), node('evidence', 0)]);
    expect(r[0].state).toBe('missing');
    expect(r[1].state).toBe('missing');
  });
});
