import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, asc, desc, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { longformBooks, longformVolumes, longformChapters } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { planChapters, draftChapter, summarizeChapter } from './longform.agent';
import { checkConsistency } from './longform.consistency';

/**
 * 长篇写作服务：分卷 → 分章 → 逐章生成 → 前情压缩 → 断点续写。
 *
 * 关键设计：
 *  - **每章独立落库**：一章失败不影响已完成的章节，`status` 明确标记 pending/writing/done/failed；
 *  - **前情只传摘要**：`priorContext` 由上一章摘要 + 本卷已生成章节摘要拼成，永不传全文，
 *    这是百万字级不爆上下文的唯一可行做法；
 *  - **续写幂等**：`writeNextChapter` 只处理「下一个 pending 章节」，重复调用不会重复写同一章；
 *  - **失败可重试**：失败章节保留 error，重试时把 error 作为反馈再生成一次。
 */
@Injectable()
export class LongformService {
  private readonly logger = new Logger(LongformService.name);
  /** 同一本书同时只允许一个写作任务，避免并发写同一章 */
  private readonly running = new Set<string>();

  constructor(private readonly ai: AiService) {}

  // ---------- 书 / 卷 ----------

  createBook(input: { projectId: string; title: string; premise?: string; styleHint?: string; targetCharsPerChapter?: number }) {
    const title = String(input?.title || '').trim();
    if (!title) throw new BadRequestException('书名必填');
    if (!input?.projectId?.trim()) throw new BadRequestException('projectId 必填');
    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId: input.projectId.trim(),
      title: title.slice(0, 200),
      premise: String(input.premise || '').slice(0, 4000),
      styleHint: String(input.styleHint || '').slice(0, 1000),
      targetCharsPerChapter: Math.max(500, Math.min(20_000, Number(input.targetCharsPerChapter) || 3000)),
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(longformBooks).values(row).run();
    return this.getBook(row.id);
  }

  listBooks(projectId: string) {
    return db.select().from(longformBooks).where(eq(longformBooks.projectId, projectId)).orderBy(desc(longformBooks.updatedAt)).all();
  }

  getBook(id: string) {
    const book = db.select().from(longformBooks).where(eq(longformBooks.id, id)).get();
    if (!book) throw new NotFoundException('书籍不存在');
    const volumes = db.select().from(longformVolumes).where(eq(longformVolumes.bookId, id)).orderBy(asc(longformVolumes.seq)).all();
    const chapters = db.select().from(longformChapters).where(eq(longformChapters.bookId, id)).orderBy(asc(longformChapters.seq)).all();
    return {
      ...book,
      volumes,
      chapters,
      stats: this.stats(chapters),
    };
  }

  private stats(chapters: { status: string | null; chars: number | null }[]) {
    const done = chapters.filter((c) => c.status === 'done');
    return {
      total: chapters.length,
      done: done.length,
      pending: chapters.filter((c) => c.status === 'pending').length,
      failed: chapters.filter((c) => c.status === 'failed').length,
      chars: done.reduce((s, c) => s + (c.chars ?? 0), 0),
    };
  }

