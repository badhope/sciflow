import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, FileText, Loader2, MessageSquare, Send, Sparkles, Square, Wand2, Languages } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, IntentResult, Project } from '../types';
import { Card } from '../components/ui';
import { MessageList } from '../components/MessageList';
import { useChatSession, type ChatMessage } from '../lib/chat-session';
import { useAsyncAction } from '../lib/async';

/** Slash 命令（窄栏精简版） */
const SLASH_COMMANDS: { name: string; desc: string; template: string }[] = [
  { name: '润色', desc: '提升学术表达', template: '请润色以下内容，提升学术表达质量：\n\n{{input}}' },
  { name: '翻译英文', desc: '译为学术英文', template: '请将以下内容翻译为地道的学术英文：\n\n{{input}}' },
  { name: '生成摘要', desc: '要点与关键词', template: '请为以下内容生成摘要与关键词：\n\n{{input}}' },
  { name: '降重', desc: '改写降重', template: '请改写以下内容以降低重复率：\n\n{{input}}' },
  { name: '补充引用', desc: '建议相关文献', template: '请针对以下内容建议可引用的文献并说明理由：\n\n{{input}}' },
];

type QuickAction = 'polish' | 'translate' | 'abstract';

/**
 * 内联 AI 助手（写作页右侧面板）
 * 全程贯通当前论文：问答自动注入当前文档的标题/大纲/正文上下文；
 * 快捷动作：润色全文 / 翻译 / 生成摘要，结果直接回写当前文档；
 * 对话内核走 useChatSession（三处聊天入口共用），快捷动作走 useAsyncAction（三态防重复提交）。
 */
