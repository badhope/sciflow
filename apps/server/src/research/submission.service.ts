import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, asc, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/database';
import { journals, submissions, submissionStatusEvents, SUBMISSION_STATUSES, projects, reflexionLogs, documents } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { buildRevisionPlan } from './revision-plan';

/** 状态码校验：不在 13 个枚举内一律拒绝（zod refine） */
const statusEnum = z.string().refine((s) => (SUBMISSION_STATUSES as readonly string[]).includes(s), '未知投稿状态');

/** AI 期刊匹配结构化输出：{ journals: [{ name, score, reason, gap }] } */
const journalMatchSchema = z.object({
  journals: z
    .array(
      z.object({
        name: z.string(),
        score: z.number(),
        reason: z.string(),
        gap: z.string(),
      }),
    )
    .min(1),
});

/** AI 邮件解析结构化输出：只取建议状态 + 置信度 + 理由 + 可选日期 */
const parseEmailSchema = z.object({
  suggestedStatus: statusEnum,
  confidence: z.number().min(0).max(1).optional().default(0.5),
  reason: z.string().optional().default(''),
  date: z.string().optional().default(''),
});

/** 终态：不再做超期推断 */
const TERMINAL_STATUSES = new Set(['rejected', 'withdrawn', 'accepted', 'in_production', 'transferred']);
/** 返修链路状态：超期推断从投稿日粗推时直接沿用当前阶段 */
const REVISION_STATUSES = new Set(['minor_revision', 'major_revision', 're_review', 'final_review']);

@Injectable()
export class SubmissionService {
  constructor(private readonly ai: AiService) {}

  /** 期刊推荐 */
  recommendJournals(title: string, abstract: string, field: string) {
    if (!title && !abstract) throw new BadRequestException('请提供论文标题或摘要');
    return this.ai.recommendJournal(title || '(未命名)', abstract || '(未提供摘要)', field || '通用');
  }

  /** Cover Letter（AI 生成失败时转可读异常，不暴露 stack） */
  async coverLetter(title: string, abstract: string, journal: string) {
    if (!journal) throw new BadRequestException('请指定目标期刊');
    try {
      return await this.ai.coverLetter(title || '(未命名)', abstract || '', journal);
    } catch {
      throw new BadRequestException('封面信生成失败：AI 服务暂不可用，请稍后重试或检查模型配置');
    }
  }

  /** 审稿意见回复（AI 生成失败时转可读异常，不暴露 stack）。
   *  评审闭环第一环：同时产出结构化修改计划；传 taskId 时把回链写入 reflexion_log。 */
  async replyReview(reviewComments: string, response = '', taskId?: string) {
    if (!reviewComments) throw new BadRequestException('请粘贴审稿意见');
    try {
      const revisionPlan = buildRevisionPlan(reviewComments);
      const letter = await this.ai.replyReview(reviewComments, response);
      let reflexionId: string | null = null;
      if (taskId) {
        const round = db.select().from(reflexionLogs).where(eq(reflexionLogs.taskId, taskId)).all().length + 1;
        const id = randomUUID();
        db.insert(reflexionLogs).values({
          id,
          taskId,
          round,
          note: `评审意见回链：${revisionPlan.length} 条修改计划`,
          instructions: JSON.stringify(revisionPlan.map((r) => r.excerpt)),
          createdAt: Date.now(),
        }).run();
        reflexionId = id;
      }
      return { letter, revisionPlan, reflexionId };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('回复信生成失败：AI 服务暂不可用，请稍后重试或检查模型配置');
    }
  }

  // ---------- 自建期刊库 ----------

  /** 列出全部期刊 */
  listJournals() {
    return db.select().from(journals).orderBy(journals.name).all();
  }

  /** 新增期刊（指标类字段缺失即 NULL，禁止编造） */
  addJournal(body: {
    name: string;
    issn?: string;
    publisher?: string;
    scopeText?: string;
    if2024?: number | null;
    quartile?: string;
    firstDecisionWeeks?: number | null;
    acceptanceRate?: number | null;
    oa?: string;
  }) {
    if (!body.name?.trim()) throw new BadRequestException('期刊名必填');
    const row = {
      id: randomUUID(),
      name: body.name.trim(),
      issn: body.issn || '',
      publisher: body.publisher || '',
      scopeText: body.scopeText || '',
      if2024: body.if2024 ?? null,
      quartile: body.quartile || '',
      firstDecisionWeeks: body.firstDecisionWeeks ?? null,
      acceptanceRate: body.acceptanceRate ?? null,
      oa: body.oa || '',
      createdAt: Date.now(),
    };
    db.insert(journals).values(row).run();
    return row;
  }

