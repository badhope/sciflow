import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySaver, Command } from '@langchain/langgraph';
import { buildResearchCycleGraph, designFingerprint, topicOverlap, type ResearchCycleGraphDeps } from './research-cycle.graph';

/**
 * 自主研究循环图的回归测试。
 *
 * 这里锁的是「循环到底能不能循环」这件事——上一轮把多轮循环做在仓库外的脚本里
 * （reproduction/run-econ-loop.mjs），主图是单次 DAG，结构上带不起来。
 * 所以本文件专门覆盖：回边、终止条件、L2 审批门禁、预算熔断、停滞判定。
 */

interface Recorder {
  plan: number;
  design: number;
  evaluate: number;
  expert: number;
  experiments: number;
  claims: number;
  events: string[];
  cycleStates: string[];
  approved: string[];
  protocolDesigns: Record<string, unknown>[];
}

function makeDeps(overrides: {
  /** 每轮评审结论（按调用顺序循环） */
  verdicts?: ('supported' | 'refuted' | 'inconclusive')[];
  /** 每轮协议设计（按调用顺序循环） */
  designs?: Record<string, unknown>[];
  autonomy?: string;
  maxTokens?: number;
  experimentOutput?: string;
  /** 全自动模式下 AI 专家是否批准（默认 true） */
  expertApproved?: boolean;
  /** 全自动模式下 AI 专家调用是否抛错 */
  expertThrows?: boolean;
  /** 文献检索是否抛错（验证降级） */
  literatureThrows?: boolean;
} = {}) {
  const rec: Recorder = {
    plan: 0,
    design: 0,
    evaluate: 0,
    expert: 0,
    experiments: 0,
    claims: 0,
    events: [],
    cycleStates: [],
    approved: [],
    protocolDesigns: [],
  };
  const verdicts = overrides.verdicts ?? ['refuted'];
  const designs = overrides.designs ?? [{ objective: 'A' }];
  let protocolSeq = 0;

  const deps: ResearchCycleGraphDeps = {
    programs: {
      getProgram: () => ({
        id: 'prog-1',
        projectId: 'proj-1',
        goal: '研究问题',
        autonomyLevel: overrides.autonomy || 'L3',
        title: '计划',
      }),
      listProtocols: () => [],
      createHypothesis: (_q, input) => {
        rec.plan += 1;
        rec.events.push(`plan:${String(input.statement)}`);
        return { id: `hyp-${rec.plan}` };
      },
      createProtocol: (_hypothesisId, input) => {
        rec.protocolDesigns.push(input.design as Record<string, unknown>);
        protocolSeq += 1;
        return { id: `proto-${protocolSeq}`, status: 'draft' };
      },
      approveProtocol: (protocolId) => {
        rec.approved.push(protocolId);
        return { id: protocolId, status: 'approved' };
      },
      updateCycle: (_cycleId, patch) => {
        if (patch.state) rec.cycleStates.push(patch.state);
      },
    },
    records: {
      createRun: () => ({ id: `run-${rec.experiments + 1}` }),
      updateRun: () => undefined,
      createClaim: () => {
        rec.claims += 1;
        return { id: `claim-${rec.claims}` };
      },
      updateClaim: () => undefined,
      addEvidence: () => ({ id: `ev-${rec.claims}` }),
    },
    agents: {
      plan: async () => {
        const idx = rec.plan;
        rec.plan += 1;
        rec.events.push(`plan:${idx}`);
        return {
          questionEcho: `假设${idx}`,
          hypothesis: { statement: `假设${idx}`, rationale: 'r', predictions: ['p'] },
          protocol: { design: designs[idx % designs.length] },
        };
      },
      design: async () => {
        rec.design += 1;
        return { goal: '跑一下', code: 'import statistics\nvalues = [1, 2, 3, 4, 5]\nprint(statistics.mean(values))\n', expectedOutput: '3' };
      },
      evaluate: async () => {
        const idx = rec.evaluate;
        rec.evaluate += 1;
        return {
          verdict: verdicts[idx % verdicts.length],
          confidence: 50,
          topicAligned: true,
          evidence: [{ quote: '1', stance: 'supports', strength: 3 }],
          feedback: `反馈${idx}`,
          revisionHint: `改方案${idx}`,
        };
      },
      expertReview: async () => {
        rec.expert += 1;
        if (overrides.expertThrows) throw new Error('专家模型不可用');
        return {
          approved: overrides.expertApproved !== false,
          confidence: 82,
          rationale: '协议可执行、判定标准明确',
          concerns: [],
          requiredChanges: [],
        };
      },
    },
    runExperiment: async () => {
      rec.experiments += 1;
      return {
        id: `exp-${rec.experiments}`,
        stdout: overrides.experimentOutput ?? '结果 1',
        stderr: '',
        status: 'ok',
        runtimeMs: 5,
      };
    },
    literatureSearch: async ({ query }) => {
      rec.events.push(`lit:${query}`);
      if (overrides.literatureThrows) throw new Error('OpenAlex 超时');
      return [{ title: 'A Prior Study', year: 2020, venue: 'J. Test', doi: '10.1/x' }];
    },
    autonomyLevel: () => overrides.autonomy || 'L3',
    tokensSpent: () => overrides.maxTokens ?? 0,
    notify: (event) => rec.events.push(event),
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  };
  return { deps, rec };
}