export function ChatPanel({
  project,
  doc,
  onDocUpdated,
}: {
  project: Project;
  doc: Doc | null;
  onDocUpdated: (patch: { content?: string; abstract?: string }) => void;
}) {
  const [open, setOpen] = useState(true);
  const [error, setError] = useState('');
  const chat = useChatSession({
    initialMessages: [
      { role: 'assistant', content: `我是写作助手，已关联当前论文「${doc?.title || '未命名'}」。可以问我写作、逻辑、修改建议，或点下方快捷动作。输入 "/" 唤出快捷指令。` },
    ],
    /** 每次发起问答（含重试）旁路做意图识别 */
    onSend: (text) => {
      if (doc) api.judgment.intent(text, doc.title).then(setIntent).catch(() => undefined);
    },
    onError: (msg) => setError(msg),
  });
  const messages: ChatMessage[] = chat.messages;
  const busy = chat.streaming;
  const [intent, setIntent] = useState<IntentResult | null>(null);
  const [input, setInput] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  /** 当前文档上下文（标题+大纲+正文摘要） */
  const docContext = () => {
    if (!doc) return undefined;
    let outline = '';
    try {
      const o = JSON.parse(doc.outline || '[]');
      outline = Array.isArray(o.sections) ? o.sections.map((s: { title: string }) => s.title).join(' / ') : '';
    } catch {
      outline = '';
    }
    return `标题：${doc.title}\n大纲：${outline || '（未设置）'}\n正文：${(doc.content || '').replace(/[#*`>]/g, '').slice(0, 2200)}`;
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setSlashOpen(false);
    chat.send(text, { projectId: project.id, docContext: docContext() });
  };

  const copyMsg = async (i: number) => {
    try {
      await navigator.clipboard.writeText(messages[i].content);
    } catch {
      /* ignore */
    }
  };

  const slashFiltered = input.startsWith('/') ? SLASH_COMMANDS.filter((c) => c.name.includes(input.slice(1))).slice(0, 4) : [];

  const applySlash = (c: (typeof SLASH_COMMANDS)[number]) => {
    setInput(c.template.replace('{{input}}', ''));
    setSlashOpen(false);
  };

  /** 快捷动作三态（running/error 统一管理，失败不再静默） */
  const [actionKind, setActionKind] = useState<QuickAction | ''>('');
  const runAction = useAsyncAction(
    async (kind: QuickAction) => {
      if (!doc) return;
      if (kind === 'abstract') {
        const r = await api.documents.abstract(doc.id);
        onDocUpdated({ abstract: r.abstract });
        chat.append({ role: 'assistant', content: `已生成摘要：\n\n${r.abstract}\n\n关键词：${r.keywords.join('、')}` });
      } else if (kind === 'polish') {
        const r = await api.documents.polish(doc.id, doc.content || '', 'polish');
        onDocUpdated({ content: r.polished });
        chat.append({ role: 'assistant', content: `已润色全文（正文已更新）。\n\n主要修改：${r.reason || '见润色历史'}` });
      } else {
        const r = await api.documents.translate(doc.id, doc.content || '', 'en');
        onDocUpdated({ content: r.translated });
        chat.append({ role: 'assistant', content: '已翻译为英文全文（正文已更新）。' });
      }
    },
    { onError: (message) => setError(message) },
  );

  const startAction = (kind: QuickAction) => {
    setError('');
    setActionKind(kind);
    void runAction.run(kind);
  };

  const actionBusy = runAction.running ? actionKind : '';

  return (
    <Card className={`w-full md:w-72 shrink-0 flex flex-col min-h-0 ${open ? '' : 'w-10 cursor-pointer'} transition-all`}>
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 dark:border-slate-800 cursor-pointer shrink-0"
        onClick={() => setOpen((v) => !v)}
      >
        <Bot size={14} className="text-teal-600 dark:text-teal-300" />
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex-1">AI 写作助手</span>
        {open ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronUp size={13} className="text-slate-400" />}
      </div>
      {open && (
        <>
          {doc && (
            <div className="px-3 py-1.5 text-[11px] text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 flex items-center gap-1 shrink-0">
              <FileText size={11} /> 已关联：<span className="truncate">{doc.title}</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
            <MessageList
              messages={messages}
              streaming={busy}
              onCopy={(i) => void copyMsg(i)}
              onRetry={(i) => chat.retry(i, { projectId: project.id, docContext: docContext() })}
              onContinue={(i) => chat.cont(i, { projectId: project.id, docContext: docContext() })}
              onStop={chat.stop}
              userBubble="plain"
            />
            <div ref={bottomRef} />
          </div>
          {intent && (
            <div className="px-3 pb-1 shrink-0">
              <div className="text-[11px] bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-md px-2 py-1.5 flex items-center gap-1">
                <Sparkles size={11} /> 意图识别：{intent.label || intent.intent}
              </div>
            </div>
          )}
          {error && <div className="px-3 pb-1 text-[11px] text-rose-500 shrink-0">{error}</div>}
          <div className="p-2 border-t border-slate-100 dark:border-slate-800 shrink-0 relative">
            {/* Slash 下拉（窄栏） */}
            {slashOpen && slashFiltered.length > 0 && (
              <div className="absolute bottom-full left-2 right-2 mb-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden page-in z-10">
                {slashFiltered.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => applySlash(c)}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-500/10 flex items-center gap-2"
                  >
                    <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-300 w-16 shrink-0">/{c.name}</span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-1 mb-1.5">
              <button
                onClick={() => startAction('polish')}
                disabled={!doc || !!actionBusy}
                className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {actionBusy === 'polish' ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} 润色全文
              </button>
              <button
                onClick={() => startAction('translate')}
                disabled={!doc || !!actionBusy}
                className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {actionBusy === 'translate' ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />} 翻译全文
              </button>
              <button
                onClick={() => startAction('abstract')}
                disabled={!doc || !!actionBusy}
                className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                {actionBusy === 'abstract' ? <Loader2 size={11} className="animate-spin" /> : <MessageSquare size={11} />} 生成摘要
              </button>
            </div>
            <div className="flex gap-1.5">
              <input
                className="flex-1 min-w-0 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-teal-500 placeholder:text-slate-400"
                placeholder={doc ? '问当前论文…（/ 快捷指令）' : '写作问题…'}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setSlashOpen(e.target.value.startsWith('/'));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (slashOpen && slashFiltered.length > 0) applySlash(slashFiltered[0]);
                    else send();
                  } else if (e.key === 'Escape') {
                    if (busy) chat.stop();
                    setSlashOpen(false);
                  }
                }}
              />
              {busy ? (
                <button
                  onClick={() => chat.stop()}
                  className="rounded-md bg-rose-500 hover:bg-rose-600 text-white px-2 py-1.5"
                  title="停止生成（Esc）"
                >
                  <Square size={12} />
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={busy || !input.trim()}
                  className="rounded-md bubble-user hover:brightness-110 px-2 py-1.5 disabled:opacity-50"
                  title="发送"
                >
                  <Send size={12} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
