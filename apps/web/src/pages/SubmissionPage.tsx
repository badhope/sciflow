import { useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, MessageSquareReply, Plus, Send } from 'lucide-react';
import { api } from '../api/client';
import { ToastContext } from '../App';
import type { Journal, JournalMatchResult, ParseEmailResult, Project, ReviewComment, RevisionQueue, RevisionQueueItem, RevisionQueueSummary, SubmissionStatus, SubmissionTrack } from '../types';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Input, Select, Spinner, Textarea, errMsg } from '../components/ui';
import { DocumentSelect } from '../components/DocumentSelect';
import { SubmissionReadinessPanel } from './submission/SubmissionReadinessPanel';
import { JournalLibrary, type JournalLibraryForm } from './submission/JournalLibrary';
import { JournalMatches } from './submission/JournalMatches';
import { SubmissionTabNav } from './submission/SubmissionTabNav';
import { TrackCard } from './submission/TrackCard';
import { RevisionQueueHistory, RevisionQueuePanel } from './submission/RevisionQueuePanel';
import { REVISION_STATUSES, STATUS_META, STATUS_OPTIONS, inferStatusFromComments, todayISO, type SubmissionTab } from './submission/status';
import { useProjectDocs } from '../lib/queries';
import { qk } from '../lib/query-keys';

type RevisionPlanItem = { id: string; excerpt: string; category: string; severity: string; suggestedAction: string };

/** 从 Markdown 正文提取 1–4 级标题（与后端 extractSections 的标题口径保持一致） */
function sectionTitlesOf(content: string): string[] {
  const titles: string[] = [];
  for (const line of (content || '').split(/\r?\n/)) {
    const m = /^#{1,4}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) titles.push(m[1].trim());
  }
  return titles;
}

/** 计划条目与已录入审稿意见的确定性匹配：只有唯一命中才回链，避免自动关闭错的意见。 */
function matchReviewCommentId(item: RevisionPlanItem, comments: ReviewComment[]): string {
  const norm = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const excerpt = norm(item.excerpt || '');
  if (excerpt.length < 6) return '';
  const hits = comments.filter((c) => {
    if (c.status !== 'open') return false;
    const comment = norm(c.commentText || '');
    const quote = norm(c.quote || '');
    return comment.includes(excerpt) || excerpt.includes(comment) || (quote.length >= 6 && (quote.includes(excerpt) || excerpt.includes(quote)));
  });
  return hits.length === 1 ? hits[0].id : '';
}

/** 计划条目未显式指定章节时，按 excerpt + suggestedAction 匹配最长标题；匹配不到就留空让用户选 */
function inferPlanSection(item: RevisionPlanItem, titles: string[]): string {
  const hay = `${item.excerpt}\n${item.suggestedAction}`.toLowerCase();
  let best = '';
  for (const title of titles) {
    if (title && hay.includes(title.toLowerCase()) && title.length > best.length) best = title;
  }
  return best;
}

function isQueueTerminal(status: RevisionQueue['status']): boolean {
  return status === 'completed' || status === 'partial' || status === 'failed' || status === 'stopped';
}

