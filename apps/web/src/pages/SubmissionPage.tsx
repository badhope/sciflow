import { useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Check, FilePen, Forward, Globe2, Library, Loader2, Mail, MessageSquareReply, Plus, Send, Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { ToastContext } from '../App';
import type { Doc, Journal, JournalMatchResult, ParseEmailResult, Project, ReviewComment, SubmissionStatus, SubmissionTrack } from '../types';
import { Badge, Button, Card, ConfirmDialog, ErrorBox, Input, Select, Spinner, Textarea, errMsg } from '../components/ui';
import { HBar } from '../components/charts';

type Tab = 'journals' | 'cover' | 'reply' | 'track';

/* —— 状态 → 中文标签 / Badge 颜色 / 阶段分组（页面顶部常量） —— */
const STATUS_META: Record<SubmissionStatus, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'teal' | 'blue'; group: string }> = {
  submitted: { label: '收稿', tone: 'blue', group: '投稿中' },
  initial_review: { label: '初审', tone: 'teal', group: '外审中' },
  external_review: { label: '外审', tone: 'amber', group: '外审中' },
  review_returned: { label: '意见已回', tone: 'amber', group: '外审中' },
  minor_revision: { label: '小修', tone: 'amber', group: '返修' },
  major_revision: { label: '大修', tone: 'red', group: '返修' },
  re_review: { label: '复审', tone: 'amber', group: '返修' },
  final_review: { label: '终审', tone: 'blue', group: '终审' },
  accepted: { label: '录用', tone: 'green', group: '完结' },
  in_production: { label: '编辑加工', tone: 'green', group: '完结' },
  rejected: { label: '拒稿', tone: 'red', group: '终止' },
  withdrawn: { label: '撤稿', tone: 'slate', group: '终止' },
  transferred: { label: '转投他刊', tone: 'slate', group: '终止' },
};
const STATUS_OPTIONS = (Object.keys(STATUS_META) as SubmissionStatus[]).map((s) => ({
  value: s,
  label: STATUS_META[s].label,
}));
/** 活跃链路 Stepper 节点（终态不展示步进条） */
const STEPPER_CHAIN: SubmissionStatus[] = ['submitted', 'initial_review', 'external_review', 'review_returned', 'minor_revision', 're_review', 'final_review', 'accepted', 'in_production'];
const TERMINAL = new Set<SubmissionStatus>(['rejected', 'withdrawn', 'transferred']);
/** 返修链路状态：出现时需要录入/展示修回截止日 */
const REVISION_STATUSES = new Set<SubmissionStatus>(['minor_revision', 'major_revision']);

const fmtDate = (ts?: number | null) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');
const todayISO = () => new Date().toISOString().slice(0, 10);
/** 修回截止日倒计时徽章：>=7 天绿，<7 琥珀，<3 红，超期红 + 提醒 */
function revisionBadge(deadline: number | null): ReactNode {
  if (!deadline) return null;
  const ms = deadline - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (ms < 0) return <Badge tone="red">修回已超期 {-days} 天 · 建议联系编辑部</Badge>;
  const tone: 'green' | 'amber' | 'red' = days < 3 ? 'red' : days < 7 ? 'amber' : 'green';
  return <Badge tone={tone}>修回剩 {days} 天</Badge>;
}