  /** 新建一卷并按目标章数生成章节计划（不写正文） */
  async addVolume(bookId: string, input: { title: string; goal?: string; chapters: number }) {
    const book = db.select().from(longformBooks).where(eq(longformBooks.id, bookId)).get();
    if (!book) throw new NotFoundException('书籍不存在');
    const target = Math.max(1, Math.min(200, Number(input?.chapters) || 10));
    const volumeTitle = String(input?.title || '').trim();
    if (!volumeTitle) throw new BadRequestException('卷标题必填');

    const lastSeq = db.select({ seq: longformVolumes.seq }).from(longformVolumes).where(eq(longformVolumes.bookId, bookId)).orderBy(desc(longformVolumes.seq)).get();
    const seq = (lastSeq?.seq ?? 0) + 1;
    const now = Date.now();
    const volumeId = randomUUID();
    db.insert(longformVolumes).values({ id: volumeId, bookId, seq, title: volumeTitle.slice(0, 200), goal: String(input.goal || '').slice(0, 2000), createdAt: now }).run();

    const priorSynopses = db
      .select({ summary: longformChapters.summary })
      .from(longformChapters)
      .where(and(eq(longformChapters.bookId, bookId), eq(longformChapters.status, 'done')))
      .orderBy(asc(longformChapters.seq))
      .all()
      .map((r) => r.summary || '')
      .filter(Boolean);

    const plan = await planChapters(this.ai, {
      bookTitle: book.title,
      premise: book.premise || '',
      volumeTitle,
      volumeGoal: String(input.goal || ''),
      priorSynopses,
      targetChapters: target,
      context: `longform:${bookId}:plan:v${seq}`,
    });

    const baseSeq = db.select({ seq: longformChapters.seq }).from(longformChapters).where(eq(longformChapters.bookId, bookId)).orderBy(desc(longformChapters.seq)).get()?.seq ?? 0;
    let i = 0;
    for (const ch of plan.chapters) {
      i += 1;
      db.insert(longformChapters)
        .values({
          id: randomUUID(),
          bookId,
          volumeId,
          seq: baseSeq + i,
          title: ch.title.slice(0, 200),
          goal: ch.goal.slice(0, 1000),
          beats: JSON.stringify(ch.beats ?? []),
          entities: JSON.stringify(ch.entities ?? []),
          content: '',
          summary: '',
          chars: 0,
          status: 'pending',
          error: '',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    db.update(longformBooks).set({ status: 'writing', updatedAt: Date.now() }).where(eq(longformBooks.id, bookId)).run();
    return this.getBook(bookId);
  }

  // ---------- 章节写作 ----------

  /** 写「下一个 pending 章节」；返回 null 表示已全部完成 */
  async writeNextChapter(bookId: string, opts: { retryFailed?: boolean } = {}) {
    if (this.running.has(bookId)) throw new BadRequestException('本书正在写作中，请等待当前章节完成');
    const book = db.select().from(longformBooks).where(eq(longformBooks.id, bookId)).get();
    if (!book) throw new NotFoundException('书籍不存在');

    const chapters = db.select().from(longformChapters).where(eq(longformChapters.bookId, bookId)).orderBy(asc(longformChapters.seq)).all();
    const next =
      chapters.find((c) => c.status === 'pending') ??
      (opts.retryFailed ? chapters.find((c) => c.status === 'failed') : undefined);
    if (!next) return { done: true, chapter: null, stats: this.stats(chapters) };

    this.running.add(bookId);
    db.update(longformChapters).set({ status: 'writing', error: '', updatedAt: Date.now() }).where(eq(longformChapters.id, next.id)).run();
    try {
      const volume = db.select().from(longformVolumes).where(eq(longformVolumes.id, next.volumeId)).get();
      // 前情 = 最近 8 章摘要（足够衔接，且不会撑爆上下文）
      const prior = chapters
        .filter((c) => c.seq < next.seq && c.summary)
        .slice(-8)
        .map((c) => `${c.title}：${c.summary}`)
        .join('\n');
      const previousEnding = chapters.filter((c) => c.seq === next.seq - 1 && c.content).slice(-1)[0]?.content?.slice(-600) ?? '';
      const priorContext = [prior, previousEnding ? `上一章结尾片段：${previousEnding}` : ''].filter(Boolean).join('\n\n');

      const body = await draftChapter(this.ai, {
        bookTitle: book.title,
        premise: book.premise || '',
        volumeTitle: volume?.title || '',
        chapterTitle: next.title,
        chapterGoal: next.goal || '',
        beats: this.parseList(next.beats),
        priorContext: next.error ? `${priorContext}\n\n【上次失败原因，需规避】${next.error.slice(0, 300)}` : priorContext,
        targetChars: book.targetCharsPerChapter ?? 3000,
        styleHint: book.styleHint || undefined,
        context: `longform:${bookId}:ch${next.seq}`,
      });
      if (!body || body.length < 200) throw new Error(`生成内容过短（${body?.length ?? 0} 字），疑似模型截断`);

      const summary = await summarizeChapter(this.ai, next.title, body, `longform:${bookId}:summary${next.seq}`);
      const chars = (body.match(/[\u4e00-\u9fa5]/g) || []).length || body.length;
      db.update(longformChapters)
        .set({ content: body, summary, chars, status: 'done', error: '', updatedAt: Date.now() })
        .where(eq(longformChapters.id, next.id))
        .run();
      this.logger.log(`[longform] ${bookId.slice(0, 8)} 第 ${next.seq} 章完成 ${chars} 字`);
      const fresh = db.select().from(longformChapters).where(eq(longformChapters.bookId, bookId)).all();
      return { done: false, chapter: { id: next.id, seq: next.seq, title: next.title, chars }, stats: this.stats(fresh) };
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 600);
      db.update(longformChapters).set({ status: 'failed', error: msg, updatedAt: Date.now() }).where(eq(longformChapters.id, next.id)).run();
      this.logger.warn(`[longform] ${bookId.slice(0, 8)} 第 ${next.seq} 章失败：${msg}`);
      const fresh = db.select().from(longformChapters).where(eq(longformChapters.bookId, bookId)).all();
      return { done: false, chapter: null, error: msg, failedSeq: next.seq, stats: this.stats(fresh) };
    } finally {
      this.running.delete(bookId);
    }
  }

  /** 连续写 N 章（无人值守批处理）；遇到失败即停，返回进度 */
  async writeChapters(bookId: string, count: number) {
    const limit = Math.max(1, Math.min(50, Number(count) || 1));
    const written: { seq: number; title: string; chars: number }[] = [];
    for (let i = 0; i < limit; i++) {
      const r = await this.writeNextChapter(bookId);
      if (r.done) break;
      if (r.error) return { stopped: true, error: r.error, failedSeq: r.failedSeq, written, stats: r.stats };
      if (r.chapter) written.push(r.chapter);
    }
    const book = this.getBook(bookId);
    const allDone = book.chapters.every((c) => c.status === 'done');
    if (allDone && book.chapters.length > 0) {
      db.update(longformBooks).set({ status: 'completed', updatedAt: Date.now() }).where(eq(longformBooks.id, bookId)).run();
    }
    return { stopped: false, written, stats: book.stats, allDone };
  }

  /** 全书一致性检查（确定性，不调模型）：实体漏写 / 疑似改名 / 未登记人名 */
  consistency(bookId: string) {
    const book = this.getBook(bookId);
    const chapters = book.chapters
      .filter((c) => c.status === 'done')
      .map((c) => ({ seq: c.seq, title: c.title, entities: this.parseList(c.entities), content: c.content || '' }));
    return { bookId, title: book.title, ...checkConsistency(chapters) };
  }

  /** 合并全文（按章序），用于导出 */
  compile(bookId: string) {
    const book = this.getBook(bookId);
    const done = book.chapters.filter((c) => c.status === 'done');
    const body = done.map((c) => `## ${c.title}\n\n${c.content}`).join('\n\n');
    return {
      title: book.title,
      chapters: done.length,
      chars: done.reduce((s, c) => s + (c.chars ?? 0), 0),
      markdown: `# ${book.title}\n\n${body}\n`,
    };
  }

  private parseList(raw: string | null | undefined): string[] {
    try {
      const v = JSON.parse(raw || '[]');
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }
}