const initialState = {
  projectId: 'proj-1',
  programId: 'prog-1',
  cycleId: 'cycle-1',
  questionId: 'q-1',
  questionText: '研究问题',
  iteration: 0,
  maxIterations: 3,
  maxTokens: 0,
};

describe('自主研究循环图', () => {
  let saver: MemorySaver;

  beforeEach(() => {
    saver = new MemorySaver();
  });

  it('结论 supported 时一轮结束并产出结论', async () => {
    const { deps, rec } = makeDeps({ verdicts: ['supported'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't1' } } as never);
    expect(rec.experiments).toBe(1);
    expect(rec.claims).toBe(1);
    expect(result.stopReason).toBe('completed');
    expect(result.verdict).toBe('supported');
  });

  it('结论 refuted 时走回边修订再来一轮（这正是单次 DAG 做不到的事）', async () => {
    const { deps, rec } = makeDeps({ verdicts: ['refuted', 'supported'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't2' } } as never);
    expect(rec.experiments).toBe(2);
    expect(rec.claims).toBe(2);
    expect(result.iteration).toBe(2);
    expect(result.stopReason).toBe('completed');
    expect(result.verdict).toBe('supported');
  });

  it('达到最大轮次即终止，不无限循环', async () => {
    const { deps, rec } = makeDeps({ verdicts: ['refuted'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(
      { ...initialState, maxIterations: 2 } as never,
      { configurable: { thread_id: 't3' } } as never,
    );
    expect(rec.experiments).toBe(2);
    expect(result.stopReason).toBe('max_iterations');
  });

  it('方案不变且结论不变时判定停滞并终止', async () => {
    // 停滞语义：同一结论 + 同一方案连续出现 2 次即判定空转。
    // 第 1 轮是基准；第 2 轮是第 1 次重复；第 3 轮是第 2 次重复 → 此时终止（不再开第 4 轮）
    const { deps, rec } = makeDeps({ verdicts: ['refuted'], designs: [{ objective: 'same' }] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(
      { ...initialState, maxIterations: 5 } as never,
      { configurable: { thread_id: 't4' } } as never,
    );
    expect(result.stopReason).toBe('stagnation');
    expect(rec.experiments).toBe(3);
  });

  it('token 预算耗尽时终止（预算优先于轮次与停滞）', async () => {
    const { deps, rec } = makeDeps({ verdicts: ['refuted'], maxTokens: 1 });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(
      { ...initialState, maxIterations: 5, maxTokens: 1 } as never,
      { configurable: { thread_id: 't5' } } as never,
    );
    expect(result.stopReason).toBe('budget_exceeded');
    expect(rec.experiments).toBe(1);
  });

  it('L2 门禁：协议未审批时挂起，不执行实验', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L2', verdicts: ['supported'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't6' } } as never);
    expect(rec.experiments).toBe(0);
    expect(result.__interrupt__).toBeTruthy();
    expect(JSON.stringify(result.__interrupt__)).toContain('protocol-approval');
  });

  it('L2 门禁：人工批准后 resume 继续跑完', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L2', verdicts: ['supported'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const cfg = { configurable: { thread_id: 't7' } } as never;
    await graph.invoke(initialState as never, cfg);
    expect(rec.experiments).toBe(0);
    const resumed: any = await graph.invoke(new Command({ resume: { approved: true } }) as never, cfg);
    expect(rec.experiments).toBe(1);
    expect(resumed.stopReason).toBe('completed');
    expect(rec.approved).toEqual(['proto-1']);
  });

  it('L2 门禁：驳回协议即终止本轮', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L2', verdicts: ['supported'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const cfg = { configurable: { thread_id: 't8' } } as never;
    await graph.invoke(initialState as never, cfg);
    const resumed: any = await graph.invoke(new Command({ resume: { approved: false } }) as never, cfg);
    expect(resumed.stopReason).toBe('approval_rejected');
    expect(rec.experiments).toBe(0);
  });

  it('全自动模式：AI 专家批准后直接执行，不挂起人工', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L2', verdicts: ['supported'], expertApproved: true });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(
      { ...initialState, approvalMode: 'ai' } as never,
      { configurable: { thread_id: 't12' } } as never,
    );
    expect(rec.expert).toBe(1);
    expect(rec.approved).toEqual(['proto-1']);
    expect(rec.experiments).toBe(1);
    expect(result.stopReason).toBe('completed');
  });

  it('全自动模式：AI 专家驳回即终止，不执行实验', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L2', expertApproved: false });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(
      { ...initialState, approvalMode: 'ai' } as never,
      { configurable: { thread_id: 't13' } } as never,
    );
    expect(rec.expert).toBe(1);
    expect(result.stopReason).toBe('approval_rejected');
    expect(String(result.feedback)).toContain('AI 专家驳回');
    expect(rec.experiments).toBe(0);
    expect(rec.approved).toEqual([]);
  });

  it('全自动模式：AI 专家不可用时 fail-closed（agent_error），不默认放行', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L2', expertThrows: true });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(
      { ...initialState, approvalMode: 'ai' } as never,
      { configurable: { thread_id: 't14' } } as never,
    );
    expect(rec.expert).toBe(1);
    expect(result.stopReason).toBe('agent_error');
    expect(rec.experiments).toBe(0);
  });

  it('L3 起自动批准协议，无需人工介入', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L3', verdicts: ['supported'] });
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't9' } } as never);
    expect(rec.experiments).toBe(1);
    expect(rec.approved).toEqual(['proto-1']);
    expect(result.stopReason).toBe('completed');
  });

  it('PI 连续失败时体面终止（agent_error），不进入实验也不崩循环', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L3' });
    deps.agents.plan = async () => {
      rec.plan += 1;
      throw new Error('AI_JSONParseError: 输出被截断');
    };
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't10' } } as never);
    expect(rec.plan).toBe(2); // 重试一次
    expect(result.stopReason).toBe('agent_error');
    expect(rec.experiments).toBe(0);
    expect(rec.claims).toBe(0);
  });

  it('实验脚本只有 import / 没有 print 时视为失败并触发修复轮', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L3', verdicts: ['supported'] });
    let designs = 0;
    deps.agents.design = async () => {
      designs += 1;
      return designs === 1
        ? { goal: 'g', code: 'import numpy as np', expectedOutput: '' }
        : { goal: 'g', code: 'import statistics\nvalues = [1, 2, 3, 4, 5]\nprint(statistics.mean(values))\n', expectedOutput: '3' };
    };
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't11' } } as never);
    expect(designs).toBe(2); // 第一版被质量闸拦下，修复轮重写
    expect(rec.experiments).toBe(1); // 只有合格脚本真正进沙箱
    expect(result.stopReason).toBe('completed');
  });

  it('首轮检索文献并把线索传给 PI 与评审（只检索一次，修订轮复用）', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L3', verdicts: ['refuted', 'supported'] });
    const seen: number[] = [];
    const seenByCritic: number[] = [];
    const originalPlan = deps.agents.plan;
    const originalEvaluate = deps.agents.evaluate;
    deps.agents.plan = async (input) => {
      seen.push(input.literature?.length ?? 0);
      return originalPlan(input);
    };
    deps.agents.evaluate = async (input) => {
      seenByCritic.push(input.literature?.length ?? 0);
      return originalEvaluate(input);
    };
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    await graph.invoke({ ...initialState, maxIterations: 2 } as never, { configurable: { thread_id: 't15' } } as never);
    // 两轮 PI 与两轮评审都拿到文献线索，但检索只发生一次
    expect(seen).toEqual([1, 1]);
    expect(seenByCritic).toEqual([1, 1]);
    expect(rec.events.filter((e) => e.startsWith('lit:'))).toHaveLength(1);
    // 文献线索随协议落库，驾驶舱可核对
    expect((rec.protocolDesigns[0].literature as unknown[]).length).toBe(1);
  });

  it('文献检索失败时降级为空线索，循环照常跑完', async () => {
    const { deps, rec } = makeDeps({ autonomy: 'L3', verdicts: ['supported'], literatureThrows: true });
    const seen: number[] = [];
    const original = deps.agents.plan;
    deps.agents.plan = async (input) => {
      seen.push(input.literature?.length ?? 0);
      return original(input);
    };
    const graph = buildResearchCycleGraph(deps, { checkpointer: saver });
    const result: any = await graph.invoke(initialState as never, { configurable: { thread_id: 't16' } } as never);
    expect(seen).toEqual([0]);
    expect(result.stopReason).toBe('completed');
    expect(rec.experiments).toBe(1);
  });

  it('方案指纹能区分「改了方案」与「换了说法」', () => {
    expect(designFingerprint({ a: 1, b: 2 })).toBe(designFingerprint({ b: 2, a: 1 }));
    expect(designFingerprint({ a: 1 })).not.toBe(designFingerprint({ a: 2 }));
  });

  it('话题重合度能识别 PI 跑题', () => {
    const q = '含离群点样本中位数的稳健标准差是否小于均值';
    expect(topicOverlap(q, q)).toBeGreaterThan(0.9);
    // 跑题案例：换成机器学习特征工程主题
    expect(topicOverlap(q, '基线模型特征工程与交叉验证对 AUC 的影响')).toBeLessThan(0.3);
    // 字面相近但语义不同（真实事故：问题里的「5%」被当成 p=0.05）
    expect(topicOverlap(q, '在 n=200 样本上验证 5% 显著性水平下的统计推断覆盖率')).toBeLessThan(0.5);
  });
});
