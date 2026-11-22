/**
 * 对话会话服务（完整会话 + 滚动摘要）
 *
 * 对标 Cursor "长上下文对话摘要注入" 与 Claude "Contextual Retrieval"：
 *  - 完整消息落 chat_session.messages_json，换设备/清缓存不丢会话
 *  - 每轮对话结束时用 LLM 归纳摘要，新对话启动时注入最近 N 轮摘要
 *  - 置顶/归档/跨会话搜索都在同一个会话表上完成，不另建历史记录模块
 */

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, like, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { chatSessions } from '../db/schema';
import { AiService } from '../ai/ai.service';
import type { ChatMessage } from '../ai/ai.service';

/** 会话消息的持久化形态：保留前端消息的展示/分支字段，不依赖 UI 类型。 */
export interface StoredChatMessage {
  id?: string;
  parentId?: string;
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
  reasoning?: string;
  sources?: unknown[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  followUps?: string[];
  stopped?: boolean;
  error?: string;
  model?: string;
  createdAt?: number;
  attachments?: { name: string; mime: string; data: string }[];
  toolCalls?: unknown[];
  [key: string]: unknown;
}

/** 分支状态：A2 会在消息节点 id/parentId 上扩展 activeLeafId。 */
export interface ChatSessionBranchState {
  activeLeafId?: string;
  [key: string]: unknown;
}

export interface ChatSessionInput {
  id?: string;
  title?: string;
  messages?: StoredChatMessage[];
  branch?: ChatSessionBranchState;
  summary?: string;
}

export interface ChatSessionListItem {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  messageCount: number;
  totalTokens: number;
  pinned: boolean;
  archived: boolean;
  lastMessageAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionDetail extends ChatSessionListItem {
  messages: StoredChatMessage[];
  branch: ChatSessionBranchState;
}

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);
  /** 注入上下文时最多携带的轮次数 */
  private static readonly INJECT_LIMIT = 5;
  /** 摘要最大字数 */
  private static readonly SUMMARY_MAX_LEN = 500;
  /** 单会话持久化上限 2MB；超限时保留最近消息，摘要仍可回看 */
  private static readonly MAX_MESSAGES_BYTES = 2_000_000;

  /** 列出项目最近会话摘要（摘要注入用；包含旧摘要行和完整会话行） */
  listSummaries(projectId: string, limit = ChatSessionService.INJECT_LIMIT) {
    return db.select().from(chatSessions).where(eq(chatSessions.projectId, projectId)).orderBy(desc(chatSessions.createdAt)).limit(limit).all();
  }

  /**
   * 列出项目会话（默认不含归档；summary_only 旧摘要行不作为可打开会话）。
   * q 同时搜标题、摘要和完整消息 JSON，满足跨会话全文搜索。
   */
  listConversations(
    projectId: string,
    opts: { q?: string; includeArchived?: boolean; limit?: number } = {},
  ): ChatSessionListItem[] {
    const where = [eq(chatSessions.projectId, projectId), eq(chatSessions.summaryOnly, 0)];
    if (!opts.includeArchived) where.push(eq(chatSessions.archived, 0));
    const q = (opts.q || '').trim();
    if (q) {
      const pattern = `%${q}%`;
      where.push(or(
        like(chatSessions.title, pattern),
        like(chatSessions.summary, pattern),
        like(chatSessions.messagesJson, pattern),
      )!);
    }
    const rows = db.select()
      .from(chatSessions)
      .where(and(...where))
      .orderBy(desc(chatSessions.pinned), desc(chatSessions.lastMessageAt), desc(chatSessions.updatedAt))
      .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
      .all();
    return rows.map((row) => this.toListItem(row));
  }

  /** 读取单个完整会话；跨项目/旧摘要行一律 404。 */
  getConversation(projectId: string, id: string): ChatSessionDetail {
    const row = db.select().from(chatSessions)
      .where(and(eq(chatSessions.projectId, projectId), eq(chatSessions.id, id)))
      .get();
    if (!row || row.summaryOnly) throw new NotFoundException('会话不存在');
    return this.toDetail(row);
  }

