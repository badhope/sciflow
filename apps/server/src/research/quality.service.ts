import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, desc, and, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { qualityReports, reviewComments, documents, citations } from '../db/schema';
import { checkPaperQuality } from '../common/quality-audit';
import { parseQualityStandard, type QualityStandardKey } from '../common/quality-standards';
import { appSettings } from '../db/schema';
import { AiService, ReviewResult } from '../ai/ai.service';
import { parseJson } from '../common/json-guard';
import { structureFeedback } from './quality-feedback';

/** 7 维英文 key → 中文维度名（category 取最低分维度映射中文，差距 #7） */
const DIM_CN: Record<string, string> = {
  literature: '文献',
  logic: '逻辑',
  citation: '引用',
  language: '语言',
  novelty: '创新性',
  figures: '图表',
  format: '格式',
};

/** 读全局评审标准（app_setting quality_standard；非法值 fail-closed 回落 standard） */
function readQualityStandard(): QualityStandardKey {
  try {
    const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'quality_standard')).get();
    return parseQualityStandard(row?.value).key;
  } catch {
    return 'standard';
  }
}

@Injectable()
export class QualityService {
  constructor(private readonly ai: AiService) {}

  /**
   * 报告行 → API DTO。
   *
   * 拆分前的老行只有 totalScore（LLM 分）+ scores（LLM 七维），objectiveScore/llmScore 均为 null；
   * 直接用新字段会让老历史显示「LLM 分 0」。这里按行形态显式回填并标 scoreSource，
   * 前端据此区分「门禁客观分」与「LLM 参考分」，不把两者混成一个总分。
   */
  private toDto(row: typeof qualityReports.$inferSelect) {
    const legacy = row.objectiveScore == null && row.llmScore == null;
    const scores = parseJson<Record<string, number>>(row.scores, {});
    const llmScores = parseJson<Record<string, number>>(row.llmScores ?? '{}', {});
    return {
      ...row,
      /** 兼容字段：始终是 LLM 七维（老前端也按这个字段画雷达图） */
      scores,
      objectiveDimensions: parseJson<unknown[]>(row.objectiveDimensions ?? '[]', []),
      /** 新行读 llm_scores；老行只有 scores（那时 scores 存的就是 LLM 七维） */
      llmScores: Object.keys(llmScores).length ? llmScores : scores,
      /** 老行没有拆分，totalScore 本身就是 LLM 分 */
      llmScore: row.llmScore ?? (legacy ? row.totalScore : null),
      objectiveScore: row.objectiveScore ?? null,
      scoreSource: legacy ? ('llm-legacy' as const) : ('split' as const),
    };
  }

  /**
   * 对文档执行 7 维质量评分并落库。
   *
   * 一次评审同时产出两套分，写在同一行但字段分离：
   *  - 客观分（objective_*）：确定性规则引擎，是门禁/验收口径
   *  - LLM 分（llm_*）：模型参考分，会漂移，只用于改进建议与趋势
   * 兼容字段 total_score 写客观分（与流水线门禁一致），scores 继续写 LLM 七维供旧客户端使用。
   */
  async review(documentId: string, title: string, content: string) {
    if (!documentId?.trim()) throw new BadRequestException('documentId 必填');
    const doc = db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    if (!content || content.length < 50) {
      throw new BadRequestException('文档内容过短，暂无法评分（至少 50 字）');
    }
    const result: ReviewResult & { totalScore: number } = await this.ai.reviewPaper(title, content);
    const citationCount = db.select().from(citations).where(eq(citations.documentId, documentId)).all().length;
    const objective = checkPaperQuality(content, { citationCount, standard: readQualityStandard() });
    const row = {
      id: randomUUID(),
      documentId,
      totalScore: objective.totalScore,
      scores: JSON.stringify(result.scores),
      feedback: result.feedback,
      objectiveScore: objective.totalScore,
      objectiveDimensions: JSON.stringify(objective.dimensions),
      llmScore: result.totalScore,
      llmScores: JSON.stringify(result.scores),
      expertScore: null,
      expertStatus: 'unreviewed',
      createdAt: Date.now(),
    };
    db.insert(qualityReports).values(row).run();
    return this.toDto(row as typeof qualityReports.$inferSelect);
  }

  /** 某文档的历史评分（可对比） */
  /** 全量评分历史（仅本地单用户模式；企业模式由 controller 拒绝） */
  historyAll() {
    return db.select().from(qualityReports).orderBy(desc(qualityReports.createdAt)).all().map((r) => this.toDto(r));
  }
  history(documentId: string) {
    return db.select().from(qualityReports).where(eq(qualityReports.documentId, documentId)).orderBy(desc(qualityReports.createdAt)).all().map((r) => this.toDto(r));
  }

  /** 某文档最新一次评分（写作页侧边栏/写作现场展示用）；无记录返回 null，不 404 */
  latest(documentId: string) {
    if (!documentId) return null;
    const row = db
      .select()
      .from(qualityReports)
      .where(eq(qualityReports.documentId, documentId))
      .orderBy(desc(qualityReports.createdAt))
      .get();
    if (!row) return null;
    return this.toDto(row);
  }

