import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from '../api/client';
import { applyStreamDelta } from '../api/stream-accumulator';
import type { ChatSource } from '../types';

export interface ChatAttachment {
  name: string;
  mime: string;
  /** base64（不含 data: 前缀），用于本轮重发/重试 */
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 用户消息的附件；只在当前轮发送，历史轮不重传 */
  attachments?: ChatAttachment[];
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
  /** Agent 工具调用记录（本轮模型检索文献/查知识库的步骤，供气泡内展示） */
  toolCalls?: {
    /** 服务端 tool_call id，用于把 tool_call 与 tool_result 对齐 */
    id?: string;
    name: string;
    arguments?: string;
    /** 执行状态：running=已发起；done/error/denied=已有结果 */
    status?: 'running' | 'done' | 'error' | 'denied';
    /** 工具返回正文（服务端截断后的预览） */
    result?: string;
    /** 返回正文的原始字符数（用于提示“已截断”） */
    resultChars?: number;
    durationMs?: number;
    error?: string;
  }[];
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
  attachments?: ChatAttachment[];
  /** 当前会话 ID（服务端完整会话落库） */
  sessionId?: string;
  /** 当前会话标题（服务端首轮摘要落库用） */
  sessionTitle?: string;
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
  // StrictMode 开发模式会「挂载→清理→再挂载」：清理置 false 后必须在重新挂载时复位 true，
  // 否则 onDone/onError 全被吞掉，界面永远停在「正在生成…」（本次浏览器实测复现）。
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.();
      abortRef.current = null;
    };
  }, []);

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
      if ((!trimmed && !(o.attachments?.length)) || streaming) return;
      opts.onSend?.(trimmed);
      const history = (o.baseMessages ?? messages).filter((m) => !m.streaming);
      const userMsg: ChatMessage = { role: 'user', content: o.displayText ?? trimmed, createdAt: Date.now(), attachments: o.attachments };
      setMessages([...history, userMsg, { role: 'assistant', content: '', streaming: true, createdAt: Date.now(), model: o.model }]);
      setStreaming(true);

      const docContext = [o.docContext, o.sessionContext ? `历史会话背景（用户主动引用）：${o.sessionContext}` : '']
        .filter(Boolean)
        .join('\n\n') || undefined;

      abortRef.current = streamChat({
        message: o.messageSuffix ? `${trimmed}${o.messageSuffix}` : trimmed,
        attachments: o.attachments,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        projectId: o.projectId,
        docContext,
        webSearch: o.webSearch || undefined,
        model: o.model,
        enableThinking: o.enableThinking,
        sessionId: o.sessionId,
        sessionTitle: o.sessionTitle,
        onDelta: (full) => patchLast((m) => ({ content: applyStreamDelta({ content: m.content, reasoning: m.reasoning ?? '' }, { content: full }).content })),
        onReasoning: (full) => patchLast((m) => ({ reasoning: applyStreamDelta({ content: m.content, reasoning: m.reasoning ?? '' }, { reasoning: full }).reasoning })),
        onSources: (src) => patchLast({ sources: src }),
        onUsage: (u) => patchLast({ usage: u }),
        onToolCall: (call) => patchLast((m) => ({
          toolCalls: [
            ...(m.toolCalls || []),
            { id: call.id, name: call.name, arguments: call.arguments, status: 'running' },
          ],
        })),
        onToolResult: (result) => patchLast((m) => {
          const calls = [...(m.toolCalls || [])];
          let index = -1;
          if (result.id) {
            index = calls.findIndex((c) => c.id === result.id && c.status === 'running');
          }
          if (index < 0) {
            // 兼容服务端个别事件不带 id 的情况：按工具名回填最近一条仍在运行的记录
            for (let i = calls.length - 1; i >= 0; i -= 1) {
              if (calls[i].name === result.name && calls[i].status === 'running') {
                index = i;
                break;
              }
            }
          }
          const patch: NonNullable<ChatMessage['toolCalls']>[number] = {
            id: result.id,
            name: result.name,
            status: result.status === 'ok' ? 'done' : result.status,
            result: result.output,
            resultChars: result.outputChars,
            durationMs: result.durationMs,
            error: result.error,
          };
          if (index >= 0) {
            calls[index] = { ...calls[index], ...patch, arguments: calls[index].arguments };
          } else {
            // 没收到 tool_call 事件时也把结果留下，不能因为事件乱序把结果丢掉
            calls.push(patch);
          }
          return { toolCalls: calls };
        }),
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
    send(userText, { ...o, attachments: messages[userIndex]?.attachments, baseMessages: messages.slice(0, userIndex) });
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
    // 编辑用户消息 = 从该点重新分支：丢弃该消息之后的所有回答，保留原附件。
    send(nextText, { ...o, attachments: messages[userIndex]?.attachments, baseMessages: messages.slice(0, userIndex) });
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
