import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { MessageList } from './MessageList';
import type { ChatMessage } from '../lib/chat-session';

/** 消息区共用能力：滚动到底、复制、空状态/页头/页脚插槽。 */
export interface AgentChatThreadProps {
  messages: ChatMessage[];
  streaming: boolean;
  className?: string;
  testId?: string;
  /** 外部滚动容器；不传时用内部锚点滚动。 */
  containerRef?: RefObject<HTMLDivElement | null>;
  empty?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  /** 消息之后的页面私有内容（如流水线运行卡）。 */
  children?: ReactNode;
  onRetry?: (index: number) => void;
  onContinue?: (index: number) => void;
  onStop?: () => void;
  onDelete?: (index: number) => void;
  onEdit?: (index: number, nextText: string) => void;
  branches?: Record<string, import('../lib/chat-branch').BranchMeta>;
  onSwitchBranch?: (messageId: string, direction: -1 | 1) => void;
  onCite?: (source: NonNullable<ChatMessage['sources']>[number]) => void;
  onSendToWriting?: (index: number) => void;
  onFollowUp?: (followUp: string, index: number) => void;
}

/**
 * 聊天消息区（Workspace / 写作助手共用）。
 *
 * 只负责「消息怎么排、怎么滚、怎么复制」，不持有输入框、slash、会话侧栏等页面私有状态。
 * 这样两个入口的流式渲染/停止/来源卡契约保持一致，页面仍可保留自己的输入区差异。
 */
export function AgentChatThread({
  messages,
  streaming,
  className = 'flex-1 overflow-y-auto p-3.5 space-y-3',
  testId,
  containerRef,
  empty,
  header,
  footer,
  children,
  onRetry,
  onContinue,
  onStop,
  onDelete,
  onEdit,
  branches,
  onSwitchBranch,
  onCite,
  onSendToWriting,
  onFollowUp,
}: AgentChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef?.current;
    if (el) {
      requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
      return;
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming, containerRef]);

  const copy = async (index: number) => {
    try {
      await navigator.clipboard.writeText(messages[index]?.content ?? '');
    } catch {
      /* 剪贴板不可用（http 非安全上下文等）：静默失败不打断对话 */
    }
  };

  return (
    <div ref={containerRef} data-testid={testId} className={className}>
      {messages.length === 0 && empty}
      {header}
      <MessageList
        messages={messages}
        streaming={streaming}
        onCopy={(i) => void copy(i)}
        onRetry={(i) => onRetry?.(i)}
        onContinue={(i) => onContinue?.(i)}
        onStop={onStop}
        onDelete={onDelete}
        onEdit={onEdit}
        branches={branches}
        onSwitchBranch={onSwitchBranch}
        onCite={onCite}
        onSendToWriting={onSendToWriting}
        onFollowUp={onFollowUp}
        userBubble="plain"
      />
      {footer}
      {children}
      <div ref={endRef} />
    </div>
  );
}