  /** 删除期刊 */
  deleteJournal(id: string) {
    const row = db.select().from(journals).where(eq(journals.id, id)).get();
    if (!row) throw new NotFoundException('期刊不存在');
    db.delete(journals).where(eq(journals.id, id)).run();
    return { ok: true };
  }

  /** 结构化期刊推荐：AI 给 3-6 条候选，命中库内期刊则补充指标并标记 isInLibrary */
  async matchJournals(title: string, abstract: string) {
    if (!title.trim() && !abstract.trim()) throw new BadRequestException('请提供论文标题或摘要');
    const custom = this.ai.getCustomPrompt('journalsMatch');
    const userContent =
      custom ??
      `你是学术投稿顾问。请根据下面这篇论文的标题与摘要，推荐 3-6 本最适合投稿的学术期刊（中文期刊优先，兼顾国际中文圈常见方向）。` +
        `严格只输出 JSON 对象：{"journals":[{"name":"期刊名","score":0到100的匹配分,"reason":"为什么匹配","gap":"还需补强/注意什么"}]}。\n\n` +
        `论文标题：${title || '(未提供)'}\n摘要：${(abstract || '(未提供)').slice(0, 1500)}`;
    let parsed: z.infer<typeof journalMatchSchema> | null;
    try {
      const raw = await this.ai.complete([{ role: 'user', content: userContent }], {
        temperature: 0.4,
        model: 'strong',
        context: 'journalsMatch',
      });
      parsed = this.ai.safeParse(raw, journalMatchSchema);
    } catch {
      throw new BadRequestException('期刊推荐失败：AI 服务暂不可用，请稍后重试或检查模型配置');
    }
    if (!parsed) throw new BadRequestException('期刊推荐结果解析失败，请重试');

    // 库内期刊按名称（忽略大小写/空白）建索引，用于补充指标
    const lib = this.listJournals();
    const byName = new Map<string, (typeof lib)[number]>();
    for (const j of lib) byName.set(j.name.trim().toLowerCase(), j);

    const items = parsed.journals.slice(0, 6).map((j) => {
      const hit = byName.get(j.name.trim().toLowerCase());
      return {
        name: j.name,
        score: Math.max(0, Math.min(100, Number(j.score) || 0)),
        reason: j.reason || '',
        gap: j.gap || '',
        isInLibrary: Boolean(hit),
        if2024: hit?.if2024 ?? null,
        quartile: hit?.quartile ?? '',
        firstDecisionWeeks: hit?.firstDecisionWeeks ?? null,
        acceptanceRate: hit?.acceptanceRate ?? null,
        oa: hit?.oa ?? '',
      };
    });
    return { journals: items };
  }

  // ---------- 投稿流程状态跟踪（L1 手动台账 + L2 AI 解析邮件 + L3 周期推断） ----------

  private getTrackOrThrow(id: string) {
    const row = db.select().from(submissions).where(eq(submissions.id, id)).get();
    if (!row) throw new NotFoundException('投稿记录不存在');
    return row;
  }

  private eventsOf(submissionId: string) {
    return db
      .select()
      .from(submissionStatusEvents)
      .where(eq(submissionStatusEvents.submissionId, submissionId))
      .orderBy(asc(submissionStatusEvents.eventAt), asc(submissionStatusEvents.createdAt))
      .all();
  }

  /** L3 读时推断：投稿日期 + journal.firstDecisionWeeks → 预计阶段 / 超期（不落库、不覆盖真实状态） */
  private infer(row: { currentStatus: string | null; submittedAt: number | null }, firstDecisionWeeks: number | null) {
    const status = row.currentStatus || 'submitted';
    if (!firstDecisionWeeks || !row.submittedAt || TERMINAL_STATUSES.has(status)) {
      return { dueAt: null, overdue: false, overdueDays: 0, estimatedStage: null as string | null };
    }
    const now = Date.now();
    const weekMs = 7 * 24 * 3600 * 1000;
    const dueAt = row.submittedAt + firstDecisionWeeks * weekMs;
    const overdue = now > dueAt;
    const overdueDays = overdue ? Math.floor((now - dueAt) / (24 * 3600 * 1000)) : 0;
    // 返修链路：阶段由真实状态决定；投稿到一审结果之间：<1w 收稿 / <2w 初审 / <fdw 外审 / ≥fdw 意见应已回
    let estimatedStage: string;
    if (REVISION_STATUSES.has(status)) {
      estimatedStage = status;
    } else {
      const elapsedWeeks = (now - row.submittedAt) / weekMs;
      estimatedStage = elapsedWeeks < 1 ? 'submitted' : elapsedWeeks < 2 ? 'initial_review' : elapsedWeeks < firstDecisionWeeks ? 'external_review' : 'review_returned';
    }
    return { dueAt, overdue, overdueDays, estimatedStage };
  }