export function SubmissionPage({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>('journals');
  const [loadErr, setLoadErr] = useState('');
  const [removingJournal, setRemovingJournal] = useState<Journal | null>(null);
  const [removingTrack, setRemovingTrack] = useState<SubmissionTrack | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [selDoc, setSelDoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [plan, setPlan] = useState<{ id: string; excerpt: string; category: string; severity: string; suggestedAction: string }[]>([]);

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

  // 拉取项目内文档，否则「选择项目内论文」下拉恒空
  useEffect(() => {
    api.documents.list(project.id).then(setDocs).catch((e) => { setDocs([]); setLoadErr(errMsg(e)); });
  }, [project.id]);

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
    toast('success', `已把「${j.name}」带入登记表单，核对后点「登记投稿」`);
  };

  /** 任务2：按 open 审稿意见的 category 推断应推进到的投稿状态（与既有 major/minor 枚举对齐） */
  const inferStatusFromComments = (comments: ReviewComment[]): SubmissionStatus => {
    const cats = comments.map((c) => (c.category || '').toLowerCase());
    if (cats.some((c) => /major|大修|大改/.test(c))) return 'major_revision';
    if (cats.some((c) => /minor|小修|小改/.test(c))) return 'minor_revision';
    return 'external_review';
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
        date: Date.now(),
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

  const TABS: { key: Tab; label: string; icon: typeof Globe2 }[] = [
    { key: 'journals', label: '期刊推荐', icon: Globe2 },
    { key: 'cover', label: 'Cover Letter', icon: FilePen },
    { key: 'reply', label: '审稿回复', icon: MessageSquareReply },
    { key: 'track', label: '投稿跟踪', icon: CalendarClock },
  ];

  return (
    <>
      <ErrorBox message={loadErr} />
    <div className="page-container">
      <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setOutput('');
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap shrink-0 ${
              tab === t.key ? 'border-teal-600 text-teal-700 font-medium' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      <ErrorBox message={error} />

      <Card className="p-4 mb-4">
        {tab === 'journals' && (
          <div className="space-y-3">
            <div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">选择项目内论文（自动带入标题与摘要）</div>
              <Select
                className="w-full"
                options={[{ value: '', label: '从项目中选择文档…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
                value={selDoc}
                onChange={pickDoc}
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
              <Select
                className="w-full"
                options={[{ value: '', label: '不关联文档，手动粘贴审稿意见…' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
                value={selDoc}
                onChange={pickDoc}
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
              setPlan(res.revisionPlan ?? []);
              return res.letter;
            })} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} 生成回复信
            </Button>
            {plan.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">修改计划（评审意见回链，可直接作为修改任务的输入）</div>
                {plan.map((item) => (
                  <div key={item.id} className="text-xs rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-slate-500">{item.id}</span>
                      <span className={`rounded px-1.5 py-0.5 ${item.severity === 'major' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{item.severity}</span>
                      <span className="rounded bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 px-1.5 py-0.5">{item.category}</span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200">{item.excerpt}</div>
                    <div className="text-slate-500 dark:text-slate-400">→ {item.suggestedAction}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'track' && (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">登记新投稿</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Select
                options={[{ value: '', label: '不关联文档' }, ...docs.map((d) => ({ value: d.id, label: d.title }))]}
                value={regForm.docId}
                onChange={(v) => setRegForm((f) => ({ ...f, docId: v }))}
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
          {matching && (
            <Card className="p-4 mb-4">
              <Spinner label="AI 结构化匹配期刊中…" />
            </Card>
          )}
          {!matching && match && match.journals.length > 0 && (
            <Card className="p-4 mb-4">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">推荐期刊（按匹配度排序）</div>
              <div className="space-y-3">
                {[...match.journals]
                  .sort((a, b) => b.score - a.score)
                  .map((j) => {
                    const meta = [
                      j.if2024 ? `IF ${j.if2024}` : '',
                      j.quartile || '',
                      j.firstDecisionWeeks ? `${j.firstDecisionWeeks} 周一审` : '',
                      j.acceptanceRate ? `录用率 ${j.acceptanceRate}%` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <div key={j.name} className="rounded-lg border border-slate-100 dark:border-slate-800 p-3">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{j.name}</span>
                          {j.isInLibrary && <Badge tone="green">已在期刊库</Badge>}
                          {j.oa && <Badge tone="slate">{j.oa === 'yes' ? 'OA' : j.oa}</Badge>}
                        </div>
                        <HBar
                          max={100}
                          items={[
                            {
                              label: '匹配度',
                              value: j.score,
                              sub: meta,
                              hint: `${j.name}：匹配度 ${j.score}/100${meta ? ` · ${meta}` : ''}`,
                            },
                          ]}
                        />
                        {(j.reason || j.gap) && (
                          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                            {j.reason && (
                              <div>
                                <span className="text-slate-400 dark:text-slate-500">推荐理由：</span>
                                {j.reason}
                              </div>
                            )}
                            {j.gap && (
                              <div>
                                <span className="text-slate-400 dark:text-slate-500">差距提示：</span>
                                {j.gap}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => pickJournalToSubmit(j)}
                            className="inline-flex items-center gap-1 text-xs rounded-md bubble-user px-2.5 py-1 hover:brightness-110"
                            title="把这本期刊带入「投稿跟踪」登记表单"
                          >
                            <Send size={12} /> 投它
                          </button>
                          {!j.isInLibrary && (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">未入期刊库，登记时可手动补录以获取一审周期</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </Card>
          )}
          {!matching && match && match.journals.length === 0 && (
            <Card className="p-4 mb-4 text-center text-slate-400 dark:text-slate-500 text-sm">未匹配到合适期刊，补充摘要后重试</Card>
          )}

          {/* 期刊库管理 */}
          <Card className="p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Library size={15} className="text-teal-600" />
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">我的期刊库</span>
              <span className="text-[11px] text-slate-400 dark:text-slate-500">已收录 {lib.length} 本</span>
            </div>
            <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-2">
              <Input placeholder="期刊名（必填）" value={libForm.name} onChange={(e) => setLibForm((f) => ({ ...f, name: e.target.value }))} />
              <Input placeholder="ISSN（可选）" value={libForm.issn} onChange={(e) => setLibForm((f) => ({ ...f, issn: e.target.value }))} />
              <Input placeholder="出版商（可选）" value={libForm.publisher} onChange={(e) => setLibForm((f) => ({ ...f, publisher: e.target.value }))} />
              <Input placeholder="分区 如 Q1（可选）" value={libForm.quartile} onChange={(e) => setLibForm((f) => ({ ...f, quartile: e.target.value }))} />
              <Input placeholder="IF 2024（可选）" value={libForm.if2024} onChange={(e) => setLibForm((f) => ({ ...f, if2024: e.target.value }))} />
            </div>
            <Button variant="outline" className="text-xs mb-3" disabled={!libForm.name.trim()} onClick={addLibJournal}>
              <Plus size={13} /> 添加到期刊库
            </Button>
            {lib.length === 0 ? (
              <div className="text-xs text-slate-400 dark:text-slate-500">
                期刊库为空 —— 添加常投期刊后，上方匹配结果会自动标记「已在期刊库」
              </div>
            ) : (
              <div className="space-y-1.5">
                {lib.map((j) => (
                  <div key={j.id} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200 flex-1 min-w-0 truncate">{j.name}</span>
                    {j.if2024 ? <Badge tone="teal">IF {j.if2024}</Badge> : null}
                    {j.quartile ? <Badge tone="slate">{j.quartile}</Badge> : null}
                    {j.firstDecisionWeeks ? <span className="text-[11px] text-slate-400 dark:text-slate-500">{j.firstDecisionWeeks} 周一审</span> : null}
                    <button className="p-1 text-slate-400 hover:text-rose-500 shrink-0" title="移除期刊" aria-label={`移除期刊 ${j.name}`} onClick={() => setRemovingJournal(j)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* —— 投稿跟踪卡片流 —— */}
      {tab === 'track' && (
        <div className="space-y-3">
          {tracks.length === 0 && <Card className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">还没有投稿记录，在上方登记第一条吧</Card>}
          {tracks.map((t) => {
            const meta = STATUS_META[t.currentStatus] || STATUS_META.submitted;
            const docTitle = t.documentId ? docs.find((d) => d.id === t.documentId)?.title : '';
            const stepIdx = STEPPER_CHAIN.indexOf(t.currentStatus);
            const forward = tracks.find((x) => x.previousSubmissionId === t.id);
            return (
              <Card key={t.id} className="p-4 mb-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t.journalName}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">{meta.group}</span>
                  {forward && (
                    <span className="text-[11px] text-teal-700 dark:text-teal-400">
                      已转投 → {forward.journalName}
                    </span>
                  )}
                  <div className="ml-auto flex gap-1.5 items-center">
                    <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" onClick={() => setEventFor(eventFor === t.id ? null : t.id)}>更新状态</button>
                    {TERMINAL.has(t.currentStatus) && (
                      <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" title="用同一稿件登记新期刊（自动串联旧记录）" onClick={() => transferToNew(t)}>
                        <Forward size={11} className="inline mr-0.5" />转投他刊
                      </button>
                    )}
                    <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" onClick={() => { setDeadlineFor(deadlineFor === t.id ? null : t.id); setDeadlineVal(t.revisionDeadline ? new Date(t.revisionDeadline).toISOString().slice(0, 10) : ''); }}>
                      {t.revisionDeadline ? '改截止日' : '设截止日'}
                    </button>
                    <button className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline" onClick={() => { setEmailFor(emailFor === t.id ? null : t.id); setParseResult(null); }}>
                      <Mail size={11} className="inline mr-0.5" />解析邮件
                    </button>
                    <button
                      className="text-[11px] text-teal-700 dark:text-teal-400 hover:underline disabled:text-slate-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed disabled:no-underline"
                      disabled={!t.documentId || (openCounts[t.id] || 0) === 0 || busy}
                      title={
                        !t.documentId
                          ? '该投稿未关联论文文档'
                          : (openCounts[t.id] || 0) === 0
                            ? '该稿件文档没有待处理（open）的审稿意见'
                            : `按 ${openCounts[t.id]} 条 open 审稿意见自动推断状态并记录事件`
                      }
                      onClick={() => recordFromReview(t)}
                    >
                      <MessageSquareReply size={11} className="inline mr-0.5" />审稿→事件{openCounts[t.id] ? `（${openCounts[t.id]}）` : ''}
                    </button>
                    <button className="p-1 text-slate-400 hover:text-rose-500" title="删除投稿记录" aria-label="删除投稿记录" onClick={() => setRemovingTrack(t)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
                  {docTitle || t.title || '（未命名稿件）'} · 投稿于 {fmtDate(t.submittedAt)}
                </div>

                {/* 修回截止日倒计时 */}
                {t.revisionDeadline && (
                  <div className="mt-1.5 text-[11px]">
                    {revisionBadge(t.revisionDeadline)}
                    <span className="ml-1.5 text-slate-400 dark:text-slate-500">截止 {fmtDate(t.revisionDeadline)}</span>
                  </div>
                )}
                {deadlineFor === t.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input type="date" value={deadlineVal} onChange={(e) => setDeadlineVal(e.target.value)} />
                    <Button className="text-xs px-2 py-1" onClick={() => saveDeadline(t.id)}>保存</Button>
                  </div>
                )}

                {/* L3 周期推断提示 */}
                {t.dueAt && !TERMINAL.has(t.currentStatus) && (
                  <div className="mt-1.5 text-[11px]">
                    {t.overdue ? (
                      <Badge tone="red">已超一审周期 {t.overdueDays} 天 · 建议询问编辑部</Badge>
                    ) : (
                      <Badge tone="amber">预计{t.estimatedStage ? STATUS_META[t.estimatedStage].label : ''}阶段 · 一审节点 {fmtDate(t.dueAt)}</Badge>
                    )}
                  </div>
                )}

                {/* 横向 Stepper：当前状态在链路中的位置（窄屏可横向滚动，避免 9 节点挤压换行） */}
                {stepIdx >= 0 && (
                  <div className="mt-3 overflow-x-auto">
                  <div className="flex items-center min-w-[620px]">
                    {STEPPER_CHAIN.map((s, i) => (
                      <div key={s} className="flex items-center flex-1 last:flex-none">
                        <div className="flex flex-col items-center">
                          <div
                            className={`w-2.5 h-2.5 rounded-full ${
                              i <= stepIdx ? (i === stepIdx ? 'bg-teal-600 ring-4 ring-teal-100 dark:ring-teal-900/40' : 'bg-teal-400') : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          />
                          <span className={`text-[11px] mt-0.5 ${i === stepIdx ? 'text-teal-700 font-medium' : 'text-slate-400'}`}>{STATUS_META[s].label}</span>
                        </div>
                        {i < STEPPER_CHAIN.length - 1 && <div className={`h-px flex-1 mx-0.5 mb-3 ${i < stepIdx ? 'bg-teal-400' : 'bg-slate-200 dark:bg-slate-700'}`} />}
                      </div>
                    ))}
                  </div>
                  </div>
                )}

                {/* 追加状态事件 */}
                {eventFor === t.id && (
                  <div className="mt-3 rounded-lg border border-slate-100 dark:border-slate-800 p-3 space-y-2">
                    <Select options={STATUS_OPTIONS} value={evStatus} onChange={(v) => setEvStatus(v as SubmissionStatus)} />
                    <Input placeholder="备注（可选）" value={evNote} onChange={(e) => setEvNote(e.target.value)} />
                    {REVISION_STATUSES.has(evStatus) && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">修回截止日期</span>
                        <Input type="date" value={evDeadline} onChange={(e) => setEvDeadline(e.target.value)} />
                      </div>
                    )}
                    <Button className="text-xs px-2 py-1" onClick={() => confirmEvent(t.id)}>确认追加状态</Button>
                  </div>
                )}

                {/* 粘贴邮件解析 */}
                {emailFor === t.id && (
                  <div className="mt-3 rounded-lg border border-slate-100 dark:border-slate-800 p-3 space-y-2">
                    <Textarea rows={5} placeholder="粘贴编辑部邮件正文（退修/录用/退稿/缴费通知等），AI 给出建议状态，确认后入库" value={emailText} onChange={(e) => setEmailText(e.target.value)} />
                    <Button variant="outline" className="text-xs" disabled={parsing || !emailText.trim()} onClick={() => doParseEmail(t)}>
                      {parsing ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} AI 解析
                    </Button>
                    {parseResult && (
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-slate-500 dark:text-slate-400">建议状态：</span>
                          <Badge tone={(STATUS_META[parseResult.suggestedStatus] || STATUS_META.submitted).tone}>
                            {(STATUS_META[parseResult.suggestedStatus] || STATUS_META.submitted).label}
                          </Badge>
                          <span className="text-[11px] text-slate-400">置信度 {Math.round(parseResult.confidence * 100)}%</span>
                          {parseResult.date && <span className="text-[11px] text-slate-400">{parseResult.date}</span>}
                        </div>
                        {parseResult.reason && <div className="text-[11px] text-slate-500 dark:text-slate-400">依据：{parseResult.reason}</div>}
                        <div className="flex gap-2 pt-1">
                          <Button className="text-xs px-2 py-1" disabled={confirming} onClick={() => confirmParse(t)}>
                            {confirming ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 确认更新
                          </Button>
                          <Button variant="outline" className="text-xs px-2 py-1" onClick={() => setParseResult(null)}>忽略建议</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 状态事件时间线 */}
                <button className="mt-2 text-[11px] text-slate-400 hover:text-slate-600" onClick={() => setOpenTrackId(openTrackId === t.id ? null : t.id)}>
                  {openTrackId === t.id ? '收起历史' : `展开历史（${t.events.length} 条）`}
                </button>
                {openTrackId === t.id && (
                  <div className="mt-2 ml-1 border-l-2 border-slate-100 dark:border-slate-800 pl-3 space-y-2">
                    {t.events.map((ev) => (
                      <div key={ev.id} className="text-[12px]">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400 dark:text-slate-500">{fmtDate(ev.eventAt)}</span>
                          <Badge tone={(STATUS_META[ev.toStatus as SubmissionStatus] || STATUS_META.submitted).tone}>
                            {(STATUS_META[ev.toStatus as SubmissionStatus] || STATUS_META.submitted).label}
                          </Badge>
                          {ev.source === 'email_ai' && <span className="text-[11px] text-slate-400">AI 邮件解析</span>}
                        </div>
                        {ev.note && <div className="text-slate-500 dark:text-slate-400 mt-0.5">{ev.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
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
