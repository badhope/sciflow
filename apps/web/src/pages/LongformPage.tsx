import { useContext, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, Loader2, PenLine, Plus } from 'lucide-react';
import { api } from '../api/client';
import type { LongformBookDetail } from '../api/longform';
import type { Project } from '../types';
import { ToastContext } from '../App';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, SectionTitle, Select, Spinner, Textarea, errMsg } from '../components/ui';

/**
 * 长篇写作（百万字级）：分卷 → 分章 → 逐章生成 → 断点续写。
 *
 * 与「论文写作」的区别写在页面上：这里产出的是书，按章增量生成，
 * 每章独立落库、失败可重试、已完成永不覆盖；前情只走摘要，所以能写很长。
 */
const STATUS_LABEL: Record<string, string> = {
  planning: '规划中',
  writing: '写作中',
  completed: '已完成',
  paused: '已暂停',
};

export function LongformPage({ project }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // 新建书籍表单
  const [title, setTitle] = useState('');
  const [premise, setPremise] = useState('');
  const [styleHint, setStyleHint] = useState('');
  const [charsPerChapter, setCharsPerChapter] = useState('2500');

  // 新建卷表单
  const [volTitle, setVolTitle] = useState('');
  const [volGoal, setVolGoal] = useState('');
  const [volChapters, setVolChapters] = useState('5');

  const booksQuery = useQuery({
    queryKey: ['longform-books', project.id],
    queryFn: () => api.longform.list(project.id),
  });
  const books = booksQuery.data ?? [];
  const bookId = selected || books[0]?.id || '';

  const detailQuery = useQuery({
    queryKey: ['longform-book', bookId],
    queryFn: () => api.longform.get(bookId),
    enabled: Boolean(bookId),
  });
  const book: LongformBookDetail | undefined = detailQuery.data;

  useEffect(() => {
    if (detailQuery.error) setError(errMsg(detailQuery.error));
  }, [detailQuery.error]);

  const refresh = async (id = bookId) => {
    await qc.invalidateQueries({ queryKey: ['longform-books', project.id] });
    if (id) await qc.invalidateQueries({ queryKey: ['longform-book', id] });
  };

  const createBook = async () => {
    if (!title.trim()) {
      toast('error', '请填写书名');
      return;
    }
    setBusy('create');
    setError('');
    try {
      const created = await api.longform.create({
        projectId: project.id,
        title: title.trim(),
        premise: premise.trim(),
        styleHint: styleHint.trim(),
        targetCharsPerChapter: Number(charsPerChapter) || 2500,
      });
      setTitle('');
      setPremise('');
      setStyleHint('');
      setSelected(created.id);
      await refresh(created.id);
      toast('success', '书籍已创建，下一步添加卷并生成章节计划');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const addVolume = async () => {
    if (!bookId || !volTitle.trim()) {
      toast('error', '请填写卷标题');
      return;
    }
    setBusy('volume');
    setError('');
    try {
      await api.longform.addVolume(bookId, { title: volTitle.trim(), goal: volGoal.trim(), chapters: Number(volChapters) || 5 });
      setVolTitle('');
      setVolGoal('');
      await refresh();
      toast('success', '章节计划已生成');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const writeNext = async (retryFailed = false) => {
    if (!bookId) return;
    setBusy('next');
    setError('');
    try {
      const r = await api.longform.writeNext(bookId, { retryFailed });
      if (r.done) toast('info', '没有待写章节了');
      else if (r.error) setError(`第 ${r.failedSeq} 章失败：${r.error}`);
      else if (r.chapter) toast('success', `第 ${r.chapter.seq} 章完成（${r.chapter.chars} 字）`);
      await refresh();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const writeBatch = async () => {
    if (!bookId) return;
    setBusy('batch');
    setError('');
    try {
      const r = await api.longform.write(bookId, 3);
      if (r.error) setError(`第 ${r.stopped ? '后续' : ''}章节失败：${r.error}`);
      else toast('success', `本轮写完 ${r.written.length} 章（累计 ${r.stats.chars} 字）`);
      await refresh();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    if (!bookId) return;
    setBusy('export');
    try {
      const r = await api.longform.compile(bookId);
      const blob = new Blob([r.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.title}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast('success', `已导出 ${r.chapters} 章 / ${r.chars} 字`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const chaptersByVolume = useMemo<{ volume: LongformBookDetail['volumes'][number]; chapters: LongformBookDetail['chapters'] }[]>(() => {
    if (!book) return [];
    return book.volumes.map((v) => ({
      volume: v,
      chapters: book.chapters.filter((c) => c.volumeId === v.id),
    }));
  }, [book]);

  return (
    <div className="page-container">
      <ErrorBox message={error} />

      <Card tone="inset" className="mb-4 p-4">
        <SectionTitle extra={book ? <Badge tone={book.status === 'completed' ? 'green' : 'amber'}>{STATUS_LABEL[book.status] || book.status}</Badge> : undefined}>
          <span className="flex items-center gap-2">
            <BookOpen size={16} className="text-teal-600" /> 长篇写作
          </span>
        </SectionTitle>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          分卷 → 分章 → 逐章生成。每章独立落库、失败可重试、已完成不覆盖；跨章只传摘要，因此可以写很长。
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="书名" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="书名" />
          <Input
            placeholder={`单章目标字数（当前 ${charsPerChapter}）`}
            value={charsPerChapter}
            onChange={(e) => setCharsPerChapter(e.target.value.replace(/[^0-9]/g, ''))}
            aria-label="单章目标字数"
          />
        </div>
        <Textarea rows={2} className="mt-2" placeholder="核心设定 / 世界观（每章都会带上，防止跑偏）" value={premise} onChange={(e) => setPremise(e.target.value)} aria-label="核心设定" />
        <Input className="mt-2" placeholder="文风要求（可选，例如：冷峻短句、克制对白）" value={styleHint} onChange={(e) => setStyleHint(e.target.value)} aria-label="文风要求" />
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={() => void createBook()} loading={busy === 'create'} disabled={!title.trim()}>
            <Plus size={14} /> 新建书籍
          </Button>
          {books.length > 0 && (
            <Select
              className="w-full sm:w-64"
              options={books.map((b) => ({ value: b.id, label: b.title }))}
              value={bookId}
              onChange={(v: string) => setSelected(v)}
            />
          )}
        </div>
      </Card>

      {booksQuery.isLoading ? (
        <Spinner label="加载书籍" />
      ) : !bookId ? (
        <EmptyState illustration="documents" title="还没有长篇项目" hint="先在上面新建一本书，再添加第一卷并生成章节计划" />
      ) : !book ? (
        <Spinner label="加载书籍详情" />
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-200">{book.title}</span>
              <span>共 {book.stats.total} 章</span>
              <span className="text-emerald-600">完成 {book.stats.done}</span>
              <span>待写 {book.stats.pending}</span>
              {book.stats.failed > 0 && <span className="text-rose-600">失败 {book.stats.failed}</span>}
              <span>累计 {book.stats.chars.toLocaleString()} 字</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input placeholder="卷标题（如：第一卷 雾港）" value={volTitle} onChange={(e) => setVolTitle(e.target.value)} aria-label="卷标题" />
              <Input placeholder="本卷目标（可选）" value={volGoal} onChange={(e) => setVolGoal(e.target.value)} aria-label="本卷目标" />
              <div className="flex gap-2">
                <Input
                  className="w-24"
                  placeholder="章数"
                  value={volChapters}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setVolChapters(e.target.value.replace(/[^0-9]/g, ''))}
                  aria-label="章数"
                />
                <Button onClick={() => void addVolume()} loading={busy === 'volume'} disabled={!volTitle.trim()}>
                  生成章节计划
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="success" onClick={() => void writeNext()} loading={busy === 'next'} disabled={book.stats.pending === 0 && book.stats.failed === 0}>
                <PenLine size={14} /> 写下一章
              </Button>
              <Button variant="outline" onClick={() => void writeNext(true)} loading={busy === 'next'} disabled={book.stats.failed === 0}>
                重试失败章节
              </Button>
              <Button variant="outline" onClick={() => void writeBatch()} loading={busy === 'batch'} disabled={book.stats.pending === 0}>
                <Loader2 size={14} className={busy === 'batch' ? 'animate-spin' : ''} /> 连写 3 章
              </Button>
              <Button variant="ghost" onClick={() => void download()} loading={busy === 'export'} disabled={book.stats.done === 0}>
                <Download size={14} /> 导出 Markdown
              </Button>
            </div>
          </Card>

          {chaptersByVolume.length === 0 ? (
            <EmptyState illustration="documents" title="还没有卷" hint="填卷标题与章数，系统会先生成章节计划（不写正文）" />
          ) : (
            <div className="space-y-4">
              {chaptersByVolume.map(({ volume, chapters }) => (
                <Card key={volume.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      第 {volume.seq} 卷 · {volume.title}
                    </span>
                    {volume.goal && <span className="text-[11px] text-slate-400">{volume.goal}</span>}
                    <span className="ml-auto text-[11px] text-slate-400">
                      {chapters.filter((c) => c.status === 'done').length}/{chapters.length} 完成
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {chapters.map((c) => (
                      <div key={c.id} className="rounded border border-slate-200 p-2 dark:border-slate-700">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone={c.status === 'done' ? 'green' : c.status === 'failed' ? 'red' : c.status === 'writing' ? 'amber' : 'slate'}>
                            {c.status === 'done' ? '已写' : c.status === 'failed' ? '失败' : c.status === 'writing' ? '写作中' : '待写'}
                          </Badge>
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            第 {c.seq} 章 · {c.title}
                          </span>
                          {c.chars > 0 && <span className="text-slate-400">{c.chars} 字</span>}
                        </div>
                        {c.goal && <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">目标：{c.goal}</div>}
                        {c.error && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{c.error}</div>}
                        {c.summary && <div className="mt-1 text-[11px] text-slate-400">前情：{c.summary}</div>}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
