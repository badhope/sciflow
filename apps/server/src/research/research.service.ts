import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { reviewComments, documents, researchDesigns, projects } from '../db/schema';
import { AiService } from '../ai/ai.service';
import * as prompts from '../ai/prompts';

/** 科研增强模块：研究设计诊断 / 多文献对比 / 多角色模拟审稿 / 实验设计助手 */

const designReviewSchema = z.object({
  noveltyScore: z.number(),
  noveltyFeedback: z.string(),
  feasibilityScore: z.number(),
  feasibilityFeedback: z.string(),
  methods: z.array(z.string()),
  risks: z.array(z.string()),
  nextSteps: z.array(z.string()),
});

const comparisonSchema = z.object({
  summary: z.string(),
  rows: z.array(
    z.object({
      paper: z.string(),
      研究问题: z.string(),
      方法: z.string(),
      主要结论: z.string(),
      局限: z.string(),
    }),
  ),
});

const simulatedReviewSchema = z.object({
  reviewers: z.array(
    z.object({
      role: z.string(),
      score: z.number(),
      strengths: z.array(z.string()),
      concerns: z.array(z.string()),
      suggestion: z.string(),
    }),
  ),
  verdict: z.string(),
  overall: z.string(),
});

/** F3 实验设计助手：结构化实验设计稿 */
export const experimentDesignSchema = z.object({
  objective: z.string(),
  variables: z.object({
    independent: z.array(z.string()),
    dependent: z.array(z.string()),
    controlled: z.array(z.string()),
  }),
  groups: z
    .array(z.object({ name: z.string(), role: z.string(), description: z.string() }))
    .min(1),
  sampleHint: z.string(),
  procedure: z.array(z.string()).min(1),
  analysisPlan: z.array(z.string()),
  risks: z.array(z.string()),
});
export type ExperimentDesign = z.infer<typeof experimentDesignSchema>;

export interface ResearchPaperInput {
  title: string;
  year?: number | null;
  venue?: string;
  abstract?: string;
  method?: string;
  conclusion?: string;
}

@Injectable()
export class ResearchService {
  constructor(private readonly ai: AiService) {}

  /** 研究设计诊断：想法 + 相关文献 → 新颖性/可行性/方法/风险/下一步 */
  async designReview(idea: string, papers: ResearchPaperInput[] = []) {
    if (!idea.trim()) {
      return { error: '请先描述研究想法' };
    }
    const paperText = papers
      .map(
        (p, i) =>
          `${i + 1}. ${p.title}${p.year ? `（${p.year}）` : ''}${p.venue ? ` [${p.venue}]` : ''}` +
          (p.abstract ? ` | 摘要：${p.abstract.slice(0, 200)}` : ''),
      )
      .join('\n');
    const custom = this.ai.getCustomPrompt('designReview');
    const raw = await this.ai.complete(
      [{ role: 'user', content: custom ?? prompts.DESIGN_REVIEW(idea, paperText) }],
      { temperature: 0.5, model: 'strong', context: 'designReview' },
    );
    const parsed = this.ai.safeParse(raw, designReviewSchema);
    if (!parsed) {
      return { error: '诊断结果解析失败，请重试' };
    }
    return { ...parsed, paperCount: papers.length };
  }

  /** 多文献对比：多篇论文 → 横向对比表 */
  async comparePapers(papers: ResearchPaperInput[]) {
    if (!papers.length) {
      return { error: '请至少选择两篇论文进行对比' };
    }
    const paperText = papers
      .map(
        (p, i) =>
          `${i + 1}. ${p.title} | ${p.year ?? 'N/A'} | ${p.venue || 'N/A'} | ` +
          `方法：${p.method || p.abstract?.slice(0, 120) || 'N/A'} | ` +
          `结论：${p.conclusion || p.abstract?.slice(120, 240) || 'N/A'}`,
      )
      .join('\n');
    const custom = this.ai.getCustomPrompt('paperComparison');
    const raw = await this.ai.complete(
      [{ role: 'user', content: custom ?? prompts.PAPER_COMPARISON(paperText) }],
      { temperature: 0.4, model: 'strong', context: 'paperComparison' },
    );
    const parsed = this.ai.safeParse(raw, comparisonSchema);
    if (!parsed) {
      return { error: '对比结果解析失败，请重试' };
    }
    return parsed;
  }

  /** 多角色模拟同行评审：3 位审稿人 + 主编综合决定 */
  async simulatedReview(title: string, content: string) {
    if (content.trim().length < 50) {
      return { error: '论文内容过短（至少 50 字），暂无法评审' };
    }
    const custom = this.ai.getCustomPrompt('simulatedReview');
    const raw = await this.ai.complete(
      [{ role: 'user', content: custom ?? prompts.SIMULATED_REVIEW(title, content.slice(0, 8000)) }],
      { temperature: 0.4, model: 'strong', context: 'simulatedReview' },
    );
    const parsed = this.ai.safeParse(raw, simulatedReviewSchema);
    if (!parsed) {
      return { error: '审稿意见解析失败，请重试' };
    }
    return parsed;
  }

  // ---------- F3 实验设计助手 ----------