export function SubmissionPage({ project }: { project: Project }) {
  const [tab, setTab] = useState<SubmissionTab>('journals');
  const [loadErr, setLoadErr] = useState('');
  const [removingJournal, setRemovingJournal] = useState<Journal | null>(null);
  const [removingTrack, setRemovingTrack] = useState<SubmissionTrack | null>(null);
  const docsQuery = useProjectDocs(project.id);
  const docs = docsQuery.data ?? [];
  const [selDoc, setSelDoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [plan, setPlan] = useState<RevisionPlanItem[]>([]);
  const [planSections, setPlanSections] = useState<Record<string, string>>({});

  // 修改计划执行队列：启动后轮询进度，逐条展示 before/after
  const [queue, setQueue] = useState<RevisionQueue | null>(null);
  const [queueHistory, setQueueHistory] = useState<RevisionQueueSummary[]>([]);
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const [queueErr, setQueueErr] = useState('');
  const [queueStarting, setQueueStarting] = useState(false);
  const [queueStopping, setQueueStopping] = useState(false);
  const [queueRetrying, setQueueRetrying] = useState<string | null>(null);

  // 期刊推荐（结构化匹配）
  const [title, setTitle] = useState('');
  const [abstract, setAbstract] = useState('');
  const [match, setMatch] = useState<JournalMatchResult | null>(null);
  const [matching, setMatching] = useState(false);
  // 期刊库
  const [lib, setLib] = useState<Journal[]>([]);
  const [libForm, setLibForm] = useState({ name: '', issn: '', publisher: '', quartile: '', if2024: '' });
  // Cover Letter
  const [journal, setJournal] = useState('');
  // 审稿回复（兜底粘贴）
  const [reviewComments, setReviewComments] = useState('');
  const [responseHint, setResponseHint] = useState('');
  // 审稿意见闭环：当前文档的 review_comment 列表
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [draftReplies, setDraftReplies] = useState<Record<string, string>>({});
  const [writingBack, setWritingBack] = useState<string | null>(null);

  // 投稿跟踪
  const [regForm, setRegForm] = useState({ docId: '', journalId: '', journalName: '', date: todayISO(), status: 'submitted' as SubmissionStatus, note: '', prevId: '', revDeadline: '' });
  const [openTrackId, setOpenTrackId] = useState<string | null>(null);
  const [eventFor, setEventFor] = useState<string | null>(null);
  const [evStatus, setEvStatus] = useState<SubmissionStatus>('minor_revision');
  const [evNote, setEvNote] = useState('');
  const [evDeadline, setEvDeadline] = useState('');
  const [deadlineFor, setDeadlineFor] = useState<string | null>(null);
  const [deadlineVal, setDeadlineVal] = useState('');
  const [emailFor, setEmailFor] = useState<string | null>(null);
  const [emailText, setEmailText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseEmailResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  // 任务2：每条投稿关联文档的 open 审稿意见数（预取，用于「从审稿意见记录事件」按钮禁用态）
  const toast = useContext(ToastContext);

  // 文档列表走共享 hook；错误直接派生，不再用 effect 同步一份重复错误状态。
  const docsError = docsQuery.error ? errMsg(docsQuery.error) : '';
  const selectedDoc = docs.find((d) => d.id === selDoc);
  const docSectionTitles = useMemo(() => sectionTitlesOf(selectedDoc?.content || ''), [selectedDoc?.content]);
  // 期刊库加载
  useEffect(() => {
    api.submission.listJournals().then(setLib).catch((e) => { setLib([]); setLoadErr(errMsg(e)); });
  }, []);

  const loadLib = async () => {
    try {
      setLib(await api.submission.listJournals());
    } catch {
      /* 忽略 */
    }
  };

  // 审稿意见闭环：切换文档时拉取该文档的 review_comment（在 pickDoc 事件内取数，无 effect）
  const loadComments = (docId: string) => {
    if (!docId) {
      setComments([]);
      return;
    }
    api.research.reviewComments(docId).then(setComments).catch((e) => { setComments([]); setLoadErr(errMsg(e)); });
  };

  // 投稿跟踪列表（React Query，tab=track 时启用；同时预取每条投稿的 open 审稿意见数）
  const qc = useQueryClient();
  const tracksQuery = useQuery({
    queryKey: ['tracks', project.id],
    enabled: tab === 'track',
    queryFn: async () => {
      const list = await api.submission.listTracks(project.id);
      const counts: Record<string, number> = {};
      await Promise.all(
        list.map(async (t) => {
          if (!t.documentId) {
            counts[t.id] = 0;
            return;
          }
          try {
            const cs = await api.research.reviewComments(t.documentId);
            counts[t.id] = cs.filter((c) => c.status === 'open').length;
          } catch {
            counts[t.id] = 0;
          }
        }),
      );
      return { list, counts };
    },
  });
  const tracks: SubmissionTrack[] = tracksQuery.data?.list ?? [];
  const openCounts: Record<string, number> = tracksQuery.data?.counts ?? {};
  const loadTracks = async () => {
    await qc.invalidateQueries({ queryKey: ['tracks', project.id] });
  };

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setOutput('');
    try {
      const result = await fn();
      setOutput(result);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // 派生轮询目标：只有 queued/running 的队列需要拉取；终态队列只触发一次刷新
  const pollingQueueId = queue && !isQueueTerminal(queue.status) ? queue.id : null;
  const finishedQueueId = queue && isQueueTerminal(queue.status) ? queue.id : null;

  // 历史队列：切换文档时自动读取；队列结束后再刷新一次，保证审计条最新
  useEffect(() => {
    if (!selDoc) return;
    let cancelled = false;
    api.documents.listRevisionQueues(selDoc)
      .then((res) => { if (!cancelled) { setQueueHistory(res.queues); setHistoryDocId(selDoc); } })
      .catch(() => { if (!cancelled) { setQueueHistory([]); setHistoryDocId(selDoc); } });
    return () => { cancelled = true; };
  }, [selDoc]);

  // 队列轮询：running/queued 时每 1.5s 拉一次；终态自动停
  useEffect(() => {
    if (!pollingQueueId || !selDoc) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const latest = await api.documents.getRevisionQueue(selDoc, pollingQueueId);
        if (!cancelled) {
          setQueue(latest);
          setQueueErr('');
        }
      } catch (e: unknown) {
        if (!cancelled) setQueueErr(errMsg(e));
      }
    };
    const timer = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollingQueueId, selDoc]);

  // 队列结束后刷新文档列表，让正文与版本号同步
  useEffect(() => {
    if (!finishedQueueId || !selDoc) return;
    qc.invalidateQueries({ queryKey: qk.docs(project.id) });
    qc.invalidateQueries({ queryKey: qk.doc(selDoc) });
    api.documents.listRevisionQueues(selDoc)
      .then((res) => { setQueueHistory(res.queues); setHistoryDocId(selDoc); })
      .catch(() => undefined);
  }, [finishedQueueId, selDoc, project.id, qc]);

  const launchQueue = async () => {
    setQueueErr('');
    if (!selDoc) {
      setQueueErr('请先在「回复审稿」页选择要修改的文档');
      return;
    }
    const items = plan
      .filter((item) => planSections[item.id])
      .map((item) => ({
        planItemId: item.id,
        sectionTitle: planSections[item.id],
        reviewPoints: `审稿意见 ${item.id}：${item.excerpt}\n需要修改：${item.suggestedAction}`,
        excerpt: item.excerpt,
        suggestedAction: item.suggestedAction,
        reviewCommentId: matchReviewCommentId(item, comments),
      }));
    if (!items.length) {
      setQueueErr('至少为一条修改计划选择目标章节');
      return;
    }
    setQueueStarting(true);
    try {
      const started = await api.documents.startRevisionQueue(selDoc, items);
      setQueue(started);
    } catch (e: unknown) {
      setQueueErr(errMsg(e));
    } finally {
      setQueueStarting(false);
    }
  };

  const haltQueue = async () => {
    if (!queue || !selDoc) return;
    setQueueErr('');
    setQueueStopping(true);
    try {
      setQueue(await api.documents.stopRevisionQueue(selDoc, queue.id));
    } catch (e: unknown) {
      setQueueErr(errMsg(e));
    } finally {
      setQueueStopping(false);
    }
  };

  /** 跳过/失败条目：指定章节后新建一队重试，旧队历史保留 */
  const retryQueueItem = async (item: RevisionQueueItem, sectionTitle: string) => {
    if (!queue || !selDoc || !sectionTitle) return;
    setQueueErr('');
    setQueueRetrying(item.id);
    try {
      const started = await api.documents.retryRevisionQueueItem(selDoc, queue.id, item.id, sectionTitle);
      setQueue(started);
      const history = await api.documents.listRevisionQueues(selDoc);
      setQueueHistory(history.queues);
      setHistoryDocId(selDoc);
    } catch (e: unknown) {
      setQueueErr(errMsg(e));
    } finally {
      setQueueRetrying(null);
    }
  };

  const runMatch = async () => {
    if (!title.trim()) {
      setError('请先填写论文标题（或从项目内文档选择）');
      return;
    }
    setMatching(true);
    setError('');
    setMatch(null);
    try {
      setMatch(await api.submission.journalsMatch(title, abstract));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setMatching(false);
    }
  };

  const addLibJournal = async () => {
    if (!libForm.name.trim()) return;
    try {
      await api.submission.addJournal({
        name: libForm.name.trim(),
        issn: libForm.issn.trim() || undefined,
        publisher: libForm.publisher.trim() || undefined,
        quartile: libForm.quartile.trim() || undefined,
        if2024: libForm.if2024 ? Number(libForm.if2024) : null,
      });
      setLibForm({ name: '', issn: '', publisher: '', quartile: '', if2024: '' });
      await loadLib();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const pickDoc = (id: string) => {
    setSelDoc(id);
    setQueue(null);
    setQueueErr('');
    loadComments(id);
    const d = docs.find((x) => x.id === id);
    if (d) {
      setTitle(d.title);
      setAbstract((d.content || '').slice(0, 500));
    }
  };

  /* —— 审稿意见闭环：为单条意见生成回复 —— */
  const genReplyForComment = async (c: ReviewComment) => {
    setWritingBack(c.id);
    setError('');
    try {
      const res = await api.submission.replyReview(c.commentText, c.responseText || '');
      setDraftReplies((m) => ({ ...m, [c.id]: res.letter }));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setWritingBack(null);
    }
  };

  const writeBackReply = async (c: ReviewComment) => {
    const text = draftReplies[c.id];
    if (!text) return;
    setWritingBack(c.id);
    try {
      await api.research.updateReviewComment(c.id, { responseText: text, status: 'resolved' });
      const updated = await api.research.reviewComments(selDoc);
      setComments(updated);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setWritingBack(null);
    }
  };

  /* —— 投稿跟踪动作 —— */
  const submitTrack = async () => {
    if (!regForm.journalName.trim()) {
      setError('请选择或输入期刊名');
      return;
    }
    try {
      await api.submission.trackSubmit({
        projectId: project.id,
        journalId: regForm.journalId,
        journalName: regForm.journalName.trim(),
        documentId: regForm.docId,
        submittedAt: regForm.date ? new Date(regForm.date + 'T00:00:00').getTime() : Date.now(),
        currentStatus: regForm.status,
        note: regForm.note,
        previousSubmissionId: regForm.prevId || undefined,
        revisionDeadline: regForm.revDeadline ? new Date(regForm.revDeadline + 'T23:59:59').getTime() : null,
      });
      setRegForm({ docId: '', journalId: '', journalName: '', date: todayISO(), status: 'submitted', note: '', prevId: '', revDeadline: '' });
      await loadTracks();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  /** 终态记录点「转投他刊」：预填登记表单，提交时带 previousSubmissionId 串联 */
  const transferToNew = (t: SubmissionTrack) => {
    setRegForm({
      docId: t.documentId || '',
      journalId: '',
      journalName: '',
      date: todayISO(),
      status: 'submitted',
      note: `转投自 ${t.journalName}（${STATUS_META[t.currentStatus]?.label || t.currentStatus}）`,
      prevId: t.id,
      revDeadline: '',
    });
    setTab('track');
  };

  /** 任务1：选刊一键登记——把匹配到的期刊带入「投稿跟踪」登记表单并切 Tab */
  const pickJournalToSubmit = (j: JournalMatchResult['journals'][number]) => {
    // journalsMatch 结果不带 id；若已在期刊库，按名称反查 journalId 以关联一审周期
    const libHit = j.isInLibrary ? lib.find((x) => x.name === j.name) : undefined;
    // 同一条期刊名贯穿「期刊匹配 → Cover Letter → 投稿包」，避免三个 Tab 各填一次
    setJournal(j.name);
    setRegForm({
      docId: selDoc, // 当前写作文档上下文（期刊推荐 Tab 所选文档）；无则留空由用户选
      journalId: libHit?.id || '',
      journalName: j.name,
      date: todayISO(),
      status: 'submitted',
      note: `来自期刊推荐：${(j.reason || '').slice(0, 80)}`,
      prevId: '',
      revDeadline: '',
    });
    setTab('track');
    toast('success', `已把「${j.name}」带入登记表单、Cover Letter 与投稿包`);
  };

  /** 任务2：从审稿意见直连投稿事件——读关联文档 open 意见，推断状态并追加一条事件 */
  const recordFromReview = async (t: SubmissionTrack) => {
    if (!t.documentId) {
      setError('该投稿未关联论文文档，无法读取审稿意见');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const all = await api.research.reviewComments(t.documentId);
      const open = all.filter((c) => c.status === 'open');
      if (open.length === 0) {
        setError('该稿件没有待处理（open）的审稿意见');
        return;
      }
      const status = inferStatusFromComments(open);
      await api.submission.addTrackEvent(t.id, {
        status,
        note: `来自审稿意见：${open.length} 条 open`,
      });
      toast('success', `已按 ${open.length} 条 open 审稿意见记录「${STATUS_META[status].label}」事件`);
      await loadTracks();
    } catch (e: unknown) {
      setError(errMsg(e) || '记录审稿事件失败');
    } finally {
      setBusy(false);
    }
  };

  /** 卡片上「设置/修改截止日」：PATCH revisionDeadline */
  const saveDeadline = async (id: string) => {
    try {
      await api.submission.updateTrack(id, { revisionDeadline: deadlineVal ? new Date(deadlineVal + 'T23:59:59').getTime() : null });
      setDeadlineFor(null);
      setDeadlineVal('');
      await loadTracks();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const confirmEvent = async (id: string) => {
    try {
      await api.submission.addTrackEvent(id, { status: evStatus, note: evNote });
      if (REVISION_STATUSES.has(evStatus) && evDeadline) {
        await api.submission.updateTrack(id, { revisionDeadline: new Date(evDeadline + 'T23:59:59').getTime() });
      }
      setEventFor(null);
      setEvNote('');
      setEvDeadline('');
      await loadTracks();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const doParseEmail = async (t: SubmissionTrack) => {
    if (!emailText.trim()) return;
    setParsing(true);
    setError('');
    setParseResult(null);
    try {
      setParseResult(await api.submission.parseEmail(emailText, t.currentStatus));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setParsing(false);
    }
  };

  const confirmParse = async (t: SubmissionTrack) => {
    if (!parseResult) return;
    setConfirming(true);
    try {
      await api.submission.addTrackEvent(t.id, {
        status: parseResult.suggestedStatus,
        date: parseResult.date ? new Date(parseResult.date + 'T00:00:00').getTime() : undefined,
        note: `AI 解析：${parseResult.reason || ''}`,
      });
      setEmailFor(null);
      setEmailText('');
      setParseResult(null);
      await loadTracks();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setConfirming(false);
    }
  };

  const removeTrack = async (id: string) => {
    try {
      await api.submission.removeTrack(id);
      await loadTracks();
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  return (
    <>
      <ErrorBox message={loadErr || docsError} />
    <div className="page-container">
      <SubmissionTabNav tab={tab} onChange={(next) => { setTab(next); setOutput(''); }} />

      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        {tab === 'readiness' && (
          <SubmissionReadinessPanel
            projectId={project.id}
            docs={docs}
            journal={journal}
            onJournalChange={setJournal}
          />
        )}

        {tab === 'journals' && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">选择项目内论文（自动带入标题与摘要）</div>
              <DocumentSelect
                className="w-full"
                docs={docs}
                value={selDoc}
                placeholder="从项目中选择文档…"
                onChange={(id) => pickDoc(id ?? '')}
              />
            </div>
            <Input placeholder="论文标题" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea rows={4} placeholder="论文摘要（可选，从文档自动带入或粘贴）" value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            <Button onClick={runMatch} disabled={matching}>
              {matching ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 智能匹配期刊
            </Button>
          </div>
        )}

        {tab === 'cover' && (
          <div className="space-y-3">
            <Input placeholder="论文标题" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea rows={3} placeholder="论文摘要" value={abstract} onChange={(e) => setAbstract(e.target.value)} />
            <Input placeholder="目标期刊名称" value={journal} onChange={(e) => setJournal(e.target.value)} />
            <Button onClick={() => run(() => api.submission.coverLetter(title, abstract, journal))} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 生成 Cover Letter
            </Button>
          </div>
        )}

        {tab === 'reply' && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">关联项目内文档（自动带出已记录的审稿意见）</div>
              <DocumentSelect
                className="w-full"
                docs={docs}
                placeholder="不关联文档，手动粘贴审稿意见…"
                value={selDoc}
                onChange={(id) => pickDoc(id ?? '')}
              />
            </div>

            {/* 审稿意见闭环：逐条展示 review_comment，逐条生成并回写回复 */}
            {comments.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-400 dark:text-slate-500">本文档已记录 {comments.length} 条审稿意见，逐条生成回复后可回写到意见条目</div>
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{c.reviewer}</span>
                      {c.category && <Badge tone="slate">{c.category}</Badge>}
                      <Badge tone={c.status === 'resolved' ? 'green' : c.status === 'deferred' ? 'slate' : 'amber'}>
                        {c.status === 'resolved' ? '已回复' : c.status === 'deferred' ? '暂缓' : '待回复'}
                      </Badge>
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{c.commentText}</div>
                    {c.responseText && <div className="text-[12px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded p-2 whitespace-pre-wrap">已回写回复：{c.responseText}</div>}
                    {draftReplies[c.id] && (
                      <Textarea rows={4} value={draftReplies[c.id]} onChange={(e) => setDraftReplies((m) => ({ ...m, [c.id]: e.target.value }))} />
                    )}
                    <div className="flex gap-2">
                      <Button variant="outline" className="text-xs" disabled={writingBack === c.id} onClick={() => genReplyForComment(c)}>
                        {writingBack === c.id ? <Loader2 size={13} className="animate-spin" /> : <MessageSquareReply size={13} />}
                        {draftReplies[c.id] ? '重新生成' : '生成回复'}
                      </Button>
                      {draftReplies[c.id] && (
                        <Button variant="outline" className="text-xs" disabled={writingBack === c.id} onClick={() => writeBackReply(c)}>
                          <Check size={13} /> 回写到意见条目
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="text-xs text-slate-400 dark:text-slate-500 border-t border-dashed border-slate-200 dark:border-slate-700 pt-2">
              兜底：未关联文档或想手动处理时，直接粘贴审稿意见原文
            </div>
            <Textarea rows={6} placeholder="粘贴审稿意见原文（可包含多条）" value={reviewComments} onChange={(e) => setReviewComments(e.target.value)} />
            <Textarea rows={3} placeholder="你的初步回应想法（可选）" value={responseHint} onChange={(e) => setResponseHint(e.target.value)} />
            <Button onClick={() => run(async () => {
              const res = await api.submission.replyReview(reviewComments, responseHint);
              const items = res.revisionPlan ?? [];
              setPlan(items);
              setPlanSections(Object.fromEntries(items.map((item) => [item.id, inferPlanSection(item, docSectionTitles)])));
              return res.letter;
            })} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 生成回复信
            </Button>
            {plan.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">修改计划（评审意见回链，可直接作为修改任务的输入）</div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">
                  为每条选择目标章节；队列会按顺序逐条定向改写，每步自动快照，不会一次重写全文。
                </div>
                {plan.map((item) => (
                  <div key={item.id} className="text-xs rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-slate-500">{item.id}</span>
                      <span className={`rounded px-1.5 py-0.5 ${item.severity === 'major' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.severity}</span>
                      <span className="rounded bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 px-1.5 py-0.5">{item.category}</span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200">{item.excerpt}</div>
                    <div className="text-slate-500 dark:text-slate-400">→ {item.suggestedAction}</div>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className="shrink-0 text-slate-400">目标章节</span>
                      <Select
                        className="text-xs flex-1 !py-1"
                        ariaLabel={`${item.id} 目标章节`}
                        options={[
                          { value: '', label: docSectionTitles.length ? '未匹配，请选择…' : '当前文档没有可识别章节' },
                          ...docSectionTitles.map((title) => ({ value: title, label: title })),
                        ]}
                        value={planSections[item.id] || ''}
                        onChange={(v) => setPlanSections((m) => ({ ...m, [item.id]: v }))}
                      />
                    </div>
                  </div>
                ))}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" className="text-xs" onClick={launchQueue} disabled={queueStarting}>
                    {queueStarting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    执行修改队列
                  </Button>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    已选 {plan.filter((item) => planSections[item.id]).length} / {plan.length} 条
                  </span>
                  {selDoc === '' && <span className="text-[11px] text-amber-600 dark:text-amber-300">先在「回复审稿」页选择文档</span>}
                </div>
                {queueErr && <div className="text-xs text-rose-600 dark:text-rose-300">{queueErr}</div>}
                {queue && (
                  <RevisionQueuePanel
                    queue={queue}
                    stopping={queueStopping}
                    onStop={haltQueue}
                    sectionTitles={docSectionTitles}
                    onRetry={retryQueueItem}
                    retryingItemId={queueRetrying}
                  />
                )}
                <RevisionQueueHistory queues={historyDocId === selDoc ? queueHistory : []} />
              </div>
            )}
          </div>
        )}

        {tab === 'track' && (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">登记新投稿</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <DocumentSelect
                docs={docs}
                placeholder="不关联文档"
                value={regForm.docId}
                onChange={(id) => setRegForm((f) => ({ ...f, docId: id ?? '' }))}
              />
              <Select
                options={[{ value: '', label: '期刊库选择（可选）…' }, ...lib.map((j) => ({ value: j.id, label: j.name }))]}
                value={regForm.journalId}
                onChange={(v) => {
                  const hit = lib.find((j) => j.id === v);
                  setRegForm((f) => ({ ...f, journalId: v, journalName: hit ? hit.name : f.journalName }));
                }}
              />
              <Input placeholder="期刊名（库内没有可自由输入）" value={regForm.journalName} onChange={(e) => setRegForm((f) => ({ ...f, journalName: e.target.value }))} />
              <Input type="date" value={regForm.date} onChange={(e) => setRegForm((f) => ({ ...f, date: e.target.value }))} />
              <Select options={STATUS_OPTIONS} value={regForm.status} onChange={(v) => setRegForm((f) => ({ ...f, status: v as SubmissionStatus }))} />
              {REVISION_STATUSES.has(regForm.status) && (
                <Input type="date" value={regForm.revDeadline} onChange={(e) => setRegForm((f) => ({ ...f, revDeadline: e.target.value }))} />
              )}
              <Input placeholder="备注（可选）" value={regForm.note} onChange={(e) => setRegForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
            <Button onClick={submitTrack}>
              <Plus size={15} /> 登记投稿
            </Button>
          </div>
        )}
      </Card>

      {tab === 'journals' && (
        <>
          <JournalMatches matching={matching} match={match} onPickJournal={pickJournalToSubmit} />
          <JournalLibrary
            journals={lib}
            form={libForm}
            onFormChange={(patch: Partial<JournalLibraryForm>) => setLibForm((f) => ({ ...f, ...patch }))}
            onAdd={addLibJournal}
            onRemove={setRemovingJournal}
          />
        </>
      )}

      {tab === 'track' && (
        <div className="space-y-3">
          {tracks.length === 0 && <Card className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">还没有投稿记录，在上方登记第一条吧</Card>}
          {tracks.map((t) => (
            <TrackCard
              key={t.id}
              track={t}
              docs={docs}
              openCount={openCounts[t.id] || 0}
              busy={busy}
              forwardJournalName={tracks.find((x) => x.previousSubmissionId === t.id)?.journalName}
              eventOpen={eventFor === t.id}
              evStatus={evStatus}
              evNote={evNote}
              evDeadline={evDeadline}
              deadlineOpen={deadlineFor === t.id}
              deadlineVal={deadlineVal}
              emailOpen={emailFor === t.id}
              emailText={emailText}
              parsing={parsing}
              parseResult={parseResult}
              confirming={confirming}
              historyOpen={openTrackId === t.id}
              onToggleEvent={() => setEventFor(eventFor === t.id ? null : t.id)}
              onStatusChange={setEvStatus}
              onNoteChange={setEvNote}
              onDeadlineChange={setEvDeadline}
              onConfirmEvent={() => confirmEvent(t.id)}
              onToggleDeadline={() => {
                setDeadlineFor(deadlineFor === t.id ? null : t.id);
                setDeadlineVal(t.revisionDeadline ? new Date(t.revisionDeadline).toISOString().slice(0, 10) : '');
              }}
              onDeadlineValueChange={setDeadlineVal}
              onSaveDeadline={() => saveDeadline(t.id)}
              onToggleEmail={() => { setEmailFor(emailFor === t.id ? null : t.id); setParseResult(null); }}
              onEmailTextChange={setEmailText}
              onParseEmail={() => doParseEmail(t)}
              onDismissParse={() => setParseResult(null)}
              onConfirmParse={() => confirmParse(t)}
              onToggleHistory={() => setOpenTrackId(openTrackId === t.id ? null : t.id)}
              onTransfer={() => transferToNew(t)}
              onRecordFromReview={() => recordFromReview(t)}
              onDelete={() => setRemovingTrack(t)}
            />
          ))}
        </div>
      )}

      {(tab === 'cover' || (tab === 'reply' && output)) && (
        busy ? (
          <Card className="p-4">
            <Spinner label="AI 生成中…" />
          </Card>
        ) : output ? (
          <Card className="p-4">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">生成结果</div>
            <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 max-h-[480px] overflow-y-auto">{output}</div>
          </Card>
        ) : (
          <Card className="p-4 text-center text-slate-400 dark:text-slate-500 text-sm">填写信息后生成结果会显示在这里</Card>
        )
      )}
    </div>
      <ConfirmDialog
        open={!!removingJournal}
        title="移除期刊"
        description={`确定从期刊库移除「${removingJournal?.name ?? ''}」？已记录的投稿跟踪不受影响。`}
        confirmText="移除"
        danger
        onConfirm={async () => {
          if (!removingJournal) return;
          try { await api.submission.removeJournal(removingJournal.id); loadLib(); } catch (e: unknown) { setError(errMsg(e)); }
          setRemovingJournal(null);
        }}
        onClose={() => setRemovingJournal(null)}
      />
      <ConfirmDialog
        open={!!removingTrack}
        title="删除投稿记录"
        description={`确定删除「${removingTrack?.journalName ?? ''}」这条投稿记录？状态历史会一并删除，无法恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => { if (removingTrack) void removeTrack(removingTrack.id); setRemovingTrack(null); }}
        onClose={() => setRemovingTrack(null)}
      />
    </>
  );
}