  /** 创建会话；前端可带本地生成的 id，便于 localStorage 迁移幂等。 */
  createConversation(projectId: string, input: ChatSessionInput = {}): ChatSessionDetail {
    const now = Date.now();
    const id = input.id || randomUUID();
    const existing = db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
    if (existing) {
      if (existing.projectId !== projectId) throw new NotFoundException('会话不存在');
      return this.toDetail(existing);
    }
    const messages = this.normalizeMessages(input.messages ?? []);
    const serialized = this.serializeMessages(messages);
    const title = this.cleanTitle(input.title) || this.deriveTitle(messages);
    db.insert(chatSessions).values({
      id,
      projectId,
      title,
      summary: input.summary || '',
      messagesJson: serialized,
      branchJson: JSON.stringify(input.branch ?? {}),
      messageCount: messages.filter((m) => m.role !== 'system').length,
      totalTokens: this.sumTokens(messages),
      pinned: 0,
      archived: 0,
      lastMessageAt: messages.length ? (messages[messages.length - 1].createdAt ?? now) : null,
      source: 'cloud',
      summaryOnly: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.getConversation(projectId, id);
  }

  /**
   * 保存完整会话（幂等 upsert）。前端每次消息变更同步；id 不存在时按 create 处理。
   * 不覆盖 summary（摘要由 recordSummary 异步更新），避免前端把旧摘要写回去。
   */
  saveConversation(projectId: string, id: string, input: ChatSessionInput): ChatSessionDetail {
    const existing = db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
    if (existing && existing.projectId !== projectId) throw new NotFoundException('会话不存在');
    if (!existing) return this.createConversation(projectId, { ...input, id });

    const messages = this.normalizeMessages(input.messages ?? this.parseMessages(existing.messagesJson));
    const serialized = this.serializeMessages(messages);
    const now = Date.now();
    const title = this.cleanTitle(input.title) || existing.title || this.deriveTitle(messages);
    db.update(chatSessions).set({
      title,
      messagesJson: serialized,
      branchJson: JSON.stringify(input.branch ?? this.parseJsonObject(existing.branchJson)),
      messageCount: messages.filter((m) => m.role !== 'system').length,
      totalTokens: this.sumTokens(messages) || existing.totalTokens,
      lastMessageAt: messages.length ? (messages[messages.length - 1].createdAt ?? now) : existing.lastMessageAt,
      updatedAt: now,
    }).where(eq(chatSessions.id, id)).run();
    return this.getConversation(projectId, id);
  }

  /** 局部更新：标题/置顶/归档/摘要；PATCH 接口只暴露这些低频操作。 */
  patchConversation(
    projectId: string,
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean; summary?: string },
  ): ChatSessionDetail {
    const existing = db.select().from(chatSessions)
      .where(and(eq(chatSessions.projectId, projectId), eq(chatSessions.id, id)))
      .get();
    if (!existing || existing.summaryOnly) throw new NotFoundException('会话不存在');
    const set: Partial<typeof chatSessions.$inferInsert> = { updatedAt: Date.now() };
    if (patch.title !== undefined) set.title = this.cleanTitle(patch.title) || existing.title;
    if (patch.pinned !== undefined) set.pinned = patch.pinned ? 1 : 0;
    if (patch.archived !== undefined) set.archived = patch.archived ? 1 : 0;
    if (patch.summary !== undefined) set.summary = String(patch.summary).slice(0, ChatSessionService.SUMMARY_MAX_LEN);
    db.update(chatSessions).set(set).where(eq(chatSessions.id, id)).run();
    return this.getConversation(projectId, id);
  }

  /** 删除会话；旧摘要行也允许删除（不参与可打开会话，但可在摘要区清理）。 */
  deleteConversation(projectId: string, id: string): void {
    const existing = db.select().from(chatSessions)
      .where(and(eq(chatSessions.projectId, projectId), eq(chatSessions.id, id)))
      .get();
    if (!existing) throw new NotFoundException('会话不存在');
    db.delete(chatSessions).where(eq(chatSessions.id, id)).run();
  }

  /**
   * 为新对话注入历史摘要（仅当 history 为空时调用）：
   * 取最近 N 轮摘要，按时间正序组装为一段系统级上下文。
   */
  injectPastSummary(projectId: string): string {
    const rows = this.listSummaries(projectId);
    if (!rows.length) return '';
    return [
      '以下是你在该项目中最近几次对话的摘要（回答时请结合这些历史上下文；若与当前问题无关，可忽略）：',
      ...rows.reverse().map((r, i) => `[对话${i + 1}] ${r.summary || '（无摘要）'}`),
      '---',
    ].join('\n');
  }

  /**
   * 异步记录本轮对话摘要（fire-and-forget）。
   * 带 sessionId 时更新现有会话；不带时创建 legacy 摘要行（兼容旧调用方）。
   */
  async recordSummary(
    projectId: string,
    messages: ChatMessage[],
    totalTokens: number,
    sessionId?: string,
    title?: string,
  ): Promise<void> {
    if (messages.length < 2) return; // 至少一轮问答才有记录价值
    try {
      const dialogueText = messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content.slice(0, 600)}`)
        .join('\n');
      const summaryPrompt = `请用中文简要归纳以下科研问答对话的关键信息（研究问题、结论、决定），控制在 ${ChatSessionService.SUMMARY_MAX_LEN} 字内：\n\n${dialogueText.slice(0, 4000)}`;
      let summary = '';
      try {
        summary = await this.ai.complete([{ role: 'user', content: summaryPrompt }], {
          temperature: 0.3,
          maxTokens: 300,
          model: 'fast',
          context: 'chatSessionSummary',
        });
        summary = summary.trim().slice(0, ChatSessionService.SUMMARY_MAX_LEN);
      } catch (e: any) {
        // LLM 失败时降级为截取首条用户消息 + AI 首句
        summary = messages.find((m) => m.role === 'user')?.content?.slice(0, 200) || '';
        this.logger.warn(`会话摘要 LLM 生成失败，降级为截断: ${e?.message || e}`);
      }
      const now = Date.now();
      const msgCount = messages.filter((m) => m.role !== 'system').length;
      if (sessionId) {
        const existing = db.select().from(chatSessions)
          .where(and(eq(chatSessions.projectId, projectId), eq(chatSessions.id, sessionId)))
          .get();
        if (existing && !existing.summaryOnly) {
          db.update(chatSessions).set({
            summary,
            messageCount: msgCount,
            totalTokens: totalTokens || 0,
            title: this.cleanTitle(title) || existing.title,
            messagesJson: this.serializeMessages(this.normalizeMessages(messages as StoredChatMessage[])),
            lastMessageAt: now,
            updatedAt: now,
          }).where(eq(chatSessions.id, sessionId)).run();
          return;
        }
      }
      db.insert(chatSessions).values({
        id: sessionId || randomUUID(),
        projectId,
        title: this.cleanTitle(title) || this.deriveTitle(messages as StoredChatMessage[]),
        summary,
        messagesJson: sessionId ? this.serializeMessages(this.normalizeMessages(messages as StoredChatMessage[])) : '[]',
        branchJson: '{}',
        messageCount: msgCount,
        totalTokens: totalTokens || 0,
        pinned: 0,
        archived: 0,
        lastMessageAt: sessionId ? now : null,
        source: sessionId ? 'cloud' : 'legacy-summary',
        summaryOnly: sessionId ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      }).run();
    } catch (e: any) {
      this.logger.warn(`记录会话摘要失败: ${e?.message || e}`);
    }
  }

  constructor(private readonly ai: AiService) {}

  private toListItem(row: typeof chatSessions.$inferSelect): ChatSessionListItem {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title || '新对话',
      summary: row.summary || '',
      messageCount: row.messageCount,
      totalTokens: row.totalTokens,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      lastMessageAt: row.lastMessageAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toDetail(row: typeof chatSessions.$inferSelect): ChatSessionDetail {
    return {
      ...this.toListItem(row),
      messages: this.parseMessages(row.messagesJson),
      branch: this.parseJsonObject(row.branchJson),
    };
  }

  private parseMessages(raw: string | null | undefined): StoredChatMessage[] {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === 'string' && typeof m.role === 'string') : [];
    } catch {
      return [];
    }
  }

  private parseJsonObject(raw: string | null | undefined): ChatSessionBranchState {
    try {
      const parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private cleanTitle(title: string | undefined): string {
    return String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  private deriveTitle(messages: StoredChatMessage[]): string {
    const first = messages.find((m) => m.role === 'user');
    const raw = String(first?.content || '').replace(/\s+/g, ' ').trim();
    return raw ? raw.slice(0, 28) : '新对话';
  }

  private normalizeMessages(messages: StoredChatMessage[]): StoredChatMessage[] {
    return messages
      .filter((m) => m && typeof m.content === 'string' && typeof m.role === 'string')
      .map((m) => ({ ...m, content: m.content.slice(0, 20_000) }));
  }

  private serializeMessages(messages: StoredChatMessage[]): string {
    let current = messages;
    let json = JSON.stringify(current);
    // 超限时保留最近消息，避免一次同步把 SQLite 写爆；旧内容仍可由 summary 召回。
    while (Buffer.byteLength(json, 'utf8') > ChatSessionService.MAX_MESSAGES_BYTES && current.length > 2) {
      current = current.slice(Math.ceil(current.length / 4));
      json = JSON.stringify(current);
    }
    if (Buffer.byteLength(json, 'utf8') > ChatSessionService.MAX_MESSAGES_BYTES) {
      throw new BadRequestException('单个会话消息过大，请新建会话后继续');
    }
    return json;
  }

  private sumTokens(messages: StoredChatMessage[]): number {
    return messages.reduce((sum, m) => sum + (Number(m.usage?.total_tokens) || 0), 0);
  }
}
