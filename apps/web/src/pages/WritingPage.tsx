import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, FileText, ListTree, Loader2, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { ChatPanel } from './ChatPanel';
import { ToastContext } from '../App';
import type {
  CitationRow, Doc, DocVersionEntry, Experiment, Outline, Project, QualityReport,
  Reference, ResearchDesignResult, ReviewComment, SimulatedReviewResult,
} from '../types';
import type { VersionSnapshot } from './VersionDiffModal';
import {
  Button, Card, ConfirmDialog, Empty, ErrorBox, Input, Modal, errMsg,
  downloadBase64, downloadText, jsonText,
} from '../components/ui';
import { HBar } from '../components/charts';
import { useHotkeys } from '../lib/hotkeys';
import { BottomTabs, ShellDrawer } from '../components/AppShell';
import { WritingEditor, getWritingEditorHandle } from './writing/WritingEditor';
import { OUTLINE_TEMPLATES } from './writing/outline-templates';
import { WritingPreview } from './writing/WritingPreview';
import { WritingCitations } from './writing/WritingCitations';
import { WritingToolsPanel } from './writing/WritingToolsPanel';
import { formatRefEntry } from './writing/citeStyles';

/** 底部 Tab 定义（写作页次要面板的收纳位置） */
const WRITING_TABS = [
  { key: 'outline' as const, label: '大纲', icon: <ListTree size={13} aria-hidden="true" /> },
  { key: 'citations' as const, label: '引用与导出', icon: <FileText size={13} aria-hidden="true" /> },
  { key: 'tools' as const, label: 'AI 工具', icon: <Sparkles size={13} aria-hidden="true" /> },
];

/** 版本快照 diff 拆至独立 chunk（VersionDiffModal，仅打开对比时加载） */
const VersionDiffModal = lazy(() => import('./VersionDiffModal').then((m) => ({ default: m.VersionDiffModal })));
/** 著者-年重排入口（按钮+预览 Modal）拆至独立 chunk */
export const CiteReorderButtonLazy = lazy(() => import('./CiteReorderButton').then((m) => ({ default: m.CiteReorderButton })));
/** 导出区（Markdown/.tex/HTML/Word）独立 lazy chunk */
const DocExporter = lazy(() => import('./DocExporter').then((m) => ({ default: m.DocExporter })));

/** 取编辑器 textarea DOM 节点（ui.tsx 的 Textarea 未透传 ref，用 id 定位，不改 ui.tsx） */
function getEditorHandle() {
  return typeof document === 'undefined' ? null : getWritingEditorHandle();
}

/** 质量分配色：≥good 默认色，good~mid 琥珀，<mid 红（走主题语义色，不写死 hex） */
const scoreColor = (v: number, good = 70, mid = 50) =>
  v >= good ? undefined : v >= mid ? 'var(--orange)' : 'var(--red)';

