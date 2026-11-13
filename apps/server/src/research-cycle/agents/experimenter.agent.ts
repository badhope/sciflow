import { z } from 'zod';
import type { AiService } from '../../ai/ai.service';

/**
 * 实验者智能体：把「协议设计」翻译成一段可直接在 Python 沙箱里跑的代码。
 *
 * 约束（安全边界）：
 *  - 只产出单个 Python 脚本，由服务端沙箱执行（实验沙箱已有超时/内存/输出截断/env 白名单）；
 *  - 不允许联网下载数据（数据必须来自沙箱环境已有包或内联数据），避免循环变成「下载器」；
 *  - 代码必须打印结果（stdout 作为证据来源），否则评审拿不到可核验的输出。
 */
export const experimentDesignSchema = z.object({
  goal: z.string().default('').describe('这段代码要检验什么，一句话'),
  code: z.string().min(1).describe('可运行的 Python 3 脚本，必须打印结果'),
  expectedOutput: z.string().default('').describe('预期打印的关键数值，便于评审核对'),
});

export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;

/**
 * 清洗模型给出的 Python 代码：剥掉 Markdown 围栏与语言标记。
 *
 * 为什么必须做：实测真实模型（agnes-3.0-flash）经常把代码包在 ```python … ``` 里，
 * 直接送进沙箱会抛 SyntaxError（第一次真实运行就是这样失败的）。
 * 这类噪声属于「格式」而非「内容」，由服务端确定性清洗，不该让模型重试浪费 token。
 */
export function sanitizePythonCode(raw: string): string {
  let code = String(raw || '').trim();
  // Markdown 围栏：模型可能在围栏前后夹解释文字，取第一个围栏块（未闭合则取到结尾）
  if (code.includes('```')) {
    const anyFence = code.match(/```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)(?:```|$)/);
    if (anyFence) code = anyFence[2].trim();
  }
  // 去掉残留的裸 "python" 首行
  code = code.replace(/^python\s*\r?\n/i, '').trim();
  return code;
}

export interface ExperimentDesignInput {
  hypothesisStatement: string;
  predictions: string[];
  design: {
    objective?: string;
    variables?: { name: string; role: string }[];
    controls?: string[];
    sample?: string;
    analysis?: string;
    steps?: string[];
  };
  /** LLM 调用归集标签（按循环维度统计 token 用） */
  context?: string;
  /** 上一次执行的报错（修复轮用：让模型照着报错改代码，而不是重写） */
  previousError?: string;
}

const EXPERIMENTER_SYSTEM = [
  '你是一名实验者，把研究协议翻译成一段可直接运行的 Python 3 脚本。',
  '硬性要求：',
  '1. 只依赖标准库与沙箱里已有的常见科学计算包（numpy / pandas / scipy / statsmodels）；不确定可用就别 import。',
  '2. 禁止联网、禁止下载数据、禁止读写沙箱目录外的文件、禁止安装依赖。',
  '3. 必须有确定性输出：固定随机种子，最后 print 出关键统计量（数值而非仅文字描述）。',
  '4. 统计推断请给出样本量、估计量与标准误/置信区间，让评审能判断结论是否成立。',
  '5. 代码要短小、可读、一次运行完成；不要写交互式脚本。',
  '6. **脚本不超过 30 行**：模型网关对长输出有超时/截断限制，代码太长会整轮失败。优先保留最小可验证闭环。',
  '7. **必须写成正常的多行 Python**：一行一条语句，不要用分号把多条语句连在一行，也不要把 for/if 写成分号连接的一行（会直接 SyntaxError）。',
  '8. 输出格式：只给脚本正文。第一行写 import，随后每行一条语句；不要 JSON、不要解释、不要 Markdown 围栏、不要罗列无关模块。',
].join('\n');

function designToText(design: ExperimentDesignInput['design']): string {
  const lines: string[] = [];
  if (design.objective) lines.push(`- 检验目标：${design.objective}`);
  if (design.variables?.length) {
    lines.push(`- 变量：${design.variables.map((v) => `${v.name}(${v.role})`).join('、')}`);
  }
  if (design.controls?.length) lines.push(`- 控制变量：${design.controls.join('、')}`);
  if (design.sample) lines.push(`- 样本口径：${design.sample}`);
  if (design.analysis) lines.push(`- 分析方法：${design.analysis}`);
  if (design.steps?.length) lines.push(`- 步骤：${design.steps.join(' → ')}`);
  return lines.join('\n') || '（协议未给出细节，按常识补齐最小可执行方案）';
}

export async function designExperiment(
  ai: AiService,
  input: ExperimentDesignInput,
): Promise<ExperimentDesign> {
  const predictions = input.predictions?.length ? input.predictions.join('；') : '（未给出预测）';
  const repairBlock = input.previousError
    ? `\n\n【上一次失败（必须照此修正）】\n${input.previousError.slice(0, 1200)}\n请据此重写脚本：保持多行、每行一条语句、不要用分号连接语句，控制在 30 行以内。`
    : '';
  const messages = [
    { role: 'system' as const, content: EXPERIMENTER_SYSTEM },
    {
      role: 'user' as const,
      content: [
        `【待检验假设】${input.hypothesisStatement}`,
        `【预期观察】${predictions}`,
        `【协议设计】\n${designToText(input.design)}`,
        '',
        '请给出可直接运行的 Python 脚本（不要用 Markdown 代码围栏，直接输出代码）。',
        repairBlock,
      ].join('\n'),
    },
  ];
  // 代码生成走纯文本而不是 generateObject：
  // 实测 agnes-3.0-flash 在 JSON schema 模式下会把 code 写成一行「import 模块清单」，
  // 既没有换行也没有 print；纯文本模式更接近模型擅长的代码续写形态。
  const raw = await ai.complete(messages, {
    temperature: 0.2,
    context: input.context || 'research-cycle:experimenter',
    maxTokens: 2600,
  });
  const code = sanitizePythonCode(raw);
  return {
    goal: String(input.design.objective || '检验假设').slice(0, 200),
    code,
    expectedOutput: '',
  };
}
