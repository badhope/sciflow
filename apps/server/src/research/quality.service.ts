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

  /** 对文档执行 7 维质量评分并落库（借鉴 ARS 0-100 质量关卡） */
  async review(documentId: string, title: string, content: string) {
    if (!documentId?.trim()) throw new BadRequestException('documentId 必填');
    const doc = db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    if (!content || content.length < 50) {
      throw new BadRequestException('文档内容过短，暂无法评分（至少 50 字）');
    }
    const result: ReviewResult & { totalScore: number } = await this.ai.reviewPaper(title, content);
    const row = {
      id: randomUUID(),
      documentId,
      totalScore: result.totalScore,
      scores: JSON.stringify(result.scores),
      feedback: result.feedback,
      createdAt: Date.now(),
    };
    db.insert(qualityReports).values(row).run();
    return row;
  }

  /** 某文档的历史评分（可对比） */
  /** 全量评分历史（仅本地单用户模式；企业模式由 controller 拒绝） */
  historyAll() {
    return db.select().from(qualityReports).orderBy(desc(qualityReports.createdAt));
  }
  history(documentId: string) {
    return db.select().from(qualityReports).where(eq(qualityReports.documentId, documentId)).orderBy(desc(qualityReports.createdAt));
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
    return { ...row, scores: parseJson<Record<string, number>>(row.scores, {}) };
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
        llmScore: latestLlm?.totalScore ?? null,
        llmScoredAt: latestLlm?.createdAt ?? null,
        passed: report.totalScore >= 80,
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
    return { ...row, scores: parseJson<Record<string, number>>(row.scores, {}) };
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
    for (const text of entries) {
      db.insert(reviewComments)
        .values({
          id: randomUUID(),
          documentId,
          reviewer: 'AI 质量评审',
          commentText: text,
          category,
          status: 'open',
          responseText: '',
          sectionRef: '',
          createdAt: now,
          updatedAt: now,
        })
        .run();
      created++;
    }
    return { created, existing: 0 };
  }
}
