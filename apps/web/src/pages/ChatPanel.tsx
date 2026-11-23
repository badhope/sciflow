import { useEffect, useState } from 'react';
import { Bot, ChevronDown, ChevronUp, FileText, Loader2, MessageSquare, Sparkles, Wand2, Languages } from 'lucide-react';
import { api } from '../api/client';
import type { Doc, IntentResult, Project } from '../types';
import { Card } from '../components/ui';
import { AgentChatThread } from '../components/AgentChat';
import { ChatComposer } from '../components/ChatComposer';
import { readChatAttachment } from '../lib/chat-attachments';
import { useChatSession, type ChatAttachment, type ChatMessage } from '../lib/chat-session';
import { applyChatCommand, chatPromptCommands, filterChatCommands, type ChatCommand } from '../lib/chat-commands';
import { useDocumentActions } from '../lib/document-actions';

/** Slash 命令（窄栏精简版） */

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
  const [chatTemplates, setChatTemplates] = useState<ChatCommand[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  useEffect(() => {
    let alive = true;
    api.extensions.chatPrompts().then((r) => { if (alive) setChatTemplates(chatPromptCommands(r.prompts)); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
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
    if ((!text && pendingAttachments.length === 0) || busy) return;
    setInput('');
    setSlashOpen(false);
    chat.send(text || '请阅读附件并总结要点。', { projectId: project.id, docContext: docContext(), attachments: pendingAttachments });
    setPendingAttachments([]);
  };

  const addAttachments = async (files: FileList) => {
    const room = 4 - pendingAttachments.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    const loaded = await Promise.all(picked.map((f) => readChatAttachment(f).catch(() => null)));
    setPendingAttachments((list) => [...list, ...loaded.filter((a): a is ChatAttachment => !!a)].slice(0, 4));
  };

  const slashFiltered = filterChatCommands(input, 'doc', 4, chatTemplates);

  const applySlash = (c: ChatCommand) => {
    setInput(applyChatCommand(c));
    setSlashOpen(false);
  };

  /** 快捷动作走共享 hook：API 调用与 busy/error 不再在页面内重复实现 */
  const actions = useDocumentActions(doc?.id ?? null);
  const actionBusy = actions.busy;

  const startAction = (kind: QuickAction) => {
    setError('');
    void (async () => {
      try {
        if (kind === 'abstract') {
          const r = await actions.abstract();
          onDocUpdated({ abstract: r.abstract });
          chat.append({ role: 'assistant', content: `已生成摘要：\n\n${r.abstract}\n\n关键词：${r.keywords.join('、')}` });
        } else if (kind === 'polish') {
          const r = await actions.polish(doc?.content || '', 'polish');
          onDocUpdated({ content: r.polished });
          chat.append({ role: 'assistant', content: `已润色全文（正文已更新）。\n\n主要修改：${r.reason || '见润色历史'}` });
        } else {
          const r = await actions.translate(doc?.content || '', 'en');
          onDocUpdated({ content: r.translated });
          chat.append({ role: 'assistant', content: '已翻译为英文全文（正文已更新）。' });
        }
      } catch {
        /* actions.error 已更新，页面底部统一展示 */
      }
    })();
  };

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
          <AgentChatThread
            messages={messages}
            streaming={busy}
            className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0"
            onRetry={(i) => chat.retry(i, { projectId: project.id, docContext: docContext() })}
            onContinue={(i) => chat.cont(i, { projectId: project.id, docContext: docContext() })}
            onStop={chat.stop}
            branches={chat.branches}
            onSwitchBranch={chat.switchBranch}
            onEdit={(i, text) => chat.edit(i, text, { projectId: project.id, docContext: docContext() })}
            onDelete={(i) => chat.remove(i)}
          />
          {intent && (
            <div className="px-3 pb-1 shrink-0">
              <div className="text-[11px] bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-md px-2 py-1.5 flex items-center gap-1">
                <Sparkles size={11} /> 意图识别：{intent.label || intent.intent}
              </div>
            </div>
          )}
          {(error || actions.error) && <div className="px-3 pb-1 text-[11px] text-rose-500 shrink-0">{error || actions.error}</div>}
          <div className="border-t border-slate-100 dark:border-slate-800 shrink-0">
            <div className="flex gap-1 px-2 pt-2">
              <button onClick={() => startAction('polish')} disabled={!doc || !!actionBusy} className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50">
                {actionBusy === 'polish' ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />} 润色全文
              </button>
              <button onClick={() => startAction('translate')} disabled={!doc || !!actionBusy} className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50">
                {actionBusy === 'translate' ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />} 翻译全文
              </button>
              <button onClick={() => startAction('abstract')} disabled={!doc || !!actionBusy} className="flex-1 text-[11px] rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-1.5 flex items-center justify-center gap-1 disabled:opacity-50">
                {actionBusy === 'abstract' ? <Loader2 size={11} className="animate-spin" /> : <MessageSquare size={11} />} 生成摘要
              </button>
            </div>
            <ChatComposer
              compact
              value={input}
              onValueChange={(v) => { setInput(v); setSlashOpen(v.startsWith('/')); }}
              onSend={send}
              onStop={chat.stop}
              streaming={busy}
              placeholder={doc ? '问当前论文…（/ 快捷指令）' : '写作问题…'}
              attachments={pendingAttachments}
              onPickFiles={(files) => void addAttachments(files)}
              onRemoveAttachment={(i) => setPendingAttachments((list) => list.filter((_, j) => j !== i))}
              slash={{ open: slashOpen, items: slashFiltered, active: 0, onApply: applySlash }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (slashOpen && slashFiltered.length > 0) applySlash(slashFiltered[0]);
                  else send();
                } else if (e.key === 'Escape') {
                  if (busy) chat.stop();
                  setSlashOpen(false);
                }
              }}
            />
          </div>
        </>
      )}
    </Card>
  );
}
