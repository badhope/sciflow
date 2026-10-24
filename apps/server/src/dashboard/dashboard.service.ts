import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from '../db/database';
import {
  pipelineTasks,
  submissions,
  reviewComments,
  qualityReports,
  documents,
  references,
  experiments,
  journals,
} from '../db/schema';

/** 投稿终态：不再做超期推断（与 submission.service 保持一致） */
const TERMINAL_STATUSES = new Set(['rejected', 'withdrawn', 'accepted', 'in_production', 'transferred']);
const DAY_MS = 24 * 3600 * 1000;
/** 低分阈值：最近一次质量总分低于该值即列入待办 */
const LOW_SCORE_THRESHOLD = 60;

/**
 * Dashboard 全链路总览聚合（B7-1 后端打通）。
 * 不新建表，只在既有 pipelineTask / submission / review_comment / quality_report / document / experiment / reference 上做读时聚合。
 * 任一子查询失败都降级为空数组/0，保证 Dashboard 永不因单表异常而整页崩。
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  /**
   * 全链路总览。projectId 传参时按项目过滤（工作台 StageBar「项目阶段条」必须项目级，
   * 否则多项目时完成度与角标混入其他项目数据——2026-10-24 审计 M9）；缺省 = 全库（兼容旧调用）。
   */
  overview(projectId?: string) {
    // 分块降级：单个聚合失败只影响它自己，并把错误写进日志（此前整体 catch 把 SQL 错误吞成「全 0」）
    const safe = <T,>(label: string, fn: () => T, fallback: T): T => {
      try {
        return fn();
      } catch (e) {
        this.logger.error(`dashboard.${label} 失败：${e instanceof Error ? e.message : String(e)}`);
        return fallback;
      }
    };
    try {
      const scope = projectId?.trim() || undefined;
      const pendingOutline = safe('pendingOutline', () => this.pendingOutlineCount(scope), 0);
      const openReviewComments = safe('openReviewComments', () => this.openReviewCommentCount(scope), 0);
      const experimentCount = safe('experiments', () => this.countRows(experiments, scope), 0);
      const docCount = safe('documents', () => this.countRows(documents, scope), 0);
      const refCount = safe('references', () => this.countRows(references, scope), 0);
      const overdueSubmissions = safe('overdueSubmissions', () => this.overdueSubmissions(scope), []);
      const lowQualityDocs = safe('lowQualityDocs', () => this.lowQualityDocs(scope), []);
      return {
        pendingOutline,
        overdueSubmissions,
        openReviewComments,
        lowQualityDocs,
        experimentCount,
        docCount,
        refCount,
      };
    } catch {
      return {
        pendingOutline: 0,
        overdueSubmissions: [],
        openReviewComments: 0,
        lowQualityDocs: [],
        experimentCount: 0,
        docCount: 0,
        refCount: 0,
      };
    }
  }

  /** 状态为「大纲待确认」的流水线任务数（Human-in-the-loop 卡点） */
  private pendingOutlineCount(projectId?: string): number {
    const conds = [eq(pipelineTasks.status, 'awaiting_confirmation')];
    if (projectId) conds.push(eq(pipelineTasks.projectId, projectId));
    return db.select().from(pipelineTasks).where(and(...conds)).all().length;
  }

  /** open 状态审稿意见总数（按项目过滤时经 document 关联 projectId） */
  private openReviewCommentCount(projectId?: string): number {
    if (!projectId) {
      return db.select().from(reviewComments).where(eq(reviewComments.status, 'open')).all().length;
    }
    const rows = db
      .select({ n: sql<number>`COUNT(*)` })
      .from(reviewComments)
      .innerJoin(documents, eq(reviewComments.documentId, documents.id))
      .where(and(eq(reviewComments.status, 'open'), eq(documents.projectId, projectId)))
      .get();
    return Number(rows?.n ?? 0);
  }

  private countRows(table: SQLiteTable, projectId?: string): number {
    // COUNT(*) 而非 select().all().length：后者把整表拉进内存（文档/文献多时纯浪费）
    if (projectId) {
      const row = db
        .select({ n: sql<number>`COUNT(*)` })
        .from(table)
        .where(sql`project_id = ${projectId}`)
        .get();
      return Number(row?.n ?? 0);
    }
    const row = db.select({ n: sql<number>`COUNT(*)` }).from(table).get();
    return Number(row?.n ?? 0);
  }

  /**
   * 活跃投稿中超期的列表。单次 JOIN 查询消除 N+1（原来循环内逐条查 journals）。
   */
  private overdueSubmissions(projectId?: string) {
    const now = Date.now();
    const rows = db
      .select({
        id: submissions.id,
        journalName: submissions.journalName,
        title: submissions.title,
        status: submissions.currentStatus,
        submittedAt: submissions.submittedAt,
        revisionDeadline: submissions.revisionDeadline,
        fdw: journals.firstDecisionWeeks,
      })
      .from(submissions)
      .leftJoin(journals, eq(submissions.journalId, journals.id))
      .where(projectId ? eq(submissions.projectId, projectId) : undefined)
      .all();
    const out: { id: string; journalName: string; title: string; status: string; overdueDays: number }[] = [];
    for (const s of rows) {
      if (TERMINAL_STATUSES.has(s.status || '')) continue;
      let overdueDays = 0;
      if (typeof s.revisionDeadline === 'number' && s.revisionDeadline && now > s.revisionDeadline) {
        overdueDays = Math.max(overdueDays, Math.floor((now - s.revisionDeadline) / DAY_MS));
      }
      if (s.fdw && s.submittedAt) {
        const dueAt = s.submittedAt + s.fdw * 7 * DAY_MS;
        if (now > dueAt) overdueDays = Math.max(overdueDays, Math.floor((now - dueAt) / DAY_MS));
      }
      if (overdueDays > 0) {
        out.push({ id: s.id, journalName: s.journalName, title: s.title || '', status: s.status || 'submitted', overdueDays });
      }
    }
    return out.sort((a, b) => b.overdueDays - a.overdueDays).slice(0, 20);
  }

  /** 最近一次质量总分低于阈值的文档列表（子查询消除 N+1） */
  private lowQualityDocs(projectId?: string) {
    const rows = db
      .select({
        id: documents.id,
        title: documents.title,
        score: qualityReports.totalScore,
        date: qualityReports.createdAt,
      })
      .from(documents)
      .innerJoin(qualityReports, eq(qualityReports.documentId, documents.id))
      // 注意：物理表名是 document（单数），别名必须写 document.id；写成 documents.id 会抛
      // "no such column" 并被上层 catch 吞成「全 0」，导致总览恒为 0（历史缺陷）。
      .where(
        and(
          projectId ? eq(documents.projectId, projectId) : undefined,
          sql`quality_report.created_at = (SELECT MAX(qr.created_at) FROM quality_report qr WHERE qr.document_id = document.id)`,
        ),
      )
      .all();
    return rows.filter((r) => (r.score ?? 100) < LOW_SCORE_THRESHOLD).slice(0, 10);
  }
}
