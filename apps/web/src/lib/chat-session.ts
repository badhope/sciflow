import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamChat } from '../api/client';
import { applyStreamDelta } from '../api/stream-accumulator';
import type { ChatSource } from '../types';
import {
  bestLeaf,
  branchMeta,
  branchState,
  newMessageId,
  normalizeMessageTree,
  pathToLeaf,
  removeSubtree,
  switchBranchTarget,
  type BranchMeta,
} from './chat-branch';

export interface ChatAttachment {
  name: string;
  mime: string;
  /** base64（不含 data: 前缀），用于本轮重发/重试 */
  data: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 分支树节点 id；旧消息由 normalizeMessageTree 补齐 */
  id?: string;
  /** 父节点 id；根消息为 null */
  parentId?: string | null;
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

interface StartStreamArgs {
  /** 发给 API 的本轮问题 */
  text: string;
  /** 本轮之前的可见历史（不含本轮节点） */
  history: ChatMessage[];
  /** 正在流式写入的助手节点 id */
  assistantId: string;
  options: SendOptions;
}

/**
 * 统一聊天内核（工作台 / 科研问答 / 写作抽屉共用）
 *
 * 分支语义：内部保存节点平铺数组，`messages` 只返回 activeLeaf 到根的一条路径；
 * 编辑用户消息/重新生成都追加 sibling，旧分支不丢；切换只移动 activeLeaf。
 */
export function useChatSession(opts: {
  initialMessages: ChatMessage[];
  /** 从服务端恢复的分支叶子 */
  initialLeafId?: string | null;
  /** 全部节点 + activeLeaf 变化通知（用于 localStorage / 服务端会话持久化） */
  onMessagesChange?: (messages: ChatMessage[], activeLeafId: string | null) => void;
  onError?: (message: string) => void;
  /** 每次发起请求前回调（发送/重试/续写统一走这里；意图识别等旁路动作） */
  onSend?: (text: string) => void;
  /** 流式结束后的正文加工（followUps 解析等），返回 patch 合并进该条助手消息 */
  doneTransform?: (fullText: string) => Partial<ChatMessage>;
}) {
  const initial = useMemo(
    () => normalizeMessageTree(opts.initialMessages, opts.initialLeafId ?? null),
    // 只在挂载时归一化一次；后续 reset 显式重建树。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [allMessages, setAllMessages] = useState<ChatMessage[]>(initial.items);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(initial.leafId);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const streamingRef = useRef(false);
  const allRef = useRef(allMessages);
  const leafRef = useRef(activeLeafId);
  const changeRef = useRef(opts.onMessagesChange);
  const optsRef = useRef(opts);
  const messages = useMemo(() => pathToLeaf(allMessages, activeLeafId), [allMessages, activeLeafId]);

  useEffect(() => {
    allRef.current = allMessages;
  }, [allMessages]);
  useEffect(() => {
    leafRef.current = activeLeafId;
  }, [activeLeafId]);
  useEffect(() => {
    changeRef.current = opts.onMessagesChange;
    optsRef.current = opts;
  }, [opts]);

  // 卸载即中止流：mountedRef 只能抑制 setState，SSE 连接要显式 abort（否则切页后请求继续读到服务端结束）
  // StrictMode 开发模式会「挂载→清理→再挂载」：清理置 false 后必须在重新挂载时复位 true，
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.();
      abortRef.current = null;
    };
  }, []);

  // 持久化（跳过纯流式瞬态）；分支切换也要落 activeLeaf
  useEffect(() => {
    if (allMessages.some((m) => m.streaming)) return;
    changeRef.current?.(allMessages, activeLeafId);
  }, [allMessages, activeLeafId]);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
    setAllMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));
  }, []);

  /** 兼容旧调用：修当前 activeLeaf（流式时就是正在生成的助手节点）。 */
  const patchLast = useCallback((patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
    const id = leafRef.current;
    if (id) patchMessage(id, patch);
  }, [patchMessage]);

  const startStream = useCallback(({ text, history, assistantId, options }: StartStreamArgs) => {
    const o = options;
    const docContext = [o.docContext, o.sessionContext ? `历史会话背景（用户主动引用）：${o.sessionContext}` : '']
      .filter(Boolean)
      .join('\n\n') || undefined;
    const streamHistory = history.filter((m) => !m.streaming).map((m) => ({ role: m.role, content: m.content }));
    try {
      abortRef.current = streamChat({
        message: o.messageSuffix ? `${text}${o.messageSuffix}` : text,
        attachments: o.attachments,
        history: streamHistory,
        projectId: o.projectId,
        docContext,
        webSearch: o.webSearch || undefined,
        model: o.model,
        enableThinking: o.enableThinking,
        sessionId: o.sessionId,
        sessionTitle: o.sessionTitle,
        onDelta: (full) => patchMessage(assistantId, (m) => ({ content: applyStreamDelta({ content: m.content, reasoning: m.reasoning ?? '' }, { content: full }).content })),
        onReasoning: (full) => patchMessage(assistantId, (m) => ({ reasoning: applyStreamDelta({ content: m.content, reasoning: m.reasoning ?? '' }, { reasoning: full }).reasoning })),
        onSources: (src) => patchMessage(assistantId, { sources: src }),
        onUsage: (u) => patchMessage(assistantId, { usage: u }),
        onToolCall: (call) => patchMessage(assistantId, (m) => ({
          toolCalls: [
            ...(m.toolCalls || []),
            { id: call.id, name: call.name, arguments: call.arguments, status: 'running' },
          ],
        })),
        onToolResult: (result) => patchMessage(assistantId, (m) => {
          const calls = [...(m.toolCalls || [])];
          let index = -1;
          if (result.id) index = calls.findIndex((c) => c.id === result.id && c.status === 'running');
          if (index < 0) {
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
          if (index >= 0) calls[index] = { ...calls[index], ...patch, arguments: calls[index].arguments };
          else calls.push(patch);
          return { toolCalls: calls };
        }),
        onDone: (full) => {
          if (!mountedRef.current) return;
          streamingRef.current = false;
          setStreaming(false);
          patchMessage(assistantId, { streaming: false, ...(optsRef.current.doneTransform ? optsRef.current.doneTransform(full) : {}) });
          abortRef.current = null;
        },
        onError: (msg) => {
          if (!mountedRef.current) return;
          streamingRef.current = false;
          setStreaming(false);
          patchMessage(assistantId, (m) => ({ streaming: false, error: msg, stopped: true, content: m.content }));
          abortRef.current = null;
          optsRef.current.onError?.(msg);
        },
      });
    } catch (e) {
      streamingRef.current = false;
      setStreaming(false);
      const msg = e instanceof Error ? e.message : String(e);
      patchMessage(assistantId, { streaming: false, error: msg, stopped: true });
      optsRef.current.onError?.(msg);
    }
  }, [patchMessage]);

  const send = useCallback((text: string, o: SendOptions) => {
    const trimmed = text.trim();
    if ((!trimmed && !(o.attachments?.length)) || streamingRef.current) return;
    optsRef.current.onSend?.(trimmed);
    const base = o.baseMessages ?? pathToLeaf(allRef.current, leafRef.current);
    const history = base.filter((m) => !m.streaming);
    const parentId = history[history.length - 1]?.id ?? null;
    const now = Date.now();
    const userMsg: ChatMessage = {
      id: newMessageId('u'),
      parentId,
      role: 'user',
      content: o.displayText ?? trimmed,
      createdAt: now,
      attachments: o.attachments,
    };
    const assistantMsg: ChatMessage = {
      id: newMessageId('a'),
      parentId: userMsg.id!,
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: now + 1,
      model: o.model,
    };
    setAllMessages((ms) => [...ms, userMsg, assistantMsg]);
    setActiveLeafId(assistantMsg.id!);
    streamingRef.current = true;
    setStreaming(true);
    startStream({ text: trimmed, history, assistantId: assistantMsg.id!, options: o });
  }, [startStream]);

  const stop = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
    const id = leafRef.current;
    if (id) patchMessage(id, (m) => ({ streaming: false, stopped: true, content: m.content }));
  }, [patchMessage]);

  const retry = useCallback((assistantIndex: number, o: SendOptions) => {
    if (streamingRef.current) return;
    const visible = pathToLeaf(allRef.current, leafRef.current);
    const target = visible[assistantIndex];
    const question = visible[assistantIndex - 1];
    if (!target || target.role !== 'assistant' || !question || question.role !== 'user') return;
    const parentId = question.id ?? null;
    const history = pathToLeaf(allRef.current, question.parentId ?? null);
    const assistantMsg: ChatMessage = {
      id: newMessageId('a'),
      parentId,
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: Date.now(),
      model: o.model,
    };
    setAllMessages((ms) => [...ms, assistantMsg]);
    setActiveLeafId(assistantMsg.id!);
    streamingRef.current = true;
    setStreaming(true);
    startStream({ text: question.content, history, assistantId: assistantMsg.id!, options: { ...o, attachments: question.attachments } });
  }, [startStream]);

  /** 断点续写：把已收的部分回答作为历史带入，显式要求接着写（「继续生成」按钮；空内容时退化为重试） */
  const cont = useCallback(
    (assistantIndex: number, o: SendOptions) => {
      if (streamingRef.current) return;
      const visible = pathToLeaf(allRef.current, leafRef.current);
      const partial = visible[assistantIndex];
      if (!partial || !partial.content.trim()) {
        retry(assistantIndex, o);
        return;
      }
      const history = visible.slice(0, assistantIndex + 1).filter((m) => !m.streaming);
      send('请从上文断点处继续输出，不要重复已有内容，直接接着写。', { ...o, baseMessages: history, displayText: '（继续生成）' });
    },
    [retry, send],
  );

  const edit = useCallback((userIndex: number, nextText: string, o: SendOptions) => {
    if (streamingRef.current || !nextText.trim()) return;
    const visible = pathToLeaf(allRef.current, leafRef.current);
    const original = visible[userIndex];
    if (!original || original.role !== 'user') return;
    const parentId = original.parentId ?? null;
    const history = pathToLeaf(allRef.current, parentId);
    const now = Date.now();
    const userMsg: ChatMessage = {
      id: newMessageId('u'),
      parentId,
      role: 'user',
      content: nextText.trim(),
      createdAt: now,
      attachments: original.attachments,
    };
    const assistantMsg: ChatMessage = {
      id: newMessageId('a'),
      parentId: userMsg.id!,
      role: 'assistant',
      content: '',
      streaming: true,
      createdAt: now + 1,
      model: o.model,
    };
    setAllMessages((ms) => [...ms, userMsg, assistantMsg]);
    setActiveLeafId(assistantMsg.id!);
    streamingRef.current = true;
    setStreaming(true);
    startStream({ text: nextText.trim(), history, assistantId: assistantMsg.id!, options: { ...o, attachments: original.attachments } });
  }, [startStream]);

  const remove = useCallback((index: number) => {
    const visible = pathToLeaf(allRef.current, leafRef.current);
    const node = visible[index];
    if (!node?.id) return;
    const remaining = removeSubtree(allRef.current, node.id);
    const fallback = node.parentId
      ? bestLeaf(remaining, node.parentId)
      : (remaining[remaining.length - 1]?.id ?? null);
    setAllMessages(remaining);
    setActiveLeafId(fallback);
    // 同步 refs，避免同一 tick 内连续操作看到旧树。
    allRef.current = remaining;
    leafRef.current = fallback;
  }, []);

  const reset = useCallback((next: ChatMessage[], leafId?: string | null) => {
    abortRef.current?.();
    abortRef.current = null;
    streamingRef.current = false;
    setStreaming(false);
    const normalized = normalizeMessageTree(next, leafId ?? null);
    setAllMessages(normalized.items);
    setActiveLeafId(normalized.leafId);
    allRef.current = normalized.items;
    leafRef.current = normalized.leafId;
  }, []);

  const append = useCallback((m: ChatMessage) => {
    const parentId = leafRef.current;
    const node: ChatMessage = {
      ...m,
      id: m.id || newMessageId(m.role === 'user' ? 'u' : 'a'),
      parentId: m.parentId ?? parentId,
      createdAt: m.createdAt ?? Date.now(),
    };
    setAllMessages((ms) => [...ms, node]);
    setActiveLeafId(node.id!);
    allRef.current = [...allRef.current, node];
    leafRef.current = node.id!;
  }, []);

  /** 当前消息的版本数/序号（用于消息下方“1/3”切换器）。 */
  const branches = useMemo(() => branchMeta(allMessages) as Record<string, BranchMeta>, [allMessages]);

  const switchBranch = useCallback((messageId: string, direction: -1 | 1) => {
    const target = switchBranchTarget(allRef.current, messageId, direction);
    if (!target) return;
    setActiveLeafId(target);
    leafRef.current = target;
  }, []);

  const branch = useMemo(() => branchState(activeLeafId), [activeLeafId]);

  return {
    messages,
    allMessages,
    activeLeafId,
    branch,
    branches,
    send,
    stop,
    retry,
    cont,
    edit,
    remove,
    reset,
    append,
    switchBranch,
    streaming,
    patchLast,
  };
}
