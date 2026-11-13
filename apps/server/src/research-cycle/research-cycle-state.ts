import { Annotation } from '@langchain/langgraph';

/** 检索到的文献线索（只保留可核对的元数据，摘要不进状态，避免 checkpoint 膨胀） */
export interface LiteratureRef {
  title: string;
  year: number | null;
  venue: string;
  doi: string;
  source?: string;
}

/**
 * 自主研究循环的图状态。
 *
 * 与主流水线（pipeline.graph.ts）的区别：
 *  - 主流水线是**单次 DAG**（无回边），产出稿件；
 *  - 研究循环是**带回边的多轮循环**：证据不足时修订协议再来一轮，直到结论被支持 / 预算耗尽 / 判定停滞。
 *
 * 状态里的 id 全部指向 research_* 对象（Program/Cycle/Question/Hypothesis/Protocol/Run/Claim/Evidence），
 * 图只是编排器，真源始终在库里——这样驾驶舱随时能看到中间产物，服务重启也能凭库恢复。
 */
export const ResearchCycleAnnotation = Annotation.Root({
  projectId: Annotation<string>,
  programId: Annotation<string>,
  /** 本轮研究循环 id（research_cycle） */
  cycleId: Annotation<string>,
  /** 研究问题 id（research_question） */
  questionId: Annotation<string>,
  /** 研究问题正文（PI 的输入） */
  questionText: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 当前假设 id（research_hypothesis） */
  hypothesisId: Annotation<string>,
  /** 当前假设陈述 */
  hypothesisStatement: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 假设的可检验预测 */
  predictions: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** 当前协议 id（research_protocol） */
  protocolId: Annotation<string>,
  /** 当前协议的设计（供实验者翻译成代码） */
  design: Annotation<Record<string, unknown>>({ reducer: (_a, b) => b, default: () => ({}) }),
  /** 协议设计指纹（判断方案是否真的改了） */
  designHash: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 当前运行 id（research_run） */
  runId: Annotation<string>,
  /** 实验输出（评审的证据来源） */
  runOutput: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 实验是否失败 */
  runFailed: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  /** 协议门禁模式：human=人工审批（interrupt）；ai=独立 AI 专家审批（全自动，不挂起） */
  approvalMode: Annotation<'human' | 'ai'>({ reducer: (_a, b) => b, default: () => 'human' }),
  /** 本轮检索到的文献线索（PI/评审的背景输入；失败时为空数组，不影响循环） */
  literature: Annotation<LiteratureRef[]>({ reducer: (_a, b) => b, default: () => [] }),
  /** 当前结论 id（research_claim） */
  claimId: Annotation<string>,
  /** 本轮评审结论 */
  verdict: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 本轮评审意见（给下一轮 PI 看） */
  feedback: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 上一轮结论 */
  lastVerdict: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 上一轮方案指纹 */
  lastDesignHash: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 上一轮评审意见（PI 的修订输入） */
  lastFeedback: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** 第几轮修订（0 = 第一轮） */
  iteration: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  /** 最大轮次 */
  maxIterations: Annotation<number>({ reducer: (_a, b) => b, default: () => 2 }),
  /** 本次循环累计消耗的 token（超预算即终止） */
  spentTokens: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  /** token 预算（0 = 不限） */
  maxTokens: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  /** 连续「同一结论 + 同一方案」的轮数——用于判定停滞 */
  stagnationCount: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  /** 终止原因（completed / budget_exceeded / max_iterations / stagnation / approval_rejected / failed）；空串 = 未终止 */
  stopReason: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  /** decide 节点给出的下一步（plan | synthesize | end） */
  nextRoute: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
});

export type ResearchCycleGraphState = typeof ResearchCycleAnnotation.State;

/** 评审结论取值（与 research_claim.status 对齐）。 */
export type ResearchVerdict = 'supported' | 'refuted' | 'inconclusive';

export const VERDICTS: ResearchVerdict[] = ['supported', 'refuted', 'inconclusive'];

export function isResearchVerdict(value: unknown): value is ResearchVerdict {
  return typeof value === 'string' && (VERDICTS as string[]).includes(value);
}
