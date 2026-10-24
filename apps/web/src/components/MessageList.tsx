import { useState, type ReactNode } from 'react';
import { Streamdown } from 'streamdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Brain, Check, Copy, FileText, Loader2, PlayCircle, Quote, RotateCcw, Square, Trash2, Wrench } from 'lucide-react';
import type { ChatMessage } from '../lib/chat-session';
import { IconButton } from './ui';

/** 助手消息正文（Markdown + 公式 + 流式光标）：三个聊天入口共用同一渲染契约 */
function AssistantBody({ m }: { m: ChatMessage }) {
  return (
    <div className="markdown-body text-[14px] leading-relaxed text-slate-700 dark:text-slate-200">
      {m.toolCalls && m.toolCalls.length > 0 ? (
        <details className="mb-2" open={m.streaming}>
          <summary className="cursor-pointer select-none list-none text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Wrench size={12} aria-hidden="true" /> 工具调用 · {m.toolCalls.length} 次{m.streaming ? '（进行中）' : ''}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {m.toolCalls.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <Check size={11} className="mt-0.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <span className="font-mono">{t.name}</span>
                {t.arguments && t.arguments !== '{}' ? (
                  <span className="truncate text-slate-400 dark:text-slate-500">{t.arguments.slice(0, 120)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {m.reasoning ? (
        <details open={m.streaming} className="mb-2">
          <summary className="cursor-pointer select-none list-none text-[11px] font-medium text-teal-700 dark:text-teal-300 flex items-center gap-1">
            <Brain size={12} aria-hidden="true" /> 思考过程{m.streaming ? '（进行中）' : ` · ${m.reasoning.length} 字`}
          </summary>
          <div
            data-testid="assistant-reasoning"
            className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-teal-300 pl-2.5 text-xs leading-relaxed text-slate-500 dark:border-teal-700 dark:text-slate-400"
          >
            {m.reasoning}
          </div>
        </details>
      ) : null}
      {m.content ? (
        <Streamdown mode={m.streaming ? 'streaming' : 'static'} remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
          {m.content}
        </Streamdown>
      ) : m.streaming ? (
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Loader2 size={12} className="animate-spin" /> 正在生成…
        </span>
      ) : null}
      {m.streaming && m.content && <span className="pulse-dot ml-0.5 inline-block h-4 w-1.5 bg-current align-middle opacity-60" />}
      {m.stopped && !m.streaming && <div className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">已停止生成</div>}
      {m.error && !m.streaming && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          回答失败：{m.error}
        </div>
      )}
    </div>
  );
}

type Source = NonNullable<ChatMessage['sources']>[number];

/** 来源卡（可展开原文 / 引用进草稿） */
function Sources({ sources, onCite }: { sources: NonNullable<ChatMessage['sources']>; onCite?: (s: Source) => void }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <div className="mt-2 space-y-1.5">
      {sources.map((s, i) => {
        // score 契约：后端统一 0-100（知识库命中为 RRF 百分制，联网来源占位 0）；
        // 旧实现用 `score > 1 ? score : score*100` 猜量纲，低相关命中（≤1 分）会被放大 100 倍。
        const pct = Math.round(Math.min(100, Math.max(0, s.score)));
        const hasChunk = !!(s.chunkText && s.chunkText.trim());
        return (
          <div key={i}>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-teal-700 dark:border-teal-800 dark:bg-teal-500/10 dark:text-teal-300">
                <FileText size={10} aria-hidden="true" /> {s.docName}
                {pct > 0 ? ` · ${pct}%` : ''}
              </span>
              {hasChunk && (
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} className="text-teal-600 hover:underline dark:text-teal-400">
                  {open[i] ? '收起原文' : '展开原文'}
                </button>
              )}
              {onCite && s.referenceId && (
                <button type="button" onClick={() => onCite(s)} className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-teal-700">
                  <Quote size={10} /> 引用
                </button>
              )}
            </div>
            {open[i] && hasChunk && (
              <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-[var(--card)] px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300">
                {s.chunkText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface MessageListProps {
  messages: ChatMessage[];
  streaming?: boolean;
  /** 消息级操作（不传则该入口不支持对应操作） */
  onCopy?: (index: number) => void;
  onRetry?: (index: number) => void;
  /** 停止后「继续生成」（不传则退化为 onRetry 的整题重试） */
  onContinue?: (index: number) => void;
  onStop?: () => void;
  onDelete?: (index: number) => void;
  onCite?: (s: Source) => void;
  onSendToWriting?: (index: number) => void;
  /** 后续追问建议点击（科研问答页；点击即以该问题续发） */
  onFollowUp?: (text: string, assistantIndex: number) => void;
  /** 空态（消息为空时渲染） */
  empty?: ReactNode;
  /** 用户气泡样式：气泡 / 平铺 */
  userBubble?: 'bubble' | 'plain';
  className?: string;
}

/**
 * 统一的对话消息列表
 *
 * 三处入口（工作台 / 科研问答 / 写作抽屉）此前各写一套，导致
 * 「抽屉没有来源卡」「停止后没有已停止标记」等能力漂移。这里只保留一份渲染。
 */
export function MessageList({
  messages,
  streaming,
  onCopy,
  onRetry,
  onContinue,
  onStop,
  onDelete,
  onCite,
  onSendToWriting,
  onFollowUp,
  empty,
  userBubble = 'bubble',
  className = '',
}: MessageListProps) {
  const [copied, setCopied] = useState<number | null>(null);

  const handleCopy = (i: number) => {
    onCopy?.(i);
    setCopied(i);
    window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1400);
  };

  if (!messages.length && empty) return <>{empty}</>;

  return (
    <div className={`space-y-3 ${className}`}>
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={`${i}-user`} className="group flex justify-end">
            <div className="min-w-0 max-w-[88%]">
              {userBubble === 'bubble' ? (
                <div data-testid="user-message" className="bubble-user whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed">{m.content}</div>
              ) : (
                <div className="whitespace-pre-wrap break-words rounded-xl bg-teal-600/10 px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 dark:bg-teal-400/10 dark:text-slate-100">
                  {m.content}
                </div>
              )}
              <div className="mt-1 flex items-center justify-end gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
                {onCopy && (
                  <IconButton
                    size={28}
                    label="复制提问"
                    icon={copied === i ? <Check size={12} className="text-teal-600" /> : <Copy size={12} />}
                    onClick={() => handleCopy(i)}
                  />
                )}
                {onDelete && <IconButton size={28} tone="danger" label="删除提问" icon={<Trash2 size={12} />} onClick={() => onDelete(i)} />}
              </div>
            </div>
          </div>
        ) : (
          <div key={`${i}-assistant`} className="group min-w-0" data-testid="assistant-message">
            <AssistantBody m={m} />
            {m.sources && m.sources.length > 0 && <Sources sources={m.sources} onCite={onCite} />}
            {m.usage && !m.streaming && (
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                {m.model && <span className="max-w-[120px] truncate">{m.model}</span>}
                <span>
                  ↑{m.usage.prompt_tokens} ↓{m.usage.completion_tokens} tokens
                </span>
              </div>
            )}
            {m.followUps && m.followUps.length > 0 && !m.streaming && onFollowUp && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.followUps.map((f, fi) => (
                  <button
                    key={fi}
                    type="button"
                    onClick={() => onFollowUp(f, i)}
                    className="rounded-full border border-slate-200 bg-[var(--card)] px-2.5 py-1 text-left text-[11px] text-slate-500 hover:border-teal-400 hover:text-teal-600 dark:border-slate-700 dark:text-slate-400 dark:hover:text-teal-300"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
            {!m.streaming && (
              <div className="mt-1 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
                {/* 问候语（前面没有用户提问）不渲染操作条：重试/删除在内核里本就是 no-op */}
                {m.stopped && (onContinue || onRetry) && (
                  <IconButton size={28} label="继续生成" icon={<PlayCircle size={12} />} onClick={() => (onContinue ? onContinue(i) : onRetry?.(i))} />
                )}
                {onRetry && i > 0 && messages[i - 1]?.role === 'user' && (
                  <IconButton size={28} label="重新生成" icon={<RotateCcw size={12} />} onClick={() => onRetry(i)} />
                )}
                {onCopy && (
                  <IconButton
                    size={28}
                    label="复制回答"
                    icon={copied === i ? <Check size={12} className="text-teal-600" /> : <Copy size={12} />}
                    onClick={() => handleCopy(i)}
                  />
                )}
                {onSendToWriting && <IconButton size={28} label="发送到写作页" icon={<FileText size={12} />} onClick={() => onSendToWriting(i)} />}
                {onDelete && <IconButton size={28} tone="danger" label="删除回答" icon={<Trash2 size={12} />} onClick={() => onDelete(i)} />}
              </div>
            )}
          </div>
        ),
      )}
      {streaming && onStop && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-[var(--card)] px-3 py-1.5 text-xs text-slate-600 hover:border-rose-300 hover:text-rose-600 dark:border-slate-700 dark:text-slate-300"
          >
            <Square size={11} /> 停止生成
          </button>
        </div>
      )}
    </div>
  );
}