  /** 生成结构化实验设计稿（变量表/对照组/功效提示/流程/分析计划）并落库 */
  async designExperiment(projectId: string, question: string, papers: ResearchPaperInput[] = []) {
    if (!question?.trim()) return { error: '请先描述研究问题' };
    const project = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId.trim())).get();
    if (!project) return { error: '项目不存在' };
    const paperText = papers
      .map((p, i) => `${i + 1}. ${p.title}${p.year ? `（${p.year}）` : ''}${p.method ? ` 方法：${p.method.slice(0, 120)}` : ''}${p.conclusion ? ` 结论：${p.conclusion.slice(0, 120)}` : ''}`)
      .join('\n');
    const custom = this.ai.getCustomPrompt('experimentDesign');
    const raw = await this.ai.complete(
      [{ role: 'user', content: custom ?? prompts.EXPERIMENT_DESIGN(question.trim(), paperText) }],
      { temperature: 0.4, model: 'strong', context: 'experimentDesign' },
    );
    const parsed = this.ai.safeParse(raw, experimentDesignSchema);
    if (!parsed) return { error: '实验设计解析失败，请重试' };
    const row = {
      id: randomUUID(),
      projectId: projectId.trim(),
      question: question.trim(),
      design: JSON.stringify(parsed),
      createdAt: Date.now(),
    };
    db.insert(researchDesigns).values(row).run();
    return { id: row.id, question: row.question, design: parsed, createdAt: row.createdAt };
  }

  /** 某项目的历史实验设计稿（新→旧） */
  listDesigns(projectId: string) {
    return db
      .select()
      .from(researchDesigns)
      .where(eq(researchDesigns.projectId, projectId))
      .orderBy(desc(researchDesigns.createdAt))
      .all()
      .map((r) => ({ id: r.id, question: r.question, design: JSON.parse(r.design) as ExperimentDesign, createdAt: r.createdAt }));
  }

  deleteDesign(id: string) {
    const existing = db.select().from(researchDesigns).where(eq(researchDesigns.id, id)).get();
    if (!existing) throw new NotFoundException('实验设计稿不存在');
    db.delete(researchDesigns).where(eq(researchDesigns.id, id)).run();
    return { ok: true };
  }

  // ---------- 审稿意见闭环 ----------

  /** 批量录入审稿意见 */
  addReviewComments(documentId: string, comments: { reviewer: string; commentText: string; category?: string }[]) {
    if (!documentId) throw new BadRequestException('documentId 必填');
    const now = Date.now();
    const created: any[] = [];
    for (const c of comments || []) {
      if (!c.commentText?.trim()) continue;
      const row = {
        id: randomUUID(),
        documentId,
        reviewer: c.reviewer?.trim() || 'reviewer',
        commentText: c.commentText,
        category: c.category || '',
        status: 'open' as const,
        responseText: '',
        sectionRef: '',
        createdAt: now,
        updatedAt: now,
      };
      db.insert(reviewComments).values(row).run();
      created.push(row);
    }
    return created;
  }

  /** 列出某文档的全部审稿意见 */
  listReviewComments(documentId: string) {
    return db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.documentId, documentId))
      .orderBy(reviewComments.createdAt)
      .all();
  }

  /** 更新单条意见状态 / 回复 / 分类 */
  updateReviewComment(id: string, patch: { status?: string; responseText?: string; category?: string }) {
    const existing = db.select().from(reviewComments).where(eq(reviewComments.id, id)).get();
    if (!existing) throw new NotFoundException('审稿意见不存在');
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (patch.status !== undefined) {
      if (!['open', 'resolved', 'deferred'].includes(patch.status)) throw new BadRequestException('status 取值不合法');
      set.status = patch.status;
    }
    if (patch.responseText !== undefined) set.responseText = patch.responseText;
    if (patch.category !== undefined) set.category = patch.category;
    db.update(reviewComments).set(set).where(eq(reviewComments.id, id)).run();
    return db.select().from(reviewComments).where(eq(reviewComments.id, id)).get();
  }

  /** 删除单条意见 */
  deleteReviewComment(id: string) {
    db.delete(reviewComments).where(eq(reviewComments.id, id)).run();
    return { ok: true };
  }

  /** 生成 point-by-point 回复信（仅针对 open 状态意见） */
  async generateResponseLetter(documentId: string): Promise<{ letter: string }> {
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    const openList = db
      .select()
      .from(reviewComments)
      .where(and(eq(reviewComments.documentId, documentId), eq(reviewComments.status, 'open')))
      .all();
    if (openList.length === 0) {
      throw new BadRequestException('当前文档没有待回复（open）的审稿意见，无需生成回复信');
    }
    const commentText = openList
      .map((c, i) => `意见${i + 1}（${c.reviewer}${c.category ? '，分类：' + c.category : ''}）：${c.commentText}`)
      .join('\n');
    const title = doc?.title || '（未命名论文）';
    const custom = this.ai.getCustomPrompt('response_letter');
    const userContent =
      custom ??
      `你是一位严谨的学术作者。请针对以下审稿意见，逐点（point-by-point）撰写一封正式的回复信。` +
        `每一条意见都要：①引用该意见原文 → ②给出你态度诚恳、有理有据的回应（接受/反驳/补充）→ ③说明你在论文中具体修改了哪一处（章节/段落定位）。` +
        `语气礼貌专业，中文撰写。\n\n论文标题：${title}\n\n审稿意见：\n${commentText}`;
    try {
      const letter = await this.ai.complete(
        [{ role: 'user', content: userContent }],
        { temperature: 0.5, model: 'strong', context: 'responseLetter' },
      );
      return { letter };
    } catch {
      throw new BadRequestException('回复信生成失败：AI 服务暂不可用，请稍后重试或检查模型配置');
    }
  }
}
