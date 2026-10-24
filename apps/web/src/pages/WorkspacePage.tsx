import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Brain, Check, Download, ExternalLink, FilePlus2, Globe, Loader2, MessageSquare, Navigation, Pencil,
  PlayCircle, Plus, Quote, Search, Send, Sparkles, Square, Trash2, Workflow,
} from 'lucide-react';
import { PIPELINE_STEPS } from '@sciflow/core/pipeline-steps';
import { api } from '../api/client';
import { MessageList } from '../components/MessageList';
import { useSplitDrag } from '../lib/split-drag';
import { useHotkeys } from '../lib/hotkeys';
import { useAsyncAction } from '../lib/async';
import { useChatSession, parseFollowUps, FOLLOWUP_HINT, type ChatMessage, type SendOptions } from '../lib/chat-session';
import {
  createSession, deriveTitle, loadActiveSessionId, loadDraft, loadSessions, saveActiveSessionId, saveDraft, saveSessions,
  type ChatSession,
} from './chat/chat-sessions';
import type { ChatSource, Doc, IntentResult, KnowledgeDoc, Outline, PipelineTask, Project } from '../types';
import { Badge, Button, ConfirmDialog, Empty, ErrorBox, Input, Modal } from '../components/ui';
import { WritingPreview } from './writing/WritingPreview';

/**
 * WorkspacePage — 对话优先工作台（唯一对话入口）：
 *   左：对话线程（流式 Markdown、推理折叠、知识库来源卡、多会话管理）
 *   右：当前文档预览（懒加载选中文档，写作产物就地可见）
 *   顶部：文档选择 / 新建文档 / 运行流水线 / 会话 / 导出快照
 *
 * 设计立场（2026-10 产品重构）：主要工作 = 对话 + 预览；流水线是"一条消息里的长任务"，
 * 以 run card 形式内联在对话流中；其余工具页降级为 ⌘K 命令面板可达的次级视图。
 * 数据获取统一走 @tanstack/react-query；对话内核走 useChatSession（累积/停止/错误语义单点强制）。
 *
 * v0.11 合并：科研问答页并入本页（同一内核同一渲染，此前是两套重复界面）——
 * 多会话（localStorage，与原科研问答页同 key，旧会话自动延续）、模型选择、深度思考、
 * 意图识别、slash 快捷指令、followUps 追问、来源引用进草稿、Markdown 快照导出。
 */

/** 步骤中文名：单一来源 packages/core/pipeline-steps（此前本页另写一份，标签与设置页漂移） */
const STEP_LABELS: Record<string, string> = Object.fromEntries(PIPELINE_STEPS.map((s) => [s.key, s.label]));

/** Slash 快捷指令（对话直达高频科研动作） */
const SLASH_COMMANDS: { name: string; desc: string; template: string }[] = [
  { name: '润色', desc: '提升学术表达质量', template: '请润色以下内容，提升学术表达质量，保持原意：\n\n' },
  { name: '翻译英文', desc: '翻译为地道学术英文', template: '请将以下内容翻译为地道的学术英文：\n\n' },
  { name: '生成摘要', desc: '提取要点与关键词', template: '请为以下内容生成摘要（3-5 句话）与关键词列表：\n\n' },
  { name: '生成大纲', desc: '围绕主题生成论文大纲', template: '请围绕以下主题生成一份论文大纲（章节+要点）：\n\n' },
  { name: '降重', desc: '改写降低重复率', template: '请改写以下内容以降低与原文的重复率，保持原意与学术性：\n\n' },
  { name: '补充引用', desc: '建议可引用文献与研究', template: '请针对以下内容，建议可引用的相关文献与研究并说明理由：\n\n' },
  { name: '深入追问', desc: '就内容继续深挖', template: '请就以下内容进一步深入分析，给出更细致的论证：\n\n' },
];

