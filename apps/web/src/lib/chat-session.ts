import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from '../api/client';
import { applyStreamDelta } from '../api/stream-accumulator';
import type { ChatSource } from '../types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  sources?: ChatSource[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  streaming?: boolean;
  stopped?: boolean;
  error?: string;
  model?: string;
  createdAt?: number;
  /** 本地会话 id（会话持久化用） */
  id?: string;
  /** 后续追问建议（科研问答页：模型按 FOLLOWUP_HINT 约定输出） */
  followUps?: string[];
}

/** 追加到请求 message 末尾的固定指令：诱导模型给出后续追问建议（不进入气泡显示） */
export const FOLLOWUP_HINT =
  '\n\n（若方便，请在回答末尾用单独一行 "---FOLLOWUPS---" 开头，随后给出 2-3 个简短的后续追问建议，每行一个。）';

/** 从模型全文中解析 ---FOLLOWUPS--- 段：正文与追问建议分离 */
export function parseFollowUps(full: string): { content: string; followUps: string[] } {
  const idx = full.indexOf('---FOLLOWUPS---');
  if (idx === -1) return { content: full, followUps: [] };
  return {
    content: full.slice(0, idx).trimEnd(),
    followUps: full
      .slice(idx + '---FOLLOWUPS---'.length)
      .trim()
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

export interface SendOptions {
  /** 当前项目 */
  projectId: string;
  /** 附加文档上下文（工作台/写作抽屉） */
  docContext?: string;
  /** 历史会话背景（工作台引用摘要） */
  sessionContext?: string;
  /** 本轮是否联网 */
  webSearch?: boolean;
  model?: string;
  enableThinking?: boolean;
  /** 覆盖发送前的 messages（重试/继续时传入截断后的历史） */
  baseMessages?: ChatMessage[];
  /** 覆盖用户消息文本（继续生成时是固定指令，不显示为普通提问） */
  displayText?: string;
  /** 追加到请求 message 末尾的固定指令（科研问答页的 FOLLOWUP_HINT），不进入气泡显示 */
  messageSuffix?: string;
}

/**
 * 统一聊天内核（工作台 / 科研问答 / 写作抽屉共用）
 *
 * 历史问题：三处各写一套 streamChat 回调，能力不一致（抽屉没有来源卡、
 * 停止后不置 stopped、错误只写进正文），且累积语义容易写成字符串追加。
 * 这里强制：
 *  - 累积回调一律走 applyStreamDelta 覆盖语义
 *  - abort 一定把最后一条置 stopped 并保留已收文本
 *  - 任何错误落到 message.error（可重试）而不是拼进正文
 *  - 发送/重试/续写统一触发 onSend（意图识别等旁路）与流式后的 doneTransform
 */
export function useChatSession(opts: {
  initialMessages: ChatMessage[];
  /** 消息变化通知（用于 localStorage / 会话持久化） */
  onMessagesChange?: (messages: ChatMessage[]) => void;
  onError?: (message: string) => void;
  /** 每次发起请求前回调（发送/重试/续写统一走这里；意图识别等旁路动作） */
  onSend?: (text: string) => void;
  /** 流式结束后的正文加工（followUps 解析等），返回 patch 合并进该条助手消息 */
  doneTransform?: (fullText: string) => Partial<ChatMessage>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(opts.initialMessages);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const changeRef = useRef(opts.onMessagesChange);
  useEffect(() => {
    changeRef.current = opts.onMessagesChange;
  }, [opts.onMessagesChange]);

  // 卸载即中止流：mountedRef 只能抑制 setState，SSE 连接要显式 abort（否则切页后请求继续读到服务端结束）
  useEffect(
    () => () => {
      mountedRef.current = false;
      abortRef.current?.();
      abortRef.current = null;
    },
    [],
  );

  // 持久化（跳过纯流式瞬态）
  useEffect(() => {
    if (messages.some((m) => m.streaming)) return;
    changeRef.current?.(messages);
  }, [messages]);

  const patchLast = useCallback((patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
    setMessages((ms) => {
      if (!ms.length) return ms;
      const last = ms[ms.length - 1];
      return ms.map((m, i) => (i === ms.length - 1 ? { ...m, ...(typeof patch === 'function' ? patch(last) : patch) } : m));
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    patchLast((m) => ({ streaming: false, stopped: true, content: m.content }));
  }, [patchLast]);

  const send = useCallback(
    (text: string, o: SendOptions) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      opts.onSend?.(trimmed);
      const history = (o.baseMessages ?? messages).filter((m) => !m.streaming);
      const userMsg: ChatMessage = { role: 'user', content: o.displayText ?? trimmed, createdAt: Date.now() };
      setMessages([...history, userMsg, { role: 'assistant', content: '', streaming: true, createdAt: Date.now(), model: o.model }]);
      setStreaming(true);

      const docContext = [o.docContext, o.sessionContext ? `历史会话背景（用户主动引用）：${o.sessionContext}` : '']
        .filter(Boolean)
        .join('\n\n') || undefined;

      abortRef.current = streamChat({
        message: o.messageSuffix ? `${trimmed}${o.messageSuffix}` : trimmed,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        projectId: o.projectId,
        docContext,
        webSearch: o.webSearch || undefined,
        model: o.model,
        enableThinking: o.enableThinking,
        onDelta: (full) => patchLast((m) => ({ content: applyStreamDelta({ content: m.content, reasoning: m.reasoning ?? '' }, { content: full }).content })),
        onReasoning: (full) => patchLast((m) => ({ reasoning: applyStreamDelta({ content: m.content, reasoning: m.reasoning ?? '' }, { reasoning: full }).reasoning })),
        onSources: (src) => patchLast({ sources: src }),
        onUsage: (u) => patchLast({ usage: u }),
        onToolCall: () => undefined,
        onDone: (full) => {
          if (!mountedRef.current) return;
          setStreaming(false);
          patchLast({ streaming: false, ...(opts.doneTransform ? opts.doneTransform(full) : {}) });
          abortRef.current = null;
        },
        onError: (msg) => {
          if (!mountedRef.current) return;
          setStreaming(false);
          patchLast((m) => ({ streaming: false, error: msg, stopped: true, content: m.content }));
          abortRef.current = null;
          opts.onError?.(msg);
        },
      });
    },
    [messages, patchLast, opts, streaming],
  );

  const retry = useCallback((assistantIndex: number, o: SendOptions) => {
    if (streaming) return;
    const userIndex = assistantIndex - 1;
    if (userIndex < 0) return;
    const userText = messages[userIndex]?.content ?? '';
    send(userText, { ...o, baseMessages: messages.slice(0, userIndex) });
  }, [messages, send, streaming]);

  /** 断点续写：把已收的部分回答作为历史带入，显式要求接着写（「继续生成」按钮；空内容时退化为重试） */
  const cont = useCallback(
    (assistantIndex: number, o: SendOptions) => {
      if (streaming) return;
      const partial = messages[assistantIndex];
      if (!partial || !partial.content.trim()) {
        retry(assistantIndex, o);
        return;
      }
      const history = messages.slice(0, assistantIndex + 1).filter((m) => !m.streaming);
      send('请从上文断点处继续输出，不要重复已有内容，直接接着写。', { ...o, baseMessages: history, displayText: '（继续生成）' });
    },
    [messages, retry, send, streaming],
  );

  const edit = useCallback((userIndex: number, nextText: string, o: SendOptions) => {
    if (streaming || !nextText.trim()) return;
    send(nextText, { ...o, baseMessages: messages.slice(0, userIndex) });
  }, [messages, send, streaming]);

  const remove = useCallback((index: number) => {
    setMessages((ms) => ms.filter((_, i) => i !== index));
  }, []);

  const reset = useCallback((next: ChatMessage[]) => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    setMessages(next);
  }, []);

  const append = useCallback((m: ChatMessage) => setMessages((ms) => [...ms, m]), []);

  return { messages, setMessages, send, stop, retry, cont, edit, remove, reset, append, streaming, patchLast };
}
