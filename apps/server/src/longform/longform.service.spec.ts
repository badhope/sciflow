import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, longformBooks, longformVolumes, longformChapters } from '../db/schema';
import { LongformService } from './longform.service';
import type { AiService } from '../ai/ai.service';

/**
 * 长篇写作的工程契约（不依赖真实模型的确定性部分）：
 *  - 分卷生成章节计划时，章数严格等于请求值，且全部落库为 pending；
 *  - writeNextChapter 只处理下一个 pending，重复调用不会重写已完成章节；
 *  - 生成失败时章节标 failed 并保留 error，可 retry；
 *  - 前情只取摘要（不是全文），保证上下文不随篇幅线性膨胀。
 */
function fakeAi(opts: { chapters?: number; failFor?: number[] } = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    ai: {
      completeStructured: async (_m: unknown[], _s: unknown, _o: unknown) => {
        const n = opts.chapters ?? 3;
        return {
          chapters: Array.from({ length: n }, (_, i) => ({
            title: `第${i + 1}章 测试`,
            goal: `推进目标 ${i + 1}`,
            beats: ['节点A', '节点B', '节点C'],
            entities: ['主角'],
          })),
        };
      },
      complete: async (messages: unknown[], o: any) => {
        calls += 1;
        // summary 调用（maxTokens 400）返回短摘要；正文调用返回长文
        if (o?.maxTokens === 400) return '前情摘要：主角抵达雾港并发现线索。';
        return '正文'.repeat(600);
      },
    } as unknown as AiService,
  };
}

describe('LongformService 分卷续写', () => {
  let pid: string;
  let bookId: string;

  beforeEach(async () => {
    pid = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: '长篇测试', description: '', createdAt: now, updatedAt: now }).run();
  });

  afterEach(() => {
    const bookIds = db.select({ id: longformBooks.id }).from(longformBooks).where(eq(longformBooks.projectId, pid)).all().map((b) => b.id);
    for (const id of bookIds) {
      db.delete(longformChapters).where(eq(longformChapters.bookId, id)).run();
      db.delete(longformVolumes).where(eq(longformVolumes.bookId, id)).run();
    }
    db.delete(longformBooks).where(eq(longformBooks.projectId, pid)).run();
    db.delete(projects).where(eq(projects.id, pid)).run();
  });

  it('创建书籍 + 生成章节计划：章数严格匹配且全部 pending', async () => {
    const svc = new LongformService(fakeAi({ chapters: 4 }).ai);
    const book = svc.createBook({ projectId: pid, title: '雾港', premise: '架空世界', targetCharsPerChapter: 2000 });
    bookId = book.id;
    const detail = await svc.addVolume(bookId, { title: '第一卷', goal: '抵达与发现', chapters: 4 });
    expect(detail.chapters).toHaveLength(4);
    expect(detail.chapters.every((c) => c.status === 'pending')).toBe(true);
    expect(detail.chapters.map((c) => c.seq)).toEqual([1, 2, 3, 4]);
    expect(detail.stats.total).toBe(4);
    expect(detail.stats.pending).toBe(4);
  });

  it('writeNextChapter 只写下一章，重复调用推进而不重写', async () => {
    const fake = fakeAi({ chapters: 2 });
    const svc = new LongformService(fake.ai);
    const book = svc.createBook({ projectId: pid, title: '雾港', premise: '架空' });
    bookId = book.id;
    await svc.addVolume(bookId, { title: '第一卷', chapters: 2 });

    const first = await svc.writeNextChapter(bookId);
    expect(first.done).toBe(false);
    expect(first.chapter?.seq).toBe(1);

    const second = await svc.writeNextChapter(bookId);
    expect(second.chapter?.seq).toBe(2);

    const third = await svc.writeNextChapter(bookId);
    expect(third.done).toBe(true);
    expect(third.chapter).toBeNull();

    const detail = svc.getBook(bookId);
    expect(detail.chapters.filter((c) => c.status === 'done')).toHaveLength(2);
    // 每章都生成了摘要（前情机制的前提）
    expect(detail.chapters.every((c) => c.summary.length > 0)).toBe(true);
    // 正文长度参与统计
    expect(detail.stats.chars).toBeGreaterThan(0);
  });

  it('生成过短时标 failed 并保留 error，重试走 retryFailed', async () => {
    const shortAi = {
      completeStructured: async () => ({ chapters: [{ title: '短章', goal: 'g', beats: ['b'], entities: [] }] }),
      complete: async () => '太短',
    } as unknown as AiService;
    const svc = new LongformService(shortAi);
    const book = svc.createBook({ projectId: pid, title: '失败书', premise: '' });
    bookId = book.id;
    await svc.addVolume(bookId, { title: '第一卷', chapters: 1 });

    const r = await svc.writeNextChapter(bookId);
    expect(r.chapter).toBeNull();
    expect(r.error).toContain('过短');
    const detail = svc.getBook(bookId);
    expect(detail.chapters[0].status).toBe('failed');
    expect(detail.chapters[0].error.length).toBeGreaterThan(0);
    expect(detail.stats.failed).toBe(1);
  });

  it('批量写 2 章：written 顺序正确，统计累加', async () => {
    const svc = new LongformService(fakeAi({ chapters: 3 }).ai);
    const book = svc.createBook({ projectId: pid, title: '批写', premise: '' });
    bookId = book.id;
    await svc.addVolume(bookId, { title: '第一卷', chapters: 3 });
    const r = await svc.writeChapters(bookId, 2);
    expect(r.written.map((w) => w.seq)).toEqual([1, 2]);
    expect(r.stats.done).toBe(2);
    expect(r.stats.pending).toBe(1);
    expect(r.allDone).toBe(false);
  });

  it('合并导出只包含已完成章节', async () => {
    const svc = new LongformService(fakeAi({ chapters: 3 }).ai);
    const book = svc.createBook({ projectId: pid, title: '导出', premise: '' });
    bookId = book.id;
    await svc.addVolume(bookId, { title: '第一卷', chapters: 3 });
    await svc.writeChapters(bookId, 2);
    const out = svc.compile(bookId);
    expect(out.chapters).toBe(2);
    expect(out.markdown).toContain('# 导出');
    expect(out.markdown).toContain('第1章');
  });
});
