import type { ChatSource } from '../../types';

/** 一条对话消息（本地会话存储的持久化形态；与内核 ChatMessage 对齐但去掉瞬态字段） */
export interface StoredMessage {
  /** 会话内稳定消息 id（A2 分支树用；旧数据可空） */
  id?: string;
  /** 父消息 id（A2 分支树用；根为空） */
  parentId?: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  sources?: ChatSource[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  followUps?: string[];
  stopped?: boolean;
  error?: string;
  model?: string;
  createdAt?: number;
  attachments?: { name: string; mime: string; data: string }[];
  toolCalls?: unknown[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
  /** 服务端会话置顶/归档；本地旧数据默认 false */
  pinned?: boolean;
  archived?: boolean;
  /** 服务端消息数（列表未取完整消息时用于判断是否需要拉详情） */
  messageCount?: number;
}

const KEY = (projectId: string) => `sciflow.chat.sessions.${projectId}`;
const ACTIVE_KEY = (projectId: string) => `sciflow.chat.active.${projectId}`;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** 从首条用户消息派生会话标题（去换行、截断） */
export function deriveTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  const raw = (firstUser?.content || '').replace(/\s+/g, ' ').trim();
  return raw ? raw.slice(0, 28) : '新对话';
}

export function loadSessions(projectId: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(KEY(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveSessions(projectId: string, sessions: ChatSession[]): void {
  try {
    // 只保留最近 50 个会话，避免 localStorage 无界增长
    const trimmed = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
    localStorage.setItem(KEY(projectId), JSON.stringify(trimmed));
  } catch {
    /* 隐私模式 / 配额满：静默降级为纯内存会话 */
  }
}

export function loadActiveSessionId(projectId: string): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY(projectId));
  } catch {
    return null;
  }
}

export function saveActiveSessionId(projectId: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY(projectId), id);
    else localStorage.removeItem(ACTIVE_KEY(projectId));
  } catch {
    /* ignore */
  }
}

export function createSession(): ChatSession {
  const now = Date.now();
  return { id: newId(), title: '新对话', createdAt: now, updatedAt: now, messages: [] };
}

/** 输入草稿（按项目+会话隔离，切页/刷新后恢复） */
export function loadDraft(projectId: string, sessionId: string): string {
  try {
    return localStorage.getItem(`sciflow.chat.draft.${projectId}.${sessionId}`) || '';
  } catch {
    return '';
  }
}

export function saveDraft(projectId: string, sessionId: string, text: string): void {
  try {
    const key = `sciflow.chat.draft.${projectId}.${sessionId}`;
    if (text) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
