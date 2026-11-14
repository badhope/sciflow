import { z } from 'zod';
import type { AiService } from '../ai/ai.service';

/**
 * 长篇写作（分卷 / 分章 / 续写）——百万字级长文的工程基础。
 *
 * 为什么不复用 pipeline 的分章起草：
 *  - pipeline 一次性把整份大纲丢给模型并行起草，产出约 1 万字，上下文一次就满；
 *  - 百万字必须「按卷立项 → 按章生成 → 跨章一致性记忆 → 断点续写」，
 *    且每一章只携带**压缩后的前情**（不是全文），否则上下文必然溢出。
 *
 * 本模块只做「一卷的章节规划」与「单章正文生成」，持久化与续跑由 longform.service 负责。
 */

/** 卷内章节规划：模型只给标题 + 本章目标 + 关键情节点，不给正文 */
export const chapterPlanSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).describe('本章标题'),
        goal: z.string().min(1).describe('本章要推进什么（一句话）'),
        beats: z.array(z.string()).describe('3-5 个关键情节点，按顺序'),
        entities: z.array(z.string()).default([]).describe('本章出场的核心人物/组织（供一致性检查）'),
      }),
    )
    .describe('本卷章节列表'),
});

export type ChapterPlan = z.infer<typeof chapterPlanSchema>;

export interface ChapterPlanInput {
  bookTitle: string;
  premise: string;
  volumeTitle: string;
  volumeGoal: string;
  /** 已有章节摘要（前情），只放摘要不放正文 */
  priorSynopses: string[];
  targetChapters: number;
  context?: string;
}

const PLAN_SYSTEM = [
  '你是长篇小说的结构编辑，负责把一卷拆成可直接写作的章节清单。',
  '要求：',
  '1. 每章只写「标题 / 本章目标 / 3-5 个情节点 / 出场实体」，不要写正文。',
  '2. 章节之间必须有因果推进：后一章的冲突由前一章的结果引发。',
  '3. 严格遵守给定章数；不要压缩成梗概，也不要超出。',
  '4. 与已有前情保持一致：人物、设定、时间线不得与前情摘要冲突。',
].join('\n');

export async function planChapters(ai: AiService, input: ChapterPlanInput): Promise<ChapterPlan> {
  const prior = input.priorSynopses.length
    ? `\n\n【已有前情摘要（必须保持一致）】\n${input.priorSynopses.slice(-20).map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '';
  const messages = [
    { role: 'system' as const, content: PLAN_SYSTEM },
    {
      role: 'user' as const,
      content: [
        `【书名】${input.bookTitle}`,
        `【核心设定】${input.premise}`,
        `【本卷】${input.volumeTitle}：${input.volumeGoal}`,
        `【需要拆成 ${input.targetChapters} 章】`,
        prior,
        '',
        `请输出正好 ${input.targetChapters} 章。`,
      ].join('\n'),
    },
  ];
  const out = await ai.completeStructured<ChapterPlan>(messages, chapterPlanSchema, {
    temperature: 0.5,
    context: input.context || 'longform:plan',
    maxTokens: 4000,
    model: 'strong',
  });
  // 章数纠偏：模型多给/少给都不应该让整卷失败，截断或按缺口提示
  if (out.chapters.length > input.targetChapters) out.chapters = out.chapters.slice(0, input.targetChapters);
  return out;
}

export interface ChapterDraftInput {
  bookTitle: string;
  premise: string;
  volumeTitle: string;
  chapterTitle: string;
  chapterGoal: string;
  beats: string[];
  /** 压缩前情：上一章结尾 + 卷内已发生的核心事件（不是前文全文） */
  priorContext: string;
  /** 目标字数（中文按汉字计） */
  targetChars: number;
  styleHint?: string;
  context?: string;
}

const DRAFT_SYSTEM = [
  '你是长篇小说的执笔作者。只写本章正文，不写大纲、不写解释、不写总结。',
  '硬性要求：',
  '1. 严格承接【前情】的结尾状态：人物位置、情绪、未解决的冲突都要接上。',
  '2. 按【本章情节点】的顺序推进，每个情节点至少落到一个具体场景。',
  '3. 不要重复前情里已经发生过的情节，不要复述设定说明。',
  '4. 人物称呼、设定名词必须与前情完全一致，不得改名或另造同义设定。',
  '5. 结尾留一个具体的悬念或转折，承接下一章。',
].join('\n');

export async function draftChapter(ai: AiService, input: ChapterDraftInput): Promise<string> {
  const messages = [
    { role: 'system' as const, content: DRAFT_SYSTEM },
    {
      role: 'user' as const,
      content: [
        `【书名】${input.bookTitle}`,
        `【核心设定】${input.premise}`,
        `【本卷】${input.volumeTitle}`,
        '',
        `【前情】\n${input.priorContext || '（本章是开篇，无前情）'}`,
        '',
        `【本章】${input.chapterTitle}`,
        `【本章目标】${input.chapterGoal}`,
        `【本章情节点】\n${input.beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}`,
        input.styleHint ? `【文风要求】${input.styleHint}` : '',
        `【目标字数】约 ${input.targetChars} 字（中文按汉字计）`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
  const raw = await ai.complete(messages, {
    temperature: 0.8,
    context: input.context || 'longform:draft',
    // 单章目标 3000 字 ≈ 4000-5000 token，留足余量避免截断
    maxTokens: Math.min(16_000, Math.max(3000, Math.round(input.targetChars * 2.2))),
    model: 'strong',
  });
  return String(raw || '').trim();
}

/** 章节摘要压缩：把刚落盘的正文压成 1-2 句前情，供后续章节使用 */
export async function summarizeChapter(ai: AiService, title: string, body: string, context?: string): Promise<string> {
  const messages = [
    { role: 'system' as const, content: '把给定章节正文压成 1-2 句前情摘要：只写「谁在哪里做了什么、结果如何、留下什么未解决」，不要评价文笔。' },
    { role: 'user' as const, content: `【章节】${title}\n\n【正文】\n${body.slice(0, 6000)}` },
  ];
  const raw = await ai.complete(messages, { temperature: 0.2, context: context || 'longform:summary', maxTokens: 400, model: 'fast' });
  return String(raw || '').trim().slice(0, 600);
}