export function WritingPage({ project, initialDocId }: { project: Project; initialDocId: string | null }) {
  /* ============ 文档与内容状态 ============ */
  const [docId, setDocId] = useState<string | null>(initialDocId);
  /** 已从远端同步到草稿的文档 id（渲染期同步守卫） */
  const [syncedDocId, setSyncedDocId] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [content, setContent] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  /** 保存失败时为 true：内容尚未落库，离开页面前必须提醒 */
  const [dirty, setDirty] = useState(false);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [topicInput, setTopicInput] = useState('');
  const [sectionTarget, setSectionTarget] = useState('');

  /* ============ AI 工具状态 ============ */
  const [polishResult, setPolishResult] = useState<{ original: string; polished: string; reason: string } | null>(null);
  const [translateTarget, setTranslateTarget] = useState<'zh' | 'en'>('zh');
  const [abstractResult, setAbstractResult] = useState<{ abstract: string; keywords: string[] } | null>(null);
  const [designResult, setDesignResult] = useState<ResearchDesignResult | null>(null);
  const [designIdea, setDesignIdea] = useState('');
  const [reviewResult, setReviewResult] = useState<SimulatedReviewResult | null>(null);

  /* ============ 审稿意见闭环状态 ============ */
  const [reviewComments, setReviewComments] = useState<ReviewComment[]>([]);
  const [syncedExtrasDocId, setSyncedExtrasDocId] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [replyId, setReplyId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [savingReply, setSavingReply] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [generatingLetter, setGeneratingLetter] = useState(false);
  const [importingComments, setImportingComments] = useState(false);

  /* ============ 引用管理状态 ============ */
  const [citations, setCitations] = useState<CitationRow[]>([]);
  const [history, setHistory] = useState<{ type: string; original: string; polished: string; reason: string }[]>([]);
  const [exportFormat, setExportFormat] = useState('apa');
  const [exported, setExported] = useState<string[]>([]);
  const [citePickerOpen, setCitePickerOpen] = useState(false);
  const [addingCiteId, setAddingCiteId] = useState<string | null>(null);

  /* ============ 视图状态 ============ */
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'split'>(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'edit' : 'split'));
  /** 底部 Tab：次要面板收在这里，同一时刻只显示一个，不再横向挤压编辑器 */
  const [bottomTab, setBottomTab] = useState<'outline' | 'citations' | 'tools'>('outline');
  /** AI 写作助手抽屉（overlay，不占布局宽度） */
  const [chatOpen, setChatOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('current');

  /* ============ 文档管理状态 ============ */
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [creatingDoc, setCreatingDoc] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<Doc | null>(null);

  /* ============ 质量与关联数据 ============ */
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [docExperiments, setDocExperiments] = useState<Experiment[]>([]);
  const [experimentsOpen, setExperimentsOpen] = useState(false);

  const toast = useContext(ToastContext);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ============ 数据加载 ============ */

  // 文档列表 + 文献库（React Query）
  const qc = useQueryClient();
  const docsQuery = useQuery({ queryKey: ['docs', project.id], queryFn: () => api.documents.list(project.id) });
  const refsQuery = useQuery({ queryKey: ['refs', project.id], queryFn: () => api.references.list(project.id), retry: 0 });
  const docs: Doc[] = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const refs: Reference[] = useMemo(() => refsQuery.data ?? [], [refsQuery.data]);
  const loadDocs = () => qc.invalidateQueries({ queryKey: ['docs', project.id] });
  // 首选中为渲染期派生（React 官方「调整 state」模式，无 effect）
  if (docId === null && docs.length > 0) setDocId(docs[0].id);

  // 当前文档（React Query）；远程 → 可编辑草稿的同步走渲染期守卫（syncedDocId），不写 effect
  const docQuery = useQuery({ queryKey: ['doc', docId], queryFn: () => api.documents.get(docId!), enabled: !!docId });
  if (docId && docQuery.data && syncedDocId !== docId) {
    setSyncedDocId(docId);
    setDoc(docQuery.data);
    setContent(docQuery.data.content ?? '');
    setOutline(jsonText<Outline | null>(docQuery.data.outline, null));
  }
  if (!docId && syncedDocId !== null) {
    setSyncedDocId(null);
    setDoc(null);
    setContent('');
    setOutline(null);
  }

  // 关联数据（引用/润色历史/审稿意见/质量/实验）一次性聚合查询；渲染期同步守卫 syncedExtrasDocId
  const extrasQuery = useQuery({
    queryKey: ['doc-extras', docId],
    enabled: !!docId,
    queryFn: async () => {
      const id = docId!;
      const [cs, hs, rcs, qr, exs] = await Promise.all([
        api.documents.citations(id).catch(() => [] as CitationRow[]),
        api.documents.polishRecords(id).catch(() => [] as { type: string; original: string; polished: string; reason: string }[]),
        api.research.reviewComments(id).catch(() => [] as ReviewComment[]),
        api.quality.latest(id).catch(() => null),
        api.experiments.byDocument(id).catch(() => [] as Experiment[]),
      ]);
      return { cs, hs, rcs, qr, exs };
    },
  });
  if (docId && extrasQuery.data && syncedExtrasDocId !== docId) {
    setSyncedExtrasDocId(docId);
    setCitations(extrasQuery.data.cs);
    setHistory(extrasQuery.data.hs);
    setReviewComments(extrasQuery.data.rcs);
    setQualityReport(extrasQuery.data.qr);
    setDocExperiments(extrasQuery.data.exs);
  }
  if (!docId && syncedExtrasDocId !== null) {
    setSyncedExtrasDocId(null);
    setReviewComments([]);
    setQualityReport(null);
    setDocExperiments([]);
  }
  const commentsLoading = !!docId && extrasQuery.isLoading;

  /* ============ 保存（防抖 + ⌘S） ============ */

  const saveNow = useCallback(
    async (manual = false) => {
      if (!docId || content === doc?.content) return;
      setSaveState('saving');
      try {
        const updated = await api.documents.update(docId, { content });
        setDoc(updated);
        setSavedAt(Date.now());
        setSaveState('idle');
        setDirty(false);
        if (manual) toast('success', '文档已保存');
      } catch (e: unknown) {
        setSaveState('error');
        setDirty(true);
        if (manual) toast('error', `保存失败：${errMsg(e)}`);
      }
    },
    [docId, content, doc?.content, toast],
  );

  useEffect(() => {
    if (!docId || content === doc?.content) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveNow();
    }, 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, docId, doc?.content, saveNow]);

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  // 写作页快捷键（统一注册表）：保存 / 折叠大纲面板
  useHotkeys([
    // 编辑器是 contenteditable，必须 allowInInput：否则输入区保护把 ⌘S/⌘B 拦死（v0.10 回归）
    { combo: 'mod+s', allowInInput: true, handler: () => { if (docId) void saveNow(true); } },
    { combo: 'mod+b', allowInInput: true, handler: () => setBottomTab((t) => (t === 'outline' ? 'tools' : 'outline')) },
  ]);

  /* ============ 工具函数 ============ */

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setAiBusy(true);
    try {
      await fn();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setAiBusy(false);
    }
  };

  const chapterStats = useMemo(() => {
    if (!content) return [] as { label: string; value: number }[];
    return content
      .split(/\n\s*##+\s*/)
      .map((part, i) => {
        const lines = part.split('\n');
        const title = i === 0 ? '前言/摘要' : (lines[0] || '未命名章节').replace(/^#+\s*/, '').trim();
        const body = i === 0 ? part : lines.slice(1).join('\n');
        return { label: title.slice(0, 16), value: body.replace(/\s/g, '').length };
      })
      .filter((c) => c.value > 0);
  }, [content]);

  const qualityScores = useMemo(
    () => (qualityReport ? jsonText<Record<string, number>>(qualityReport.scores, {}) : {}),
    [qualityReport],
  );

  const snapshots = useMemo<VersionSnapshot[]>(() => {
    if (!doc) return [];
    const arr = jsonText<DocVersionEntry[]>(doc.versions || '[]', []);
    const hist = arr.map((s) => ({ ...s, content: s.content ?? '' }));
    return [...hist, { version: doc.version, content, updatedAt: doc.updatedAt, current: true }];
  }, [doc, content]);

  const openDiffModal = () => {
    setDiffModalOpen(true);
    if (!diffA) {
      const histKeys = snapshots.filter((s) => !s.current).map((s) => `v${s.version}`);
      setDiffA(histKeys[histKeys.length - 1] || 'current');
      setDiffB('current');
    }
  };

  const restoreSnapshot = (s: VersionSnapshot) => {
    setContent(s.content);
    toast('success', `已恢复到 v${s.version}（防抖自动保存将写回）`);
    setDiffModalOpen(false);
  };

  /* ============ 文档 CRUD ============ */

  const createDoc = async () => {
    const title = newDocTitle.trim();
    if (!title) return;
    setCreatingDoc(true);
    setError('');
    try {
      const d = await api.documents.create(project.id, title);
      await loadDocs();
      setDocId(d.id);
      setNewDocTitle('');
      setShowNewDoc(false);
      toast('success', `文档「${d.title}」已创建`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setCreatingDoc(false);
    }
  };

  const confirmDeleteDoc = async () => {
    if (!deletingDoc) return;
    try {
      await api.documents.remove(deletingDoc.id);
      await loadDocs();
      if (docId === deletingDoc.id) setDocId(null);
      toast('info', `文档「${deletingDoc.title}」已删除`);
      setDeletingDoc(null);
    } catch (e: unknown) {
      setError(errMsg(e));
      setDeletingDoc(null);
    }
  };

  /* ============ AI 写作工具 ============ */

  const generateOutline = () =>
    run(async () => {
      const o = await api.documents.outline(docId!, topicInput || doc?.title || '');
      toast('success', '大纲已生成');
      setOutline(o);
      setDoc((d) => (d ? { ...d, outline: JSON.stringify(o) } : d));
      setBottomTab('outline');
    });

  /** 路线图 #17：套用本地大纲模板（零 AI，直接落库 outline） */
  const applyOutlineTemplate = async (key: string) => {
    if (!docId) return;
    const tpl = OUTLINE_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    const o = tpl.build(doc?.title || '未命名论文');
    setOutline(o);
    try {
      await api.documents.update(docId, { outline: JSON.stringify(o) });
      toast('success', `已套用模板：${tpl.label}`);
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const draftSection = (title: string) =>
    run(async () => {
      const { text } = await api.documents.section(docId!, title);
      setContent((c) => (c ? `${c}\n\n${text}` : text));
    });

  const doPolish = (mode: 'polish' | 'reduce') =>
    run(async () => {
      const target = window.getSelection()?.toString()?.trim() || content;
      if (!target) throw new Error('请先在编辑器中选中文本，或保证文档有内容');
      const r = await api.documents.polish(docId!, target, mode);
      setPolishResult(r);
      setHistory((h) => [{ type: mode, original: r.original, polished: r.polished, reason: r.reason }, ...h]);
    });

  const doTranslate = () =>
    run(async () => {
      const target = window.getSelection()?.toString()?.trim() || content;
      if (!target) throw new Error('请选择要翻译的文本');
      const { translated } = await api.documents.translate(docId!, target, translateTarget);
      setPolishResult({ original: target, polished: translated, reason: `学术翻译（${translateTarget === 'zh' ? '英→中' : '中→英'}）` });
    });

  const applyPolished = () => {
    if (!polishResult) return;
    if (window.getSelection()?.toString()) {
      setContent((c) => c.replace(polishResult.original, polishResult.polished) || polishResult.polished);
    } else {
      setContent(polishResult.polished);
    }
    setPolishResult(null);
  };

  const spliceIntoCursor = useCallback(
    (insert: string): number => {
      const h = getEditorHandle();
      const pos = h?.getCursor() ?? null;
      const start = pos ?? content.length;
      const end = start;
      const sel = content.slice(start, end);
      const next = content.slice(0, start) + sel + insert + content.slice(end);
      setContent(next);
      const caret = start + sel.length + insert.length;
      requestAnimationFrame(() => h?.setCursor(caret));
      return caret;
    },
    [content],
  );

  const insertExperimentIntoBody = (exp: Experiment) => {
    if (!exp.conclusion && !exp.figures?.[0]) {
      toast('info', '该实验暂无结论或结果图可插入');
      return;
    }
    let block = `\n\n**实验结论${exp.goal ? `（${exp.goal}）` : ''}**\n\n`;
    if (exp.conclusion) block += `${exp.conclusion}\n\n`;
    if (exp.figures?.[0]) block += `![实验结果图](${exp.figures[0]})\n\n`;
    spliceIntoCursor(block);
    toast('success', '实验结论已插入正文光标处');
  };

  const generateAbstract = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文，再生成摘要');
      const r = await api.documents.abstract(docId!);
      setAbstractResult(r);
      toast('success', '摘要与关键词已生成');
    });

  const runDesignReview = () =>
    run(async () => {
      if (!designIdea.trim()) throw new Error('请先描述你的研究想法');
      const r = await api.research.designReview(designIdea.trim(), refs.map((x) => ({ title: x.title, year: x.year, venue: x.venue, abstract: x.abstract || '' })));
      setDesignResult(r);
      toast('success', '研究设计诊断完成');
    });

  const runSimulatedReview = () =>
    run(async () => {
      if (!content.trim()) throw new Error('请先撰写论文正文');
      const r = await api.research.review(doc?.title || '未命名论文', content);
      setReviewResult(r);
      toast('success', '模拟同行评审完成');
    });

  /* ============ 引用管理 ============ */

  const buildExportedList = useCallback(
    (format: string): string[] =>
      citations.map((c, i) =>
        formatRefEntry(
          { title: c.reference.title, authors: c.reference.authors, year: c.reference.year, venue: c.reference.venue, doi: c.reference.doi },
          format,
          i + 1,
        ),
      ),
    [citations],
  );

  // 参考文献列表（派生）：非 bibtex 且已有引用时由当前 citations 直接计算；bibtex 走异步导出落 setExported
  const exportedDerived = useMemo(
    () => (exportFormat !== 'bibtex' && citations.length > 0 ? buildExportedList(exportFormat) : null),
    [citations, exportFormat, buildExportedList],
  );
  const effectiveExported = exportedDerived ?? exported;

  const exportRefs = async (format: string) => {
    setExportFormat(format);
    setError('');
    if (format === 'bibtex') {
      try {
        setExported(await api.documents.exportCitations(docId!, 'bibtex'));
      } catch (e: unknown) {
        setError(errMsg(e));
      }
      return;
    }
    setExported(buildExportedList(format));
  };

  const insertCitationAnchor = async (referenceId: string) => {
    if (!docId) return;
    const h = getEditorHandle();
    const pos = h?.getCursor() ?? null;
    const start = pos ?? content.length;
    const end = start;
    const existing = citations.findIndex((c) => c.referenceId === referenceId);
    const n = existing >= 0 ? existing + 1 : citations.length + 1;
    const marker = `[${n}]`;
    const sel = content.slice(start, end);
    const next = content.slice(0, start) + sel + marker + content.slice(end);
    const caret = start + sel.length + marker.length;
    setContent(next);
    requestAnimationFrame(() => h?.setCursor(caret));
    if (existing < 0) {
      setAddingCiteId(referenceId);
      try {
        const mIdx = next.indexOf(marker, start);
        const ctx =
          next.slice(Math.max(0, mIdx - 60), mIdx) + `⟦${marker}⟧` + next.slice(mIdx + marker.length, mIdx + marker.length + 60);
        await api.references.addCitation({ documentId: docId, referenceId, location: `anchor:${n}`, context: ctx });
        setCitations(await api.documents.citations(docId));
        toast('success', `已加入引用并插入正文锚点 [${n}]`);
      } catch (e: unknown) {
        setError(errMsg(e));
      } finally {
        setAddingCiteId(null);
      }
    } else {
      toast('success', `已在光标处追加引用锚点 [${n}]`);
    }
  };

  /* ============ 导出 ============ */

  const exportWord = async () => {
    if (!doc) return;
    try {
      setAiBusy(true);
      const { base64, filename } = await api.documents.exportDocx(doc.id);
      downloadBase64(filename, base64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      toast('success', 'Word 文档已导出（含标题/大纲/正文/参考文献）');
    } catch {
      toast('error', 'Word 导出失败');
    } finally {
      setAiBusy(false);
    }
  };

  const exportFullDoc = () =>
    run(async () => {
      const { markdown, filename } = await api.documents.exportMarkdown(docId!);
      downloadText(filename, markdown, 'text/markdown;charset=utf-8');
      setError('');
    });

  /* ============ 审稿意见闭环 ============ */

  const changeCommentStatus = async (c: ReviewComment, status: 'open' | 'resolved' | 'deferred') => {
    const prev = c.status;
    setReviewComments((s) => s.map((x) => (x.id === c.id ? { ...x, status } : x)));
    try {
      const updated = await api.research.updateReviewComment(c.id, { status });
      setReviewComments((s) => s.map((x) => (x.id === c.id ? updated : x)));
    } catch (e: unknown) {
      setReviewComments((s) => s.map((x) => (x.id === c.id ? { ...x, status: prev } : x)));
      setError(errMsg(e));
    }
  };

  const saveReply = async (c: ReviewComment) => {
    setSavingReply(true);
    try {
      const updated = await api.research.updateReviewComment(c.id, { responseText: replyDraft });
      setReviewComments((s) => s.map((x) => (x.id === c.id ? updated : x)));
      setReplyId(null);
      setReplyDraft('');
      toast('success', '回复已保存');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setSavingReply(false);
    }
  };

  const removeComment = async (c: ReviewComment) => {
    setReviewComments((s) => s.filter((x) => x.id !== c.id));
    try {
      await api.research.removeReviewComment(c.id);
      toast('info', '已删除该条意见');
    } catch (e: unknown) {
      setError(errMsg(e));
    }
  };

  const generateResponseLetter = async () => {
    setGeneratingLetter(true);
    setError('');
    try {
      const r = await api.research.responseLetter(docId!);
      setLetter(r.letter);
      toast('success', 'Point-by-point 回复信已生成');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setGeneratingLetter(false);
    }
  };

  const importFromSimulatedReview = async () => {
    if (!reviewResult || !reviewResult.reviewers?.length) return;
    setImportingComments(true);
    setError('');
    try {
      const existing = new Set(reviewComments.map((c) => c.commentText.trim()));
      const toAdd: { reviewer: string; commentText: string; category: string }[] = [];
      for (const rv of reviewResult.reviewers) {
        for (const c of rv.concerns) {
          const t = c.trim();
          if (t && !existing.has(t)) {
            toAdd.push({ reviewer: rv.role, commentText: t, category: 'concern' });
            existing.add(t);
          }
        }
      }
      if (!toAdd.length) {
        toast('info', '没有新的 concerns 可导入（已去重）');
        return;
      }
      const added = await api.research.addReviewComments(docId!, toAdd);
      setReviewComments((s) => [...s, ...added]);
      setCommentsOpen(true);
      toast('success', `已从模拟评审导入 ${added.length} 条审稿意见`);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setImportingComments(false);
    }
  };

  /* ============ UI 组装 ============ */

  const newDocDialog = (
    <Modal open={showNewDoc} title="新建论文文档" onClose={() => setShowNewDoc(false)} width="max-w-md">
      <Input
        placeholder="文档标题，如：图神经网络在药物发现中的研究综述"
        value={newDocTitle}
        onChange={(e) => setNewDocTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && createDoc()}
        autoFocus
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setShowNewDoc(false)}>
          取消
        </Button>
        <Button onClick={createDoc} disabled={creatingDoc || !newDocTitle.trim()}>
          {creatingDoc ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 创建
        </Button>
      </div>
    </Modal>
  );

  // 子组件插槽：预览区
  const previewSlot = (
    <WritingPreview
      content={content}
      editorMode={editorMode}
      exported={effectiveExported}
    />
  );

  // 子组件插槽：引用管理
  const citationsSlot = (
    <WritingCitations
      refs={refs}
      citations={citations}
      exportFormat={exportFormat}
      exported={effectiveExported}
      citePickerOpen={citePickerOpen}
      addingCiteId={addingCiteId}
      history={history}
      onOpenPicker={() => setCitePickerOpen(true)}
      onClosePicker={() => setCitePickerOpen(false)}
      onInsertAnchor={insertCitationAnchor}
      onChangeFormat={(f) => setExportFormat(f)}
      onExport={exportRefs}
      docId={docId}
      onApplyReorder={setContent}
      aiBusy={aiBusy}
      renderDocExporter={
        <Suspense fallback={<div className="h-7" />}>
          <DocExporter
            doc={doc}
            content={content}
            citations={citations}
            project={project}
            onExportFull={exportFullDoc}
            onExportWord={exportWord}
            aiBusy={aiBusy}
          />
        </Suspense>
      }
    />
  );

  /* ============ 渲染 ============ */

  if (docsQuery.isLoading && docs.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-3" role="status" aria-label="加载文档">
        <div className="skeleton h-9 w-64 rounded-lg" />
        <div className="skeleton h-[320px] rounded-xl" />
        <div className="skeleton h-10 rounded-lg" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="p-6">
          <Empty illustration="documents" text="还没有论文草稿" hint="新建一篇从大纲开始写，或到「全自动流水线」一键生成初稿" />
          <div className="flex justify-center">
            <Button onClick={() => setShowNewDoc(true)}>
              <Plus size={15} /> 新建文档
            </Button>
          </div>
        </Card>
        {newDocDialog}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 文档标签栏 + AI 助手入口：操作按钮在滚动区外，窄屏不需要横向滚动才能看到 */}
      <div className="mb-2 flex items-center gap-2 shrink-0">
        <div className="doc-tabbar flex-1 min-w-0">
          {docs.map((d) => (
            <div
              key={d.id}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap cursor-pointer border transition-colors ${
                docId === d.id ? 'bubble-user border-transparent' : 'bg-[var(--card)] border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-teal-300'
              }`}
              onClick={() => setDocId(d.id)}
            >
              <FileText size={13} aria-hidden="true" />
              {d.title}
              <button
                className="opacity-70 hover:opacity-100 p-0.5"
                aria-label={`删除文档 ${d.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingDoc(d);
                }}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button variant="outline" onClick={() => setShowNewDoc(true)} className="px-2.5 py-1" title="新建文档" aria-label="新建文档">
            <Plus size={14} aria-hidden="true" />
          </Button>
        </div>
        <Button variant="outline" onClick={() => setChatOpen(true)} className="px-2.5 py-1 shrink-0" title="打开 AI 写作助手">
          <Sparkles size={13} aria-hidden="true" /> AI 助手
        </Button>
      </div>

      <ErrorBox message={error} />

      {/* ── 布局契约 ─────────────────────────────────────────────
          主区永远是编辑器（min-w-0 由 AppShell/split 保证）；
          大纲 / AI 工具 / 引用 / 质量 / 版本 收进下方 Tab；
          AI 助手改为右侧抽屉（overlay），不再挤占横向空间。
          这样在 1024–1440 各档宽度下编辑器都不会被压缩。 */}
      <div className="writing-layout">
        <div className="writing-main">
          <WritingEditor
            doc={doc}
            content={content}
            editorMode={editorMode}
            savedAt={savedAt}
            saveState={saveState}
            onRetrySave={() => void saveNow(true)}
            onChangeContent={setContent}
            onTitleBlur={async (newTitle) => {
              // 快照 docId：标题框 blur 可能发生在切换文档之后（历史缺陷：把 A 的标题写进 B）
              const targetId = docId;
              if (!targetId) return;
              try {
                const updated = await api.documents.update(targetId, { title: newTitle });
                if (targetId !== docId) return;
                setDoc(updated);
                await loadDocs();
              } catch (e: unknown) {
                toast('error', `标题保存失败：${errMsg(e)}`);
              }
            }}
            onModeChange={setEditorMode}
            renderPreview={previewSlot}
          />
        </div>

        <BottomTabs
          tabs={WRITING_TABS}
          active={bottomTab}
          onChange={(k) => setBottomTab(k)}
        >
          {bottomTab === 'outline' && (
            <div className="writing-tabpanel">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                  <ListTree size={14} aria-hidden="true" /> 大纲
                </span>
                <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={generateOutline} disabled={aiBusy || !docId}>
                  {aiBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI 生成
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                <Input placeholder="研究方向 / 论文主题" value={topicInput} onChange={(e) => setTopicInput(e.target.value)} className="flex-1 min-w-[180px]" />
                <select
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-900"
                  value=""
                  onChange={(e) => { if (e.target.value) void applyOutlineTemplate(e.target.value); }}
                  title="套用本地大纲模板（无需 AI）"
                >
                  <option value="">套用模板…</option>
                  {OUTLINE_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>{t.label}</option>
                  ))}
                </select>
              </div>
              {!outline ? (
                <div className="text-xs text-slate-400 dark:text-slate-500">暂无大纲。输入主题后点「AI 生成」，或套用右侧模板。</div>
              ) : (
                <div className="space-y-1">
                  <div className="font-medium text-slate-800 dark:text-slate-100 text-sm mb-1">{outline.title}</div>
                  {outline.sections?.map((s, i) => (
                    <div key={i} className="group">
                      <button
                        className="flex items-center gap-1 w-full text-left text-sm text-slate-600 dark:text-slate-300 hover:text-teal-700 py-1 rounded"
                        onClick={() => draftSection(s.title)}
                        title="点击起草此章节"
                      >
                        <ChevronRight size={13} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{s.title}</span>
                        <Sparkles size={12} className="opacity-0 group-hover:opacity-100 ml-auto text-teal-500 shrink-0" aria-hidden="true" />
                      </button>
                      {s.subsections?.length > 0 && (
                        <div className="ml-4 space-y-0.5 text-xs text-slate-400 dark:text-slate-500">
                          {s.subsections.map((sub, j) => (
                            <div key={j}>· {sub}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {chapterStats.length > 1 && (
                    <details className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <summary className="cursor-pointer text-[11px] text-slate-400 dark:text-slate-500 select-none">章节字数分布</summary>
                      <div className="mt-2">
                        <HBar items={chapterStats} />
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          {bottomTab === 'citations' && <div className="writing-tabpanel">{citationsSlot}</div>}

          {bottomTab === 'tools' && (
            <div className="writing-tabpanel">
              <WritingToolsPanel
                aiBusy={aiBusy}
                abstractResult={abstractResult}
                onGenerateAbstract={generateAbstract}
                onInsertAbstract={() => {
                  if (!abstractResult) return;
                  const tail = `\n\n**摘要**：${abstractResult.abstract}\n\n**关键词**：${abstractResult.keywords.join('、')}`;
                  setContent((c) => (c.endsWith('\n\n') ? c + tail.trimStart() : c + tail));
                  setAbstractResult(null);
                }}
                designIdea={designIdea}
                onDesignIdea={setDesignIdea}
                designResult={designResult}
                onRunDesign={runDesignReview}
                outline={outline}
                sectionTarget={sectionTarget}
                onSelectSection={(v) => { setSectionTarget(v); if (v) draftSection(v); }}
                onPolish={doPolish}
                translateTarget={translateTarget}
                onTranslateTarget={(v) => setTranslateTarget(v as 'zh' | 'en')}
                onTranslate={doTranslate}
                polishResult={polishResult}
                onApplyPolished={applyPolished}
                onDismissPolish={() => setPolishResult(null)}
                reviewResult={reviewResult}
                onRunReview={runSimulatedReview}
                reviewComments={reviewComments}
                commentsOpen={commentsOpen}
                onToggleComments={() => setCommentsOpen((v) => !v)}
                commentsLoading={commentsLoading}
                onGenerateLetter={generateResponseLetter}
                onImportComments={importFromSimulatedReview}
                generatingLetter={generatingLetter}
                importingComments={importingComments}
                onChangeCommentStatus={changeCommentStatus}
                replyId={replyId}
                replyDraft={replyDraft}
                onReplyDraft={setReplyDraft}
                onStartReply={(c) => { setReplyId(c.id); setReplyDraft(c.responseText || ''); }}
                onCancelReply={() => { setReplyId(null); setReplyDraft(''); }}
                onSaveReply={saveReply}
                savingReply={savingReply}
                onRemoveComment={removeComment}
                letter={letter}
                qualityReport={qualityReport}
                qualityScores={qualityScores}
                scoreColor={scoreColor}
                docExperiments={docExperiments}
                experimentsOpen={experimentsOpen}
                onToggleExperiments={() => setExperimentsOpen((v) => !v)}
                onInsertExperiment={insertExperimentIntoBody}
                versionsOpen={versionsOpen}
                onToggleVersions={() => setVersionsOpen((v) => !v)}
                snapshots={snapshots}
                onOpenDiff={openDiffModal}
              />
            </div>
          )}
        </BottomTabs>
      </div>

      {/* AI 写作助手：右侧抽屉（不占布局宽度） */}
      <ShellDrawer open={chatOpen} onClose={() => setChatOpen(false)} title="AI 写作助手">
        <ChatPanel
          project={project}
          doc={doc}
          onDocUpdated={async (patch) => {
            if (!doc) return;
            try {
              await api.documents.update(doc.id, patch);
              setDoc((prev) => (prev ? { ...prev, ...patch } : prev));
            } catch {
              toast('error', '保存到文档失败');
            }
          }}
        />
      </ShellDrawer>

      {/* 新建文档弹窗（空态与主界面共用） */}
      {newDocDialog}

      {/* 版本左右栏 Diff（独立 lazy chunk，打开时才加载）：两栏对比 + 命名 + 恢复 */}
      <Suspense fallback={null}>
        {diffModalOpen && docId && (
          <VersionDiffModal
            open={diffModalOpen}
            onClose={() => setDiffModalOpen(false)}
            docId={docId}
            snapshots={snapshots}
            diffA={diffA}
            diffB={diffB}
            onSelectA={setDiffA}
            onSelectB={setDiffB}
            onRestore={restoreSnapshot}
          />
        )}
      </Suspense>

      {/* 删除文档确认弹窗 */}
      <ConfirmDialog
        open={!!deletingDoc}
        title="删除文档"
        description={`确定要删除「${deletingDoc?.title ?? ''}」吗？文档内容及其润色/翻译历史将一并删除，且无法恢复。`}
        confirmText="删除"
        danger
        onConfirm={confirmDeleteDoc}
        onClose={() => setDeletingDoc(null)}
      />
    </div>
  );
}
