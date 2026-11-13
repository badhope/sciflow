import { z } from 'zod';
import type { AiService } from '../../ai/ai.service';

/**
 * PI（首席研究员）智能体：把研究问题转成「可证伪假设 + 可执行协议」。
 *
 * 用 generateObject + zod 出结构化决策（仓库契约 §7：禁止手写 JSON 抠取）。
 * 修订轮会带上上一轮的评审反馈，让 PI 真的改方案而不是换个说法。
 */
export const piPlanSchema = z.object({
  /** 逐字复述你正在回答的研究问题：强制模型把注意力锚在问题上（实测小模型容易跑题） */
  questionEcho: z.string().min(1).describe('逐字复述给你的研究问题'),
  hypothesis: z.object({
    statement: z.string().min(1).describe('一句话陈述可证伪的假设'),
    rationale: z.string().min(1).describe('为什么这个假设成立，依据是什么'),
    predictions: z.array(z.string()).min(1).describe('若假设成立，预期观察到什么'),
  }),
  protocol: z.object({
    design: z.object({
      objective: z.string().min(1).describe('本轮要检验的目标（必须针对给定的研究问题）'),
      variables: z.array(z.object({ name: z.string(), role: z.string() })).min(1).describe('变量及其角色（自变量/因变量/控制变量）'),
      controls: z.array(z.string()).describe('需要控制的混杂因素'),
      sample: z.string().min(1).describe('数据来源与样本口径（数据从哪来、样本多大、怎么造）'),
      analysis: z.string().min(1).describe('统计/分析方法与判定标准（用什么检验、阈值多少算成立）'),
      steps: z.array(z.string()).min(1).describe('可执行步骤（供实验者翻译成代码）'),
    }),
  }),
});

export type PiPlan = z.infer<typeof piPlanSchema>;

export interface PiPlanInput {
  question: string;
  /** 上一轮评审反馈（第一轮为空） */
  priorFeedback?: string;
  /** 上一轮结论（第一轮为空） */
  priorVerdict?: string;
  iteration: number;
  /** 检索到的文献线索（仅作背景；无命中时为空） */
  literature?: { title: string; year: number | null; venue: string; doi: string }[];
  /** LLM 调用归集标签（按循环维度统计 token 用） */
  context?: string;
}

/** PI 的系统提示：强调可证伪性、紧扣原问题、方案要具体到可翻译成代码。 */
const PI_SYSTEM = [
  '你是一名严谨的首席研究员（PI），负责把研究问题转成可证伪的假设与可执行的实验协议。',
  '要求：',
  '1. 假设必须可证伪——写清「若观察到什么则不成立」，不要写无法检验的断言。',
  '2. **紧扣给定的研究问题**：不得把问题替换成别的研究主题。若问题本身有歧义，在 rationale 里写明你采用的解读。',
  '3. 协议必须具体到能直接写出代码：样本从哪来（若只能模拟就写清模拟方式与参数）、用什么统计量、阈值多少算成立、有哪些步骤。',
  '4. 若给了上一轮的评审反馈，必须针对性修改方案（换变量、换口径、换判定标准），不要重复上一轮的做法。',
  '5. 不确定的地方写明保守假设，不要编造具体文献数值或数据集名称。',
  '6. 输出要紧凑：predictions 2-4 条、variables 2-5 个、steps 3-6 步，每条一句话，避免长段落导致 JSON 被截断。',
  '7. 若给了【相关文献线索】，可据此说明研究背景或选择对照组；但不得把摘要里没写的数据当成已知事实，也不要在输出里编造引文。',
].join('\n');

/** 文献线索块：只给标题/年份/载体的紧凑列表，控制 token 且便于模型引用 */
function literatureBlock(refs: PiPlanInput['literature']): string {
  if (!refs?.length) return '';
  const lines = refs.slice(0, 6).map((r, i) => `${i + 1}. ${r.title}（${r.year ?? 'n.d.'}，${r.venue || '未知载体'}${r.doi ? `，DOI:${r.doi}` : ''}）`);
  return `\n\n【相关文献线索（检索所得，仅作背景参考）】\n${lines.join('\n')}`;
}

export async function planWithPi(ai: AiService, input: PiPlanInput): Promise<PiPlan> {
  const feedbackBlock = input.priorFeedback
    ? `\n\n【上一轮评审反馈（必须针对性修改）】\n${input.priorFeedback}\n【上一轮结论】${input.priorVerdict || '未知'}`
    : '';
  const messages = [
    { role: 'system' as const, content: PI_SYSTEM },
    {
      role: 'user' as const,
      content: [
        `【研究问题】\n${input.question}`,
        '',
        `【这是第 ${input.iteration + 1} 轮】`,
        '请先在 questionEcho 里逐字复述上面的研究问题，再给出假设与协议。',
        '假设与协议必须只针对这个研究问题，不得替换成别的主题。',
        literatureBlock(input.literature),
        feedbackBlock,
      ].join('\n'),
    },
  ];
  return ai.completeStructured<PiPlan>(messages, piPlanSchema, {
    temperature: 0.4,
    context: input.context || 'research-cycle:pi',
    // 修订轮要同时带 hypothesis + protocol（含变量/步骤），2000 token 实测会被截断成非法 JSON；
    // 4000 给足余量，同时提示词要求字段紧凑，避免又顶到上限。
    maxTokens: 4000,
    // PI 用强模型档：研究设计对小模型来说是最难的一步（实测 flash 档会跑题）。
    // 未配置 strong 模型时 resolveModel 会回落到 fast，行为不变。
    model: 'strong',
  });
}