  private decorate(row: typeof submissions.$inferSelect) {
    const journal = row.journalId ? db.select().from(journals).where(eq(journals.id, row.journalId)).get() : null;
    const events = this.eventsOf(row.id);
    return { ...row, journalName: row.journalName, events, ...this.infer(row, journal?.firstDecisionWeeks ?? null) };
  }

  /** L1 登记投稿：创建记录并写入首条状态事件（可选：转投串联 previousSubmissionId / 修回截止日 revisionDeadline） */
  createTrack(body: { projectId: string; journalId?: string; journalName: string; documentId?: string; title?: string; submittedAt?: number; currentStatus?: string; note?: string; previousSubmissionId?: string; revisionDeadline?: number | null }) {
    if (!body.projectId?.trim()) throw new BadRequestException('projectId 必填');
    if (!body.journalName?.trim()) throw new BadRequestException('期刊名必填');
    const project = db.select({ id: projects.id }).from(projects).where(eq(projects.id, body.projectId.trim())).get();
    if (!project) throw new BadRequestException('项目不存在');
    const status = body.currentStatus || 'submitted';
    if (!statusEnum.safeParse(status).success) throw new BadRequestException('未知投稿状态');
    if (body.revisionDeadline !== undefined && body.revisionDeadline !== null && typeof body.revisionDeadline !== 'number') {
      throw new BadRequestException('revisionDeadline 必须为时间戳或 null');
    }
    const now = Date.now();
    const submittedAt = body.submittedAt || now;
    const id = randomUUID();
    /**
     * 标题来源优先级：显式传入 > 关联文档标题 > 空串。
     * 历史实现恒写空串，导致驾驶舱「超期投稿」永远渲染成 "期刊 · "（尾随空标题）。
     */
    const docTitle = body.documentId
      ? (db.select({ title: documents.title }).from(documents).where(eq(documents.id, body.documentId)).get()?.title ?? '')
      : '';
    const title = String(body.title || docTitle || '').trim().slice(0, 500);
    db.insert(submissions)
      .values({
        id,
        projectId: body.projectId.trim(),
        documentId: body.documentId || '',
        journalId: body.journalId || '',
        journalName: body.journalName.trim(),
        title,
        submittedAt,
        currentStatus: status,
        statusUpdatedAt: now,
        notes: body.note || '',
        revisionDeadline: typeof body.revisionDeadline === 'number' ? body.revisionDeadline : null,
        previousSubmissionId: body.previousSubmissionId || '',
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(submissionStatusEvents)
      .values({
        id: randomUUID(),
        submissionId: id,
        fromStatus: '',
        toStatus: status,
        eventAt: submittedAt,
        source: 'manual',
        confidence: 1,
        note: body.note || '',
        createdAt: now,
      })
      .run();
    return this.decorate(this.getTrackOrThrow(id));
  }

  /** L1 列表：每条含最新状态、全部事件（时间正序）、L3 超期推断字段 */
  listTracks(projectId: string) {
    if (!projectId?.trim()) throw new BadRequestException('projectId 必填');
    const rows = db.select().from(submissions).where(eq(submissions.projectId, projectId)).all();
    if (!rows.length) return [];
    // 批量取期刊与事件，消除 2N 次逐行查询（N+1）
    const journalIds = [...new Set(rows.map((r) => r.journalId).filter(Boolean))] as string[];
    const journalRows = journalIds.length
      ? db.select().from(journals).where(inArray(journals.id, journalIds)).all()
      : [];
    const journalMap = new Map(journalRows.map((j) => [j.id, j]));
    const idList = rows.map((r) => r.id);
    const eventRows = db.select().from(submissionStatusEvents).where(inArray(submissionStatusEvents.submissionId, idList)).all();
    const eventsBySubmission = new Map<string, typeof eventRows>();
    for (const e of eventRows) {
      const list = eventsBySubmission.get(e.submissionId) || [];
      list.push(e);
      eventsBySubmission.set(e.submissionId, list);
    }
    return rows
      .map((r) => {
        const journal = r.journalId ? journalMap.get(r.journalId) : undefined;
        const events = (eventsBySubmission.get(r.id) || []).sort((a, b) => a.eventAt - b.eventAt);
        return { ...r, journalName: r.journalName, events, ...this.infer(r, journal?.firstDecisionWeeks ?? null) };
      })
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
  }

  /** L1 追加状态事件：date 缺省为现在；自动维护 currentStatus 缓存（事件+状态更新为事务） */
  addTrackEvent(id: string, body: { status: string; date?: number; note?: string; source?: string; rawEmailText?: string; confidence?: number }) {
    const row = this.getTrackOrThrow(id);
    if (!statusEnum.safeParse(body.status).success) throw new BadRequestException('未知投稿状态');
    const now = Date.now();
    const eventAt = body.date || now;
    db.transaction((tx) => {
      tx.insert(submissionStatusEvents)
        .values({
          id: randomUUID(),
          submissionId: id,
          fromStatus: row.currentStatus,
          toStatus: body.status,
          eventAt,
          source: body.source || 'manual',
          rawEmailText: body.rawEmailText || '',
          confidence: body.confidence ?? 1,
          note: body.note || '',
          createdAt: now,
        })
        .run();
      tx.update(submissions)
        .set({ currentStatus: body.status, statusUpdatedAt: now, updatedAt: now })
        .where(eq(submissions.id, id))
        .run();
    });
    return this.decorate(this.getTrackOrThrow(id));
  }

  /** L2 AI 解析编辑部邮件：只给建议，不改库；用户确认后再走 addTrackEvent 入库 */
  async parseTrackEmail(body: { emailText: string; currentStatus?: string }) {
    if (!body.emailText?.trim()) throw new BadRequestException('请粘贴编辑部邮件正文');
    const custom = this.ai.getCustomPrompt('parseSubmissionEmail');
    const allowed = SUBMISSION_STATUSES.join(' | ');
    const userContent =
      custom ??
      `你是学术投稿助手。阅读下面这封编辑部来稿邮件，判断稿件当前应处于哪个审稿阶段。` +
        `严格只输出 JSON 对象：{"suggestedStatus":"状态码","confidence":0到1的小数,"reason":"一句话依据","date":"该状态发生日期 YYYY-MM-DD，没有则空串"}。\n` +
        `suggestedStatus 只能取以下枚举之一：${allowed}。\n` +
        `当前已登记状态：${body.currentStatus || '未知'}。\n\n` +
        `邮件正文：\n${body.emailText.slice(0, 4000)}`;
    let parsed: z.infer<typeof parseEmailSchema> | null;
    try {
      const raw = await this.ai.complete([{ role: 'user', content: userContent }], {
        temperature: 0.2,
        context: 'parseSubmissionEmail',
      });
      parsed = this.ai.safeParse(raw, parseEmailSchema);
    } catch {
      throw new BadRequestException('邮件解析失败：AI 服务暂不可用，请稍后重试或检查模型配置');
    }
    if (!parsed) throw new BadRequestException('邮件解析结果失败：无法识别邮件中的状态信息，请手动选择状态');
    return {
      suggestedStatus: parsed.suggestedStatus,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: parsed.reason || '',
      date: parsed.date || undefined,
    };
  }

  /** PATCH：改 notes / currentStatus（状态变化同步写一条历史事件）/ revisionDeadline（修回截止日） */
  updateTrack(id: string, patch: { notes?: string; currentStatus?: string; revisionDeadline?: number | null }) {
    const row = this.getTrackOrThrow(id);
    const set: Record<string, unknown> = { updatedAt: Date.now() };
    if (typeof patch.notes === 'string') set.notes = patch.notes;
    if (patch.revisionDeadline !== undefined) {
      if (patch.revisionDeadline === null) {
        set.revisionDeadline = null;
      } else if (typeof patch.revisionDeadline === 'number') {
        set.revisionDeadline = patch.revisionDeadline;
      } else {
        throw new BadRequestException('revisionDeadline 必须为时间戳或 null');
      }
    }
    if (typeof patch.currentStatus === 'string' && patch.currentStatus !== row.currentStatus) {
      if (!statusEnum.safeParse(patch.currentStatus).success) throw new BadRequestException('未知投稿状态');
      set.currentStatus = patch.currentStatus;
      set.statusUpdatedAt = Date.now();
      const fromStatus = row.currentStatus;
      const toStatus = patch.currentStatus;
      db.transaction((tx) => {
        tx.insert(submissionStatusEvents)
          .values({
            id: randomUUID(),
            submissionId: id,
            fromStatus,
            toStatus,
            eventAt: Date.now(),
            source: 'manual',
            confidence: 1,
            note: '',
            createdAt: Date.now(),
          })
          .run();
        tx.update(submissions).set(set).where(eq(submissions.id, id)).run();
      });
    } else {
      db.update(submissions).set(set).where(eq(submissions.id, id)).run();
    }
    return this.decorate(this.getTrackOrThrow(id));
  }

  /** 删除投稿记录（级联清状态事件） */
  removeTrack(id: string) {
    this.getTrackOrThrow(id);
    db.delete(submissionStatusEvents).where(eq(submissionStatusEvents.submissionId, id)).run();
    db.delete(submissions).where(eq(submissions.id, id)).run();
    return { ok: true };
  }
}
