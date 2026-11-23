import { useRef, type ReactNode, type RefObject, type KeyboardEvent, type ChangeEvent } from 'react';
import { Paperclip, Send, Square, X } from 'lucide-react';
import { CHAT_ATTACHMENT_ACCEPT, CHAT_ATTACHMENT_MAX_FILES } from '../lib/chat-attachments';
import type { ChatCommand } from '../lib/chat-commands';

export interface ComposerAttachment { name: string; mime: string; dataUrl?: string; text?: string }

export interface ChatComposerProps {
  value: string;
  onValueChange: (value: string, caret?: number | null) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
  attachments?: ComposerAttachment[];
  onPickFiles?: (files: FileList) => void;
  onRemoveAttachment?: (index: number) => void;
  slash?: { open: boolean; items: ChatCommand[]; active: number; onApply: (c: ChatCommand) => void };
  toolbar?: ReactNode;
  overlay?: ReactNode;
  /** 需要读取光标做 @ 提及时传入 textarea ref。 */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  testId?: string;
}

/**
 * 聊天输入区唯一实现：附件、slash、移动端不遮挡、停止/发送、错误插槽。
 * Workspace 与写作 ChatPanel 共用；页面只保留各自的工具栏（联网/思考/模型/快捷动作）。
 */
export function ChatComposer({
  value, onValueChange, onSend, onStop, streaming, placeholder = '问问题 / 让 AI 起草内容（Enter 发送，/ 唤出快捷指令）…',
  compact = false, disabled = false, attachments = [], onPickFiles, onRemoveAttachment,
  slash, toolbar, overlay, textareaRef, onKeyDown, testId,
}: ChatComposerProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ref = textareaRef ?? innerRef;
  const canSend = (value.trim() || attachments.length > 0) && !streaming && !disabled;

  const change = (e: ChangeEvent<HTMLTextAreaElement>) => onValueChange(e.target.value, e.target.selectionStart);

  return (
    <div className={`relative ${compact ? 'p-2' : 'p-2.5'} border-t border-slate-100 dark:border-slate-800 shrink-0`} data-testid={testId}>
      {slash?.open && slash.items.length > 0 && (
        <div className="absolute bottom-full left-2 right-2 mb-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--card)] shadow-lg overflow-hidden page-in z-10" role="listbox" aria-label="快捷指令">
          {slash.items.map((c, i) => (
            <button
              key={`${c.name}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => slash.onApply(c)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${i === slash.active ? 'bg-teal-50 dark:bg-teal-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
            >
              <span className={`${compact ? 'text-[11px] w-16' : 'text-xs w-20'} font-semibold text-teal-700 dark:text-teal-300 shrink-0`}>/{c.name}</span>
              <span className="text-[11px] text-slate-400 truncate">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <span key={`${a.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-[11px] text-teal-700 dark:border-teal-800 dark:bg-teal-500/10 dark:text-teal-300">
              <Paperclip size={11} />
              <span className="max-w-[180px] truncate">{a.name}</span>
              {onRemoveAttachment && <button type="button" onClick={() => onRemoveAttachment(i)} className="text-teal-600 hover:text-rose-500 dark:text-teal-400" aria-label={`移除 ${a.name}`}><X size={11} /></button>}
            </span>
          ))}
        </div>
      )}

      {(toolbar || onPickFiles) && (
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          {onPickFiles && (
            <>
              <input ref={fileRef} type="file" multiple accept={CHAT_ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => { if (e.target.files?.length) onPickFiles(e.target.files); e.currentTarget.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={streaming || attachments.length >= CHAT_ATTACHMENT_MAX_FILES}
                className="flex items-center gap-1 text-[11px] rounded-md px-1.5 py-1 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 disabled:opacity-40"
                title="上传 PDF、Office、EPUB、音视频或图片（最多 4 个）">
                <Paperclip size={12} /> 附件{attachments.length ? ` · ${attachments.length}` : ''}
              </button>
            </>
          )}
          {toolbar}
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {overlay}
        <textarea
          rows={compact ? 1 : 2}
          ref={ref}
          data-testid={testId ? `${testId}-textarea` : undefined}
          className={`flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-700 ${compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'} bg-white dark:bg-slate-900 outline-none focus:border-teal-500`}
          placeholder={placeholder}
          value={value}
          onChange={change}
          onKeyDown={onKeyDown}
          aria-label="聊天输入"
        />
        {streaming ? (
          <button type="button" onClick={onStop} className={`rounded-lg bg-rose-500 hover:bg-rose-600 text-white ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`} title="停止生成（Esc）"><Square size={compact ? 12 : 14} /></button>
        ) : (
          <button type="button" onClick={onSend} disabled={!canSend} className={`rounded-lg bubble-user hover:brightness-110 ${compact ? 'px-2 py-1.5' : 'px-3 py-2'} disabled:opacity-50`} title="发送"><Send size={compact ? 12 : 14} /></button>
        )}
      </div>
    </div>
  );
}
