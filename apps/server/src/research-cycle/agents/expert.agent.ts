import { z } from 'zod';
import type { AiService } from '../../ai/ai.service';

/**
 * 独立 AI 专家审批（全自动模式的门禁）。
 *
 * 为什么单独设一个角色，而不是让 PI 自批：
 *  - PI 的目标是「让方案通过」，天然缺少否决动机；独立专家只对方法与可执行性负责；
 *  - 全自动模式跳过人工 interrupt 后，必须有一个等价的否决点，否则 L2 的安全边界被绕空。
 *
 * 判定口径（保守）：
 *  - 假设必须可证伪、且紧扣原问题；
 *  - 协议必须能翻译成沙箱可执行的 Python（无联网、无外部数据依赖）；
 *  - 必须有明确判定标准（阈值/统计量/样本口径）；
 *  - 任何一项不满足就驳回，并给出可执行的修改项。
 */
export const expertReviewSchema = z.object({
  approved: z.boolean().describe('是否批准该协议进入实验执行'),
  confidence: z.number().int().min(0).max(100).describe('0-100 审批把握'),
  rationale: z.string().min(1).describe('批准/驳回的理由（引用协议中的具体内容）'),
  concerns: z.array(z.string()).default([]).describe('仍存在的风险或不确定点'),
  requiredChanges: z.array(z.string()).default([]).describe('驳回时必须修改的项；批准时可为空'),
});

export type ExpertReview = z.infer<typeof expertReviewSchema>;

export interface ExpertReviewInput {
  question: string;
  hypothesisStatement: string;
  predictions: string[];
  design: Record<string, unknown>;
  /** LLM 调用归集标签 */
  context?: string;
}

const EXPERT_SYSTEM = [
  '你是一名独立的方法论评审专家（不参与方案设计，只负责门禁）。',
  '你的任务是判断这份研究协议是否已经具备「可执行、可证伪、可核验」的条件。',
  '批准条件（全部满足才 approved=true）：',
  '1. 假设可证伪：写清了什么观察结果会推翻它；',
  '2. 协议紧扣研究问题：目标、变量、分析没有换题；',
  '3. 可在 Python 沙箱执行：只用 numpy/pandas/scipy/statsmodels 或标准库，不联网、不依赖外部数据；',
  '4. 判定标准明确：有阈值、统计量或置信区间，能据输出判定成立/不成立；',
  '5. 样本/模拟口径写清楚：数据从哪来、样本量、随机种子或重复次数。',
  '纪律：',
  '- 批准时 confidence 至少 50；驳回时 confidence 0-40；',
  '- 任何一项缺失或含糊，approved=false，并在 requiredChanges 里写出具体补什么；',
  '- 不要因为「看起来合理」就批准；也不要提出无法在沙箱内实现的额外要求；',
  '- 理由必须引用协议里的具体字段，不要空泛评价。',
].join('\n');

function designToText(design: Record<string, unknown>): string {
  const d = design as {
    objective?: string;
    variables?: { name?: string; role?: string }[];
    controls?: string[];
    sample?: string;
    analysis?: string;
    steps?: string[];
  };
  const lines: string[] = [];
  if (d.objective) lines.push(`目标：${d.objective}`);
  if (d.variables?.length) lines.push(`变量：${d.variables.map((v) => `${v.name || '?'}(${v.role || '?'})`).join('、')}`);
  if (d.controls?.length) lines.push(`控制：${d.controls.join('、')}`);
  if (d.sample) lines.push(`样本：${d.sample}`);
  if (d.analysis) lines.push(`分析：${d.analysis}`);
  if (d.steps?.length) lines.push(`步骤：${d.steps.join(' → ')}`);
  return lines.join('\n') || JSON.stringify(design).slice(0, 2000);
}

export async function reviewWithExpert(ai: AiService, input: ExpertReviewInput): Promise<ExpertReview> {
  const baseMessages = [
    { role: 'system' as const, content: EXPERT_SYSTEM },
    {
      role: 'user' as const,
      content: [
        `【研究问题】${input.question}`,
        `【假设】${input.hypothesisStatement}`,
        `【预期观察】${input.predictions.length ? input.predictions.join('；') : '（未给出）'}`,
        `【协议设计】\n${designToText(input.design)}`,
        '',
        '请给出是否批准、把握程度、理由，以及（若驳回）必须修改的项。',
      ].join('\n'),
    },
  ];
  const run = (messages: typeof baseMessages) =>
    ai.completeStructured<ExpertReview>(messages, expertReviewSchema, {
      temperature: 0.1,
      context: input.context || 'research-cycle:expert',
      maxTokens: 2000,
      model: 'strong',
    });

  let out = await run(baseMessages);
  /**
   * 自相矛盾纠正：实测 agnes 会输出 approved=true + confidence=0。
   * 先带纠正提示重试一次；仍矛盾则按驳回处理（全自动门禁必须 fail-closed）。
   */
  if (out.approved && out.confidence <= 0) {
    out = await run([
      ...baseMessages,
      {
        role: 'user' as const,
        content: '你刚才输出 approved=true 但 confidence=0，两者矛盾。请重新审批：批准时 confidence 至少 50；驳回时 0-40。',
      },
    ]);
  }
  if (out.approved && out.confidence <= 0) {
    out = {
      ...out,
      approved: false,
      rationale: `专家审批输出自相矛盾（approved=true 但 confidence=0），按不批准处理。原理由：${out.rationale}`,
      requiredChanges: out.requiredChanges.length ? out.requiredChanges : ['重新提交审批并给出有效把握度'],
    };
  }
  // 驳回但没写修改项等于没给 PI 可用信号：补一条兜底，避免空转
  if (!out.approved && out.requiredChanges.length === 0) {
    out.requiredChanges = ['按 rationale 中的问题补充协议后重新提交审批'];
  }
  return out;
}