export function WorkspacePage({
  project,
  initialDocId,
  onOpenFullEditor,
}: {
  project: Project;
  initialDocId: string | null;
  onOpenFullEditor: (docId: string) => void;
}) {
  const qc = useQueryClient();
  const [docId, setDocId] = useState<string | null>(initialDocId);

  // ── 本地多会话（localStorage，按项目隔离；与旧科研问答页同 key，旧会话自动延续） ──
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const list = loadSessions(project.id);
    if (list.length) return list;
    // 一次性迁移：更早版本工作台的单线程 → 会话模型
    try {
      const raw = localStorage.getItem(`sciflow.workspace.thread.${project.id}`);
      if (raw) {
        const msgs = (JSON.parse(raw) as ChatMessage[]).filter((m) => !m.streaming);
        if (msgs.some((m) => m.role === 'user')) {
          const s = createSession();
          s.title = deriveTitle(msgs);
          s.messages = msgs;
          s.updatedAt = Date.now();
          saveSessions(project.id, [s]);
          saveActiveSessionId(project.id, s.id);
          // 一次性迁移的关键：删源 key。否则「删光会话后重挂载」会把旧线程复活
          try { localStorage.removeItem(`sciflow.workspace.thread.${project.id}`); } catch { /* 隐私模式删不掉：接受可能复活 */ }
          return [s];
        }
      }
    } catch {
      /* 迁移失败按无会话处理 */
    }
    return [];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadActiveSessionId(project.id);
    return saved && sessions.some((s) => s.id === saved) ? saved : (sessions[0]?.id ?? createSession().id);
  });
  const [input, setInput] = useState(() => loadDraft(project.id, activeId));
  const [sessionFilter, setSessionFilter] = useState('');
  const [renamingSession, setRenamingSession] = useState<{ id: string; title: string } | null>(null);
  const [deletingSession, setDeletingSession] = useState<{ id: string; title: string } | null>(null);

  // ── 对话内核（onSend=意图旁路；doneTransform=followUps 解析；onMessagesChange=会话落盘） ──
  const [error, setError] = useState('');
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [intentBusy, setIntentBusy] = useState(false);
  /** 会话消息变动即落盘（内核保证流式瞬态不触发；无用户消息的空会话不落） */
  const syncSession = useCallback(
    (ms: ChatMessage[]) => {
      const clean = ms.filter((m) => !m.streaming);
      if (!clean.some((m) => m.role === 'user')) return;
      setSessions((prev) => {
        const now = Date.now();
        const prevCur = prev.find((s) => s.id === activeId);
        const msgs = clean.map(({ streaming: _s, ...rest }) => rest);
        // 内容未变（如打开旧会话触发内核持久化）不 bump updatedAt、不重排：
        // 会话排序语义是「最后发言」，不是「最后打开」
        const changed = JSON.stringify(msgs) !== JSON.stringify(prevCur?.messages ?? []);
        const current: ChatSession = {
          id: activeId,
          title: deriveTitle(clean),
          createdAt: prevCur?.createdAt ?? now,
          updatedAt: changed ? now : (prevCur?.updatedAt ?? now),
          messages: msgs,
        };
        const next = changed ? [current, ...prev.filter((s) => s.id !== activeId)] : prev.map((s) => (s.id === activeId ? current : s));
        saveSessions(project.id, next);
        return next;
      });
      saveActiveSessionId(project.id, activeId);
    },
    [activeId, project.id],
  );
  const chat = useChatSession({
    initialMessages: (() => {
      const target = sessions.find((s) => s.id === activeId);
      return target && target.messages.length ? (target.messages as ChatMessage[]) : [];
    })(),
    onSend: (text) => {
      setIntentBusy(true);
      setIntent(null);
      api.judgment.intent(text, project.name).then(setIntent).catch(() => undefined).finally(() => setIntentBusy(false));
    },
    doneTransform: (full) => parseFollowUps(full),
    onMessagesChange: syncSession,
  });
  const messages = chat.messages;
  const streaming = chat.streaming;

  /* 草稿自动保存（300ms 防抖；切会话/刷新后恢复） */
  useEffect(() => {
    const t = setTimeout(() => saveDraft(project.id, activeId, input), 300);
    return () => clearTimeout(t);
  }, [input, project.id, activeId]);

  // ── 工具条状态 ──
  const [topic, setTopic] = useState('');
  const [showRun, setShowRun] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showSessionsPanel, setShowSessionsPanel] = useState(false);
  const previewPanel = useSplitDrag({ initial: 460, min: 300, max: 640, storageKey: 'sciflow:workspace-preview-w' });
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashActive, setSlashActive] = useState(0);

  // ── 数据层（React Query）──────────────────────────────────
  const docsQuery = useQuery({ queryKey: ['docs', project.id], queryFn: () => api.documents.list(project.id) });
  // 服务端沉淀摘要（chat_session 落库）：点击注入为对话背景
  const [sessionContext, setSessionContext] = useState<string | null>(null);
  const summariesQuery = useQuery({
    queryKey: ['chat-summaries', project.id],
    queryFn: () => api.chat.sessions(project.id),
    enabled: showSessionsPanel,
  });
  // 知识库清单（来源卡「引用进草稿」用）
  const [kbByName, setKbByName] = useState<Map<string, KnowledgeDoc>>(new Map());
  const [citeSource, setCiteSource] = useState<ChatSource | null>(null);
  const [citing, setCiting] = useState(false);
  const docs: Doc[] = docsQuery.data ?? [];

  useEffect(() => {
    api.settings.get().then((s) => setModels(s.ai.models || [])).catch(() => undefined);
    api.knowledge.list(project.id).then((list) => setKbByName(new Map(list.map((d) => [d.name, d])))).catch(() => undefined);
  }, [project.id]);

  // 流水线轮询：仅在有活动任务时以 2.5s 间隔刷新（React Query refetchInterval）
  const taskQuery = useQuery({
    queryKey: ['pipeline-task', taskId],
    queryFn: () => api.pipeline.get(taskId!),
    enabled: !!taskId,
    refetchInterval: (q) => {
      const t = q.state.data as PipelineTask | undefined;
      if (!t) return 2500;
      return t.status === 'running' || t.status === 'awaiting_confirmation' ? 2500 : false;
    },
  });
  const task: PipelineTask | undefined = taskQuery.data;
  // 选中文档为「派生」：显式选择 > 流水线产物 > 传入初值 > 列表首个（不在 effect 里写 state）
  const effectiveDocId = docId ?? task?.documentId ?? initialDocId ?? docs[0]?.id ?? null;
  useEffect(() => {
    if (task?.documentId) {
      void qc.invalidateQueries({ queryKey: ['docs', project.id] });
      void qc.invalidateQueries({ queryKey: ['doc', task.documentId] });
    }
  }, [task?.documentId, task?.status, project.id, qc]);

  const docQuery = useQuery({
    queryKey: ['doc', effectiveDocId],
    queryFn: () => api.documents.get(effectiveDocId!),
    enabled: !!effectiveDocId,
  });
  const activeDoc: Doc | undefined = docQuery.data;

  // ── 对话 ─────────────────────────────────────────────────
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }));
  }, []);

  /** 消息变化即滚动到底（内核把流式增量也落到 messages，替代旧的逐回调滚动） */
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /** 复制单条消息（勾选反馈由 MessageList 内部处理） */
  const copyMsg = useCallback(async (i: number) => {
    try {
      await navigator.clipboard.writeText(messages[i].content);
    } catch {
      /* 剪贴板不可用（http 非安全上下文等）：静默失败不打断对话 */
    }
  }, [messages]);

  /** 当前文档上下文（预览文档正文片段） */
  const docContext = activeDoc && effectiveDocId
    ? `当前文档《${activeDoc.title}》正文（片段）：\n${(activeDoc.content || '').slice(0, 1500)}`
    : undefined;

  const chatOpts = (): SendOptions => ({
    projectId: project.id,
    docContext,
    sessionContext: sessionContext || undefined,
    model: model || undefined,
    enableThinking: thinking || undefined,
    webSearch: webSearch || undefined,
    messageSuffix: FOLLOWUP_HINT,
  });

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setSlashDismissed(false);
    saveDraft(project.id, activeId, '');
    chat.send(text, chatOpts());
  };

  // Esc 停止（统一快捷键注册表；生成中才生效，输入框内也响应）
  useHotkeys([
    {
      combo: 'escape',
      allowInInput: true,
      handler: () => {
        if (!streaming) return false;
        chat.stop();
      },
    },
  ]);

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组词中的 Enter 不能当作发送（历史缺陷：拼音未上屏就发出）
    if (e.nativeEvent.isComposing) return;
    if (slashOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashActive((a) => Math.min(a + 1, Math.max(slashFiltered.length - 1, 0))); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashActive((a) => Math.max(a - 1, 0)); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applySlash(slashFiltered[slashActive] ?? slashFiltered[0]); return; }
      if (e.key === 'Escape') { setSlashDismissed(true); return; }
    }
    // Enter 发送（Shift+Enter 换行；⌘/Ctrl+Enter 兼容），与输入区提示一致
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /** 来源卡「引用进草稿」：把知识库片段登记为当前论文的引用 */
  const openCite = (s: ChatSource) => {
    if (!kbByName.get(s.docName)?.referenceId) return;
    setCiteSource(s);
  };

  const doCite = async (docId: string) => {
    if (!citeSource) return;
    const refId = kbByName.get(citeSource.docName)?.referenceId;
    if (!refId) return;
    setCiting(true);
    try {
      await api.references.addCitation({
        documentId: docId,
        referenceId: refId,
        location: 'rag:' + citeSource.docName,
        context: (citeSource.chunkText || '').slice(0, 200),
      });
      setCiteSource(null);
    } catch (e: unknown) {
      setError(String((e as Error)?.message || '引用失败'));
    } finally {
      setCiting(false);
    }
  };

  /** 发送到写作页：新建草稿并写入内容（三态防重复提交） */
  const sendWriting = useAsyncAction(
    async (i: number) => {
      const firstLine = messages[i].content.split('\n').find((l) => l.trim())?.trim() || '';
      const doc = await api.documents.create(project.id, `${firstLine.slice(0, 20) || '聊天摘录'}（聊天摘录）`);
      await api.documents.update(doc.id, { content: messages[i].content });
      window.location.hash = `/writing?doc=${doc.id}`;
    },
    { onError: (message) => setError(message) },
  );

  /** 导出当前会话为 Markdown 快照 */
  const exportSnapshot = () => {
    const lines = [`# 科研问答快照 · ${project.name}`, '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    for (const m of messages) {
      if (m.role === 'user') {
        lines.push('## 提问', '', m.content, '');
      } else {
        lines.push('## 回答', '');
        if (m.reasoning) lines.push(`> 思考过程：${m.reasoning.slice(0, 600)}`, '');
        lines.push(m.content || '（空）', '');
        if (m.sources?.length) {
          lines.push('参考来源：');
          for (const s of m.sources) lines.push(`- ${s.docName}（相关度 ${Math.round(Math.min(100, Math.max(0, s.score)))}%）`);
          lines.push('');
        }
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `科研问答快照-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ── 会话管理 ─────────────────────────────────────────────
  const startNewSession = () => {
    const s = createSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    saveActiveSessionId(project.id, s.id);
    chat.reset([]);
    setInput('');
    setIntent(null);
  };

  const openSession = (id: string) => {
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    setActiveId(id);
    saveActiveSessionId(project.id, id);
    chat.reset(target.messages.length ? (target.messages as ChatMessage[]) : []);
    setInput(loadDraft(project.id, id));
    setIntent(null);
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter((s) => s.id !== id);
    setSessions(next);
    saveSessions(project.id, next);
    if (id === activeId) {
      const fallback = next[0];
      setActiveId(fallback?.id ?? createSession().id);
      chat.reset(fallback?.messages.length ? (fallback.messages as ChatMessage[]) : []);
    }
  };

  const renameSession = (id: string, title: string) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s));
      saveSessions(project.id, next);
      return next;
    });
  };

  const filteredSessions = useMemo(
    () => (sessionFilter.trim() ? sessions.filter((s) => s.title.toLowerCase().includes(sessionFilter.trim().toLowerCase())) : sessions),
    [sessions, sessionFilter],
  );

  // ── 流水线 ───────────────────────────────────────────────
  const runPipeline = useMutation({
    mutationFn: () => api.pipeline.create(project.id, topic.trim()),
    onSuccess: (t) => {
      setTaskId(t.id);
      setShowRun(false);
      setTopic('');
      chat.append({ role: 'assistant', content: `已启动全自动流水线（主题：${t.topic}）。进度与确认操作见下方运行卡片。` });
      scrollToBottom();
    },
  });
  const confirmOutline = useMutation({
    mutationFn: (chosen?: Outline) => api.pipeline.confirmOutline(taskId!, chosen),
    onSuccess: () => {
      setChosenVariant(null);
      void qc.invalidateQueries({ queryKey: ['pipeline-task', taskId] });
    },
  });
  const newDoc = useMutation({
    mutationFn: () => api.documents.create(project.id, '未命名论文'),
    onSuccess: (d) => {
      setDocId(d.id);
      void qc.invalidateQueries({ queryKey: ['docs', project.id] });
    },
  });

  // 运行卡「已用时」计时（busy 时每秒刷新；interval 回调内 setState，符合 hooks 规范）
  const [nowTs, setNowTs] = useState(() => Date.now());
  const taskBusy = !!task && (task.status === 'running' || task.status === 'awaiting_confirmation');
  useEffect(() => {
    if (!taskBusy) return;
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [taskBusy]);

  const outlinePreview = useMemo(() => {
    const step = task?.steps.find((s) => s.key === 'outline');
    if (!step?.output) return null;
    try {
      const o = JSON.parse(step.output) as { title?: string; sections?: { title: string }[] };
      return o;
    } catch {
      return null;
    }
  }, [task?.steps]);

  /** F2 反共识大纲变体：outline 步骤 variants（Outline JSON 串数组） */
  const outlineVariants = useMemo(() => {
    const step = task?.steps.find((s) => s.key === 'outline');
    if (!step?.variants?.length) return [];
    return step.variants
      .map((v) => {
        try {
          return JSON.parse(v) as Outline;
        } catch {
          return null;
        }
      })
      .filter((o): o is Outline => !!o);
  }, [task?.steps]);
  /** 工作台内选中的变体（null=主推大纲原样确认） */
  const [chosenVariant, setChosenVariant] = useState<Outline | null>(null);

  const busy = task && (task.status === 'running' || task.status === 'awaiting_confirmation');
  const hasConversation = messages.some((m) => m.role === 'user');
  const slashFiltered = input.startsWith('/') ? SLASH_COMMANDS.filter((c) => c.name.includes(input.slice(1))).slice(0, 5) : [];
  // slash 菜单为派生状态（输入 "/" 即出，Esc 仅记忆"本次已关闭"，输入变化即重置）
  const slashOpen = !slashDismissed && input.startsWith('/') && slashFiltered.length > 0;
  const applySlash = (c: (typeof SLASH_COMMANDS)[number]) => {
    setInput(c.template);
    setSlashActive(0);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 顶栏：文档流 & 流水线入口 */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
        <select
          className="rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 text-sm bg-white dark:bg-slate-900 outline-none max-w-[min(60vw,220px)] sm:max-w-[280px] min-w-0"
          value={effectiveDocId ?? ''}
          onChange={(e) => setDocId(e.target.value || null)}
        >
          <option value="">（未选择文档）</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => newDoc.mutate()} loading={newDoc.isPending} title="新建文档">
          <FilePlus2 size={14} /> 新建
        </Button>
        <Button variant="outline" onClick={() => setShowRun((v) => !v)} disabled={!!busy} title="运行全自动流水线">
          <Workflow size={14} /> 运行流水线
        </Button>
        <Button
          variant={showSessionsPanel ? 'subtle' : 'outline'}
          onClick={() => setShowSessionsPanel((v) => !v)}
          title="会话管理（多会话 / 沉淀摘要）"
        >
          <MessageSquare size={14} /> 会话{sessions.length > 1 ? ` · ${sessions.length}` : ''}
        </Button>
        <Button variant="ghost" onClick={exportSnapshot} disabled={!hasConversation} title="导出当前会话为 Markdown">
          <Download size={14} /> 导出
        </Button>
        {effectiveDocId && (
          <Button variant="outline" className="lg:hidden" onClick={() => setShowPreview(true)} title="查看文档预览">
            <ExternalLink size={14} /> 预览
          </Button>
        )}
        {effectiveDocId && (
          <Button variant="ghost" onClick={() => onOpenFullEditor(effectiveDocId)} title="打开完整写作页（大纲/引用/导出）">
            <ExternalLink size={14} /> 完整编辑器
          </Button>
        )}
        {busy && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-teal-600 dark:text-teal-300">
            <Loader2 size={13} className="animate-spin" /> 流水线进行中：{STEP_LABELS[task.currentStep] || task.currentStep}
          </span>
        )}
      </div>

      {/* 会话面板：本地多会话（管理）+ 服务端沉淀摘要（注入对话背景） */}
      {showSessionsPanel && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shrink-0 max-h-[300px] overflow-y-auto space-y-4">
          <section aria-label="本地会话">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">本地会话（{sessions.length}）</div>
              <div className="relative ml-auto w-40">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={sessionFilter}
                  onChange={(e) => setSessionFilter(e.target.value)}
                  placeholder="搜索会话"
                  aria-label="搜索会话"
                  className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent pl-7 pr-2 py-1 text-[11px] outline-none focus:border-teal-500"
                />
              </div>
              <Button size="xs" variant="subtle" onClick={startNewSession} title="开始新会话">
                <Plus size={12} /> 新对话
              </Button>
            </div>
            {filteredSessions.length === 0 && <div className="text-xs text-slate-400 py-2">暂无会话，发送第一条消息后自动创建</div>}
            <div className="space-y-1">
              {filteredSessions.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer transition-colors ${
                    s.id === activeId
                      ? 'border-teal-300 bg-teal-50/70 dark:bg-teal-900/20 dark:border-teal-700'
                      : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                  onClick={() => openSession(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openSession(s.id); }}
                >
                  <MessageSquare size={12} className="text-slate-400 shrink-0" />
                  <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1">{s.title}</span>
                  <span className="text-[11px] text-slate-400 shrink-0">{new Date(s.updatedAt).toLocaleDateString('zh-CN')} · {s.messages.length} 条</span>
                  <span className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setRenamingSession({ id: s.id, title: s.title }); }}
                      className="p-1 text-slate-400 hover:text-teal-600 rounded"
                      aria-label={`重命名会话 ${s.title}`}
                    ><Pencil size={11} /></button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeletingSession({ id: s.id, title: s.title }); }}
                      className="p-1 text-slate-400 hover:text-rose-500 rounded"
                      aria-label={`删除会话 ${s.title}`}
                    ><Trash2 size={11} /></button>
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section aria-label="沉淀摘要">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">沉淀摘要（服务端 · 点击引用其摘要作为对话背景）</div>
            {summariesQuery.isLoading && <div className="text-xs text-slate-400">加载中…</div>}
            {!summariesQuery.isLoading && (summariesQuery.data?.sessions?.length ?? 0) === 0 && (
              <div className="text-xs text-slate-400">暂无沉淀（完成一次问答后自动摘要落库）</div>
            )}
            <div className="space-y-1.5">
              {(summariesQuery.data?.sessions ?? []).map((sess) => (
                <button
                  key={sess.id}
                  className={`w-full text-left rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    sessionContext === sess.summary
                      ? 'border-teal-400 bg-teal-50/60 dark:bg-teal-900/20 dark:border-teal-700'
                      : 'border-slate-200 dark:border-slate-700 hover:border-teal-300'
                  }`}
                  onClick={() => setSessionContext(sessionContext === sess.summary ? null : sess.summary)}
                >
                  <div className="text-slate-700 dark:text-slate-200 line-clamp-2">{sess.summary || '（无摘要）'}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {new Date(sess.createdAt).toLocaleString()} · {sess.messageCount} 条消息 · {sess.totalTokens} tokens
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 流水线启动条（内联，不弹窗） */}
      {showRun && (
        <div className="flex items-center gap-2 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 px-3 py-2 shrink-0">
          <Input
            autoFocus
            placeholder="输入研究主题，例如：图神经网络在药物发现中的应用综述"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && topic.trim()) runPipeline.mutate(); }}
            className="flex-1"
          />
          <Button onClick={() => topic.trim() && runPipeline.mutate()} loading={runPipeline.isPending} disabled={!topic.trim()}>
            <PlayCircle size={14} /> 启动
          </Button>
        </div>
      )}

      {/* 主体：对话（左）+ 文档预览（右） */}
      <div className="flex-1 min-h-0 flex gap-3">
        <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <ErrorBox message={error} />

          {(intent || intentBusy) && (
            <div className="px-3.5 pt-2.5 shrink-0">
              <div className="inline-flex items-center gap-2 text-xs bg-teal-50/60 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-full px-3 py-1 page-in max-w-full">
                {intentBusy ? (
                  <><Loader2 size={12} className="animate-spin text-teal-600" /><span className="text-slate-500 dark:text-slate-400" role="status">正在识别意图…</span></>
                ) : intent ? (
                  <>
                    <Sparkles size={12} className="text-teal-600 shrink-0" />
                    <span className="text-slate-600 dark:text-slate-300 truncate">意图：<b className="text-teal-700 dark:text-teal-300">{intent.label}</b>（{Math.round(intent.confidence * 100)}%）</span>
                    {intent.route !== '/workspace' && (
                      <button className="flex items-center gap-1 shrink-0 text-teal-700 dark:text-teal-300 hover:underline" onClick={() => { window.location.hash = intent.route; }}>
                        <Navigation size={11} /> 前往
                      </button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          )}

          <div ref={threadRef} data-testid="chat-thread" className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.length === 0 && (
              <div className="pt-4">
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="w-11 h-11 rounded-xl brand-logo flex items-center justify-center">
                    <Sparkles size={19} className="text-white" aria-hidden="true" />
                  </div>
                  <div className="text-sm font-medium text-slate-600 dark:text-slate-300">开始与 SciFlow 对话</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 max-w-md">
                    让 AI 起草章节、润色、答疑；或点上方「运行流水线」一键成稿——产物可在预览中查看。输入 "/" 唤出快捷指令。
                  </div>
                </div>
                <div className="mt-5 grid sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
                  {[
                    { t: '起草一段引言', d: '基于当前文档与知识库', q: '请基于当前文档和知识库资料，起草「引言」一节（600 字左右，学术风格，引用使用 [n] 锚点）。' },
                    { t: '润色这段正文', d: '提升表达与逻辑', q: '请润色当前文档正文，提升学术表达与逻辑连贯性，并说明主要修改点。' },
                    { t: '找研究空白', d: '从文献库归纳', q: '请基于我的文献库，找出该方向尚未被充分研究的问题，并给出 3 个可执行的选题。' },
                    { t: '解释一个概念', d: '由浅入深 + 例子', q: '请由浅入深解释图神经网络的消息传递机制，并给一个直观例子。' },
                  ].map((c) => (
                    <button
                      key={c.t}
                      onClick={() => { setInput(c.q); requestAnimationFrame(() => taRef.current?.focus()); }}
                      className="text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--card)] p-3 hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-teal-900/10 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <Sparkles size={12} className="text-teal-600" aria-hidden="true" /> {c.t}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{c.d}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <MessageList
              messages={messages}
              streaming={streaming}
              onCopy={(i) => void copyMsg(i)}
              onRetry={(i) => chat.retry(i, chatOpts())}
              onContinue={(i) => chat.cont(i, chatOpts())}
              onStop={chat.stop}
              onDelete={(i) => chat.remove(i)}
              onCite={(src) => openCite(src)}
              onSendToWriting={(i) => void sendWriting.run(i)}
              onFollowUp={(f, i) => chat.send(f, { ...chatOpts(), baseMessages: messages.slice(0, i + 1) })}
              userBubble="plain"
            />

            {/* 流水线运行卡（内联在对话流） */}
            {task && (
              <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-white dark:bg-slate-900 shadow-sm p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-teal-700 dark:text-teal-300 mb-2">
                  <Workflow size={13} /> 流水线 · {task.topic}
                  <span className="ml-auto font-normal text-slate-400">
                    {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : '进行中'}
                    {taskBusy && task.createdAt ? ` · ${Math.max(0, Math.floor((nowTs - task.createdAt) / 1000))}s` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {task.steps.map((s) => (
                    <span
                      key={s.key}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
                        s.status === 'done' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : s.status === 'failed' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                        : s.status === 'running' || s.status === 'scored' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                        : s.status === 'awaiting_confirmation' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {s.status === 'done' && <Check size={9} />}
                      {(s.status === 'running' || s.status === 'scored') && <Loader2 size={9} className="animate-spin" />}
                      {STEP_LABELS[s.key] || s.label}
                    </span>
                  ))}
                </div>
                {task.status === 'awaiting_confirmation' && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 mb-2">
                    <div className="text-[11px] text-amber-800 dark:text-amber-300 mb-1.5">大纲已生成，确认后开始起草：</div>
                    {outlineVariants.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mb-2" role="radiogroup" aria-label="大纲方案">
                        {['主推方案', ...outlineVariants.map((_, i) => `反共识 ${String.fromCharCode(65 + i)}`)].map((label, i) => {
                          const isMain = i === 0;
                          const activeChip = isMain ? !chosenVariant : chosenVariant === outlineVariants[i - 1];
                          return (
                            <button
                              key={i}
                              role="radio"
                              aria-checked={activeChip}
                              title={isMain ? '按主流学术结构生成的大纲' : '刻意挑战主流叙事的反共识变体大纲'}
                              onClick={() => setChosenVariant(isMain ? null : outlineVariants[i - 1])}
                              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                                activeChip
                                  ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-200'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-teal-300'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {(() => {
                      const shown = chosenVariant ?? outlinePreview;
                      return shown ? (
                        <ol className="text-xs text-slate-700 dark:text-slate-200 list-decimal ml-4 space-y-0.5 mb-2">
                          <li className="font-medium list-none -ml-4 mb-1">{shown.title}</li>
                          {((shown.sections || []) as { title: string }[]).map((s, k) => (
                            <li key={k}>{s.title}</li>
                          ))}
                        </ol>
                      ) : null;
                    })()}
                    <div className="flex gap-2">
                      <Button className="text-xs px-3 py-1.5" onClick={() => confirmOutline.mutate(chosenVariant ?? undefined)} loading={confirmOutline.isPending}>
                        <Check size={12} /> 确认并开始起草
                      </Button>
                      <a className="text-xs self-center text-slate-400 hover:text-slate-600" href={`#/pipeline`}>
                        去高级页编辑大纲 →
                      </a>
                    </div>
                  </div>
                )}
                {task.status === 'completed' && (
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="green">
                      {task.steps.find((s) => s.key === 'quality-gate')?.output?.match(/总分\s*\d+/)?.[0] || '完成'}
                    </Badge>
                    {task.documentId && (
                      <button className="text-teal-600 dark:text-teal-300 hover:underline" onClick={() => setDocId(task.documentId!)}>
                        查看成稿 →
                      </button>
                    )}
                  </div>
                )}
                {task.status === 'failed' && <div className="text-xs text-rose-500">{task.lastError || '执行失败'}</div>}
              </div>
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-slate-100 dark:border-slate-800 p-2.5 shrink-0 relative">
            {/* Slash 下拉 */}
            {slashOpen && (
              <div className="absolute bottom-full left-3 right-3 mb-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--card)] shadow-lg overflow-hidden page-in z-10" role="listbox" aria-label="快捷指令">
                {slashFiltered.map((c, ci) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => applySlash(c)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 ${ci === slashActive ? 'bg-teal-50 dark:bg-teal-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                  >
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 w-20 shrink-0">/{c.name}</span>
                    <span className="text-[11px] text-slate-400 truncate">{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <button
                onClick={() => setWebSearch((v) => !v)}
                aria-pressed={webSearch}
                className={`flex items-center gap-1 text-[11px] rounded-md px-1.5 py-1 border transition-colors ${webSearch ? 'bg-teal-50 dark:bg-teal-500/10 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                title="联网搜索：本轮回答会检索公开网页"
              >
                <Globe size={12} /> 联网{webSearch ? '已开' : ''}
              </button>
              <button
                onClick={() => setThinking((v) => !v)}
                aria-pressed={thinking}
                className={`flex items-center gap-1 text-[11px] rounded-md px-1.5 py-1 border transition-colors ${thinking ? 'bg-teal-50 dark:bg-teal-500/10 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}
                title="深度思考：先输出推理过程（需模型支持）"
              >
                <Brain size={12} /> 深度思考
              </button>
              {models.length > 0 && (
                <select
                  className="text-[11px] bg-transparent text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-1 max-w-[140px] outline-none focus:ring-1 focus:ring-teal-500"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  title="本次问答使用的模型"
                >
                  <option value="">默认模型</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
              <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">Enter 发送 · Esc 停止 · / 快捷指令</span>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                ref={taRef}
                className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
                placeholder="问问题 / 让 AI 起草内容（Enter 发送，/ 唤出快捷指令）…"
                value={input}
                onChange={(e) => { setInput(e.target.value); setSlashDismissed(false); }}
                onKeyDown={onComposerKeyDown}
              />
              {streaming ? (
                <Button variant="danger" onClick={chat.stop} title="停止生成">
                  <Square size={14} /> 停止
                </Button>
              ) : (
                <Button onClick={send} disabled={!input.trim()} title="发送">
                  <Send size={14} /> 发送
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 右侧文档预览 */}
        <div className="relative hidden lg:flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--card)]" style={{ width: previewPanel.width }} data-testid="doc-preview-panel">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整预览宽度"
            tabIndex={0}
            className="split-handle split-handle--overlay"
            onPointerDown={previewPanel.onPointerDown}
            onKeyDown={previewPanel.onKeyDown}
            title="拖拽调整预览宽度（←/→ 微调）"
          />
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{activeDoc?.title || '文档预览'}</span>
            {activeDoc && <Badge tone="blue">v{activeDoc.version}</Badge>}
            {effectiveDocId && (
              <button className="ml-auto text-[11px] text-slate-400 hover:text-teal-600" onClick={() => onOpenFullEditor(effectiveDocId)}>
                编辑 →
              </button>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {activeDoc ? (
              <WritingPreview content={activeDoc.content || ''} editorMode="preview" exported={[]} />
            ) : (
              <Empty illustration="documents" text="还没有文档" hint="在下方对话让 AI 起草，或运行流水线自动成稿" />
            )}
          </div>
        </div>
      </div>

      {/* 窄屏文档预览（lg 以下此前直接消失，768/390 用户看不到产物） */}
      {showPreview && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setShowPreview(false)} aria-hidden="true" />
          <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[520px] max-w-full bg-[var(--card)] border-l border-slate-200 dark:border-slate-800 flex flex-col lg:hidden" role="dialog" aria-modal="true" aria-label="文档预览">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold truncate">{activeDoc?.title || '文档预览'}</span>
              <button className="ml-auto text-[11px] text-slate-400 hover:text-rose-500" onClick={() => setShowPreview(false)} aria-label="关闭预览">关闭</button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {activeDoc ? <WritingPreview content={activeDoc.content || ''} editorMode="preview" exported={[]} /> : <Empty text="暂无文档" />}
            </div>
          </div>
        </>
      )}

      {/* 来源引用 Modal：把知识库片段登记为当前论文引用 */}
      <Modal open={!!citeSource} title="引用到论文" onClose={() => setCiteSource(null)}>
        <div className="space-y-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            来源：<b className="text-slate-700 dark:text-slate-200">{citeSource?.docName}</b>
            {citeSource?.chunkText ? <div className="mt-1.5 max-h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 p-2 text-[11px] leading-relaxed">{citeSource.chunkText}</div> : null}
          </div>
          {docs.length === 0 ? (
            <div className="text-xs text-slate-400">当前项目还没有论文文档，请先在写作页新建。</div>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {docs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={citing}
                  onClick={() => void doCite(d.id)}
                  className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-teal-900/10 transition-colors disabled:opacity-50"
                >
                  {citing && <Loader2 size={11} className="inline animate-spin mr-1" />}
                  <Quote size={11} className="inline mr-1 text-teal-600" /> 引用到「{d.title}」
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* 会话重命名 */}
      <Modal open={!!renamingSession} title="重命名会话" onClose={() => setRenamingSession(null)}>
        <div className="space-y-3">
          <Input
            autoFocus
            value={renamingSession?.title ?? ''}
            onChange={(e) => setRenamingSession((s) => (s ? { ...s, title: e.target.value } : s))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renamingSession?.title.trim()) {
                renameSession(renamingSession.id, renamingSession.title.trim());
                setRenamingSession(null);
              }
            }}
            placeholder="会话名称"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenamingSession(null)}>取消</Button>
            <Button
              onClick={() => {
                if (renamingSession?.title.trim()) {
                  renameSession(renamingSession.id, renamingSession.title.trim());
                  setRenamingSession(null);
                }
              }}
            >
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* 会话删除确认 */}
      <ConfirmDialog
        open={!!deletingSession}
        title="删除会话？"
        description={`将删除本地会话「${deletingSession?.title ?? ''}」及其全部消息。此操作不可撤销。`}
        confirmText="删除"
        danger
        onClose={() => setDeletingSession(null)}
        onConfirm={() => { if (deletingSession) deleteSession(deletingSession.id); setDeletingSession(null); }}
      />
    </div>
  );
}