  /**
   * 项目内全部文档的「最新分」总览（v1.8）。
   *
   * 为什么需要：质量页此前只能一篇一篇选文档看分，而真实痛点是「哪几篇还没达标」。
   * 这里一次算出所有文档的**客观分**（确定性、零模型成本）与最新 LLM 分，
   * 按客观分升序返回（最差优先），让用户在总览层直接看到需要回炉的稿件。
   *
   * 口径说明：客观分对「当前正文」计算（改稿后立即反映），LLM 分取库里最新一条历史记录
   * （那是当时稿件的评分，可能与当前正文不一致）—— 两者都带出来但不混算。
   */
  projectOverview(projectId: string) {
    if (!projectId?.trim()) throw new BadRequestException('projectId 必填');
    const rows = db.select().from(documents).where(eq(documents.projectId, projectId)).all();
    const items = rows.map((doc) => {
      const citationCount = (db.select().from(citations).where(eq(citations.documentId, doc.id)).all() || []).length;
      const report = checkPaperQuality(String(doc.content || ''), { citationCount, standard: readQualityStandard() });
      // 及格线必须与用户选择的评审标准一致（draft 70 / conference 78 / standard 80 / strict 85），
      // 不能在总览里写死 80，否则会和流水线门禁、质量页给出相反结论。
      const passScore = report.standard?.passScore ?? 80;
      const latestLlm = db
        .select()
        .from(qualityReports)
        .where(eq(qualityReports.documentId, doc.id))
        .orderBy(desc(qualityReports.createdAt))
        .get();
      return {
        documentId: doc.id,
        title: doc.title,
        status: doc.status || 'draft',
        updatedAt: doc.updatedAt,
        chars: report.stats.chars,
        objectiveScore: report.totalScore,
        fingerprint: report.fingerprint,
        hardFailCount: report.hardFails.length,
        hardFails: report.hardFails.slice(0, 3),
        llmScore: latestLlm?.llmScore ?? latestLlm?.totalScore ?? null,
        llmScoredAt: latestLlm?.createdAt ?? null,
        passScore,
        passed: report.totalScore >= passScore,
      };
    });
    items.sort((a, b) => a.objectiveScore - b.objectiveScore || b.updatedAt - a.updatedAt);
    return {
      projectId,
      total: items.length,
      passed: items.filter((i) => i.passed).length,
      failed: items.filter((i) => !i.passed).length,
      unscored: items.filter((i) => i.chars === 0).length,
      items,
    };
  }

  get(id: string) {
    const row = db.select().from(qualityReports).where(eq(qualityReports.id, id)).get();
    if (!row) throw new NotFoundException('评分报告不存在');
    return this.toDto(row);
  }

  // ---------- 差距 #7：质量 feedback 结构化进 review_comment ----------

  /** 把 feedback 按行/中英文分号拆成条目（每条 1-3 句的自然切分；纯本地拆分，无 AI key 亦可测） */
  private splitFeedback(feedback: string): string[] {
    return (feedback || '')
      .split(/[\n;；]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);
  }

  /**
   * 读取该文档最新 quality_report，把 feedback 拆条写入 review_comment：
   * - reviewer 固定 'AI 质量评审'，status='open'，sectionRef 留空
   * - category 取 scores 最低分维度的中文名（并列时取最后一个最低维，稳定即可）
   * 幂等键（最简设计）：同 documentId + reviewer='AI 质量评审' + created_at >= report.createdAt
   * —— 即「同一份报告导出过就不再重复插入」；新报告（时间戳更晚）可再次导出。
   * 无报告返回 {created:0, existing:0}。
   */
  exportComments(documentId: string) {
    const report = this.latest(documentId);
    if (!report) return { created: 0, existing: 0 };
    const entries = this.splitFeedback(report.feedback || '');
    const scores = (report.scores || {}) as Record<string, number>;
    let minDim = 'novelty';
    let minVal = Infinity;
    for (const [k, v] of Object.entries(scores)) {
      const n = Number(v);
      if (!Number.isNaN(n) && n <= minVal) {
        minVal = n;
        minDim = k;
      }
    }
    const category = DIM_CN[minDim] || '综合';
    // 结构化：每条反馈定位到章节 + 定级 + 识别维度（此前 sectionRef 恒为空，反馈没有落点）
    const doc = db.select({ content: documents.content }).from(documents).where(eq(documents.id, documentId)).get();
    const structured = structureFeedback(report.feedback || '', doc?.content || '');
    const existing = db
      .select()
      .from(reviewComments)
      .where(and(eq(reviewComments.documentId, documentId), eq(reviewComments.reviewer, 'AI 质量评审'), gte(reviewComments.createdAt, report.createdAt)))
      .all();
    if (existing.length > 0) {
      return { created: 0, existing: existing.length };
    }
    const now = Date.now();
    let created = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const text = entries[i];
      const meta = structured[i];
      db.insert(reviewComments)
        .values({
          id: randomUUID(),
          documentId,
          reviewer: 'AI 质量评审',
          commentText: text,
          category: meta?.dimension ? (DIM_CN[meta.dimension] || category) : category,
          status: 'open',
          responseText: '',
          sectionRef: meta?.section || '',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      created++;
    }
    return { created, existing: 0 };
  }
}
