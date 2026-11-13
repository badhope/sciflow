import { z } from 'zod';
import type { AiService } from '../../ai/ai.service';
import { isResearchVerdict, type ResearchVerdict } from '../research-cycle-state';

/**
 * 评审（Critic）智能体：读假设 + 实验输出，判定结论并给出下一轮修订方向。
 *
 * 判定纪律：
 *  - 结论只允许 supported / refuted / inconclusive 三值（与 research_claim.status 对齐）；
 *  - 每条证据必须能落到实验输出里的具体片段（quote），禁止「大概」「应该」式证据；
 *  - 输出不充分时必须判 inconclusive，不允许为了推进循环而硬判 supported。
 */
export const criticVerdictSchema = z.object({
  verdict: z.enum(['supported', 'refuted', 'inconclusive']).describe('结论'),
  confidence: z.number().int().min(0).max(100).describe('0-100 置信度（不等于统计显著性）'),
  // 这三个字段必须显式输出：实测 agnes 在字段可选时会退化成
  // {"verdict":"inconclusive","confidence":95}，既没有证据也没有反馈。
  topicAligned: z.boolean().describe('本轮工作是否仍在回答原始研究问题（跑题则 false）'),
  evidence: z
    .array(
      z.object({
        quote: z.string().describe('实验输出中的原片段（证据来源）'),
        stance: z.enum(['supports', 'refutes', 'uncertain']).describe('对假设的作用'),
        strength: z.number().int().min(1).max(5).describe('证据强度 1-5'),
      }),
    )
    .describe('支撑/反驳该结论的证据条目；inconclusive 也要说明看了什么'),
  feedback: z.string().describe('对当前证据的总体评价（引用具体数字）'),
  revisionHint: z.string().default('').describe('若结论不成立，下一轮应改什么（给 PI 看）'),
});

export type CriticVerdict = z.infer<typeof criticVerdictSchema>;

export interface CriticInput {
  hypothesisStatement: string;
  predictions: string[];
  /** 实验运行的真实输出（stdout + stderr 摘要） */
  runOutput: string;
  /** 本轮协议的设计摘要（让评审知道原本打算检验什么） */
  designSummary?: string;
  previousVerdict?: string;
  /** 原始研究问题（评审据此判断是否跑题） */
  originalQuestion?: string;
  /** 检索到的文献线索（仅作背景，不得当作实验证据） */
  literature?: { title: string; year: number | null; venue: string; doi: string }[];
  /** LLM 调用归集标签（按循环维度统计 token 用） */
  context?: string;
}

const CRITIC_SYSTEM = [
  '你是一名严格但公正的研究评审（Reviewer / Red Team）。',
  '判据：',
  '1. 只根据给定的实验输出判断，不脑补未出现的数据，不引用未给出的文献。',
  '2. 先看【预期观察】，再逐项核对【实验输出】里的数字：',
  '   - 关键统计量都出现且方向/量级与预测一致 → supported（置信度 70-95）；',
  '   - 出现与预测相反的数字 → refuted（置信度 60-90）；',
  '   - 输出为空、缺少关键统计量、或无法对应预测 → inconclusive（置信度 0-30）。',
  '3. **不要因为“只做了一次模拟”就判 inconclusive**：只要输出给出了可核对的统计量与判定阈值，就按上面的规则判。',
  '4. evidence 至少 1 条（inconclusive 除外），quote 必须逐字摘自实验输出（优先带数字的整行）；找不到就说明输出不足。',
  '5. feedback 必须引用具体数字说明你为什么这样判；revisionHint 仅在结论不成立时给出可执行的修改方向。',
  '6. 严禁为了「让循环推进」而把 inconclusive 判成 supported，也严禁在证据充分时用 inconclusive 逃避判断。',
  '7. 若本轮工作已经偏离原始研究问题（例如换了研究主题、换了统计量），必须把 topicAligned 判为 false，并在 revisionHint 里明确要求回到原问题。',
  '8. 【相关文献线索】只用于判断该结论是否与已有工作明显冲突或重复；文献不是实验证据，禁止把文献内容写进 evidence，evidence 必须逐字摘自实验输出。',
].join('\n');

export async function evaluateWithCritic(
  ai: AiService,
  input: CriticInput,
): Promise<CriticVerdict> {
  const predictions = input.predictions?.length ? input.predictions.join('；') : '（未给出预测）';
  const messages = [
    { role: 'system' as const, content: CRITIC_SYSTEM },
    {
      role: 'user' as const,
      content: [
        input.originalQuestion ? `【原始研究问题（必须始终围绕它）】${input.originalQuestion}` : '',
        `【本轮假设】${input.hypothesisStatement}`,
        `【预期观察】${predictions}`,
        input.designSummary ? `【本轮协议设计】${input.designSummary}` : '',
        input.literature?.length
          ? `【相关文献线索（仅背景，不得作为实验证据）】\n${input.literature
              .slice(0, 6)
              .map((r, i) => `${i + 1}. ${r.title}（${r.year ?? 'n.d.'}，${r.venue || '未知载体'}${r.doi ? `，DOI:${r.doi}` : ''}）`)
              .join('\n')}`
          : '',
        input.previousVerdict ? `【上一轮结论】${input.previousVerdict}` : '',
        `【实验输出】\n${input.runOutput || '（无输出）'}`,
        '',
        '请逐项核对预测与输出中的数字，给出结论、至少一条逐字引用输出数字的证据、是否跑题，以及（若需要）下一轮修订方向。',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
  const out = await ai.completeStructured<CriticVerdict>(messages, criticVerdictSchema, {
    temperature: 0.1,
    context: input.context || 'research-cycle:critic',
    maxTokens: 2000,
    // 评审与 PI 同档：判结论是否成立、是否跑题，需要与设计同级别的判断力
    model: 'strong',
  });
  // schema 已限定三值；这里再做一次运行时收敛，防止上游模型返回越界值污染状态机
  if (!isResearchVerdict(out.verdict)) out.verdict = 'inconclusive' as ResearchVerdict;
  /**
   * 结论必须由证据支撑（guardrail，不靠模型自觉）：
   *  - supported 至少要有一条 stance=supports 的证据；
   *  - refuted 至少要有一条 stance=refutes 的证据；
   *  - 置信度为 0 时不允许给出 supported/refuted（自相矛盾）。
   * 实测 agnes 会返回 {"verdict":"supported","confidence":0,"evidence":[]}——按契约应降级为 inconclusive。
   */
  const supporting = (out.evidence ?? []).filter((e) => e.stance === 'supports').length;
  const refuting = (out.evidence ?? []).filter((e) => e.stance === 'refutes').length;
  if (out.verdict === 'supported' && (supporting === 0 || out.confidence <= 0)) out.verdict = 'inconclusive';
  if (out.verdict === 'refuted' && (refuting === 0 || out.confidence <= 0)) out.verdict = 'inconclusive';
  // 置信度表示「对结论的把握」；inconclusive 时不应出现 95 这种高把握读数
  if (out.verdict === 'inconclusive') out.confidence = Math.min(out.confidence, 30);
  return out;
}
