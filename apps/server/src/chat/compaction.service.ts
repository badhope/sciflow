/**
 * 上下文压缩服务（harness 能力）。
 *
 * 对标 OpenCode / Claude Code 的自动压缩：当对话历史超过预算时，把早期轮次
 * 归纳成一段结构化摘要，只保留最近若干轮原文，从而在不丢关键信息的前提下
 * 把上下文压回预算内。
 *
 * 与 `ChatSessionService` 的分工：
 *  - ChatSessionService 是**跨会话**记忆（上一轮对话结束后写摘要，下次开新对话注入）；
 *  - 本服务是**单次会话内**的压缩（历史太长、还没结束就要压）。
 *
 * 压缩策略：
 *  1. 预算按字符估算（不用 tokenizer，避免引入重依赖；4 字符≈1 token 的保守估计）；
 *  2. 保留最近 N 轮原文（越近越重要）；
 *  3. 更早的轮次按「用户问什么 / 助手答什么要点」抽取，而不是让模型自由发挥——
 *     自由摘要会丢数字和结论，抽取式更可控；
 *  4. 压缩结果带明确标记，模型知道这是摘要而非原文。
 */

import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage } from '../ai/ai.service';
import { envInt } from '../common/env';

/** 触发压缩的历史字符阈值（默认 24000 字符 ≈ 6k token） */
const COMPACT_THRESHOLD = envInt('CHAT_COMPACT_THRESHOLD', 24_000, { min: 4_000, max: 400_000 });

/** 压缩后保留的最近轮次（一问一答算一轮） */
const KEEP_RECENT_TURNS = envInt('CHAT_COMPACT_KEEP_TURNS', 4, { min: 1, max: 20 });

/** 单条摘要行长度上限 */
const DIGEST_LINE_MAX = 240;

export interface CompactionResult {
  /** 压缩后的消息数组（含注入的摘要消息） */
  messages: ChatMessage[];
  /** 是否真的发生了压缩 */
  compacted: boolean;
  /** 压缩前字符数 */
  beforeChars: number;
  /** 压缩后字符数 */
  afterChars: number;
  /** 被归纳的轮次数 */
  droppedTurns: number;
}

function messageText(m: ChatMessage): string {
  const c = (m as { content?: unknown }).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        const p = part as { type?: string; text?: string };
        return p?.type === 'text' && typeof p.text === 'string' ? p.text : '';
      })
      .join('');
  }
  return '';
}

/** 抽取式摘要：保留首句与关键句，不编造内容 */
function digest(text: string, max = DIGEST_LINE_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  // 优先在句末切分，避免把句子截断在中间
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('.'), cut.lastIndexOf('；'), cut.lastIndexOf(';'));
  return lastStop > max * 0.5 ? `${cut.slice(0, lastStop + 1)}…` : `${cut}…`;
}

@Injectable()
export class CompactionService {
  private readonly logger = new Logger(CompactionService.name);

  /** 历史是否需要压缩 */
  needsCompaction(history: ChatMessage[]): boolean {
    return this.totalChars(history) > COMPACT_THRESHOLD;
  }

  private totalChars(messages: ChatMessage[]): number {
    return messages.reduce((sum, m) => sum + messageText(m).length, 0);
  }

  /**
   * 压缩历史。
   * 未超阈值时原样返回（compacted=false），调用方无需分支判断。
   */
  compact(history: ChatMessage[]): CompactionResult {
    const beforeChars = this.totalChars(history);
    if (beforeChars <= COMPACT_THRESHOLD) {
      return { messages: history, compacted: false, beforeChars, afterChars: beforeChars, droppedTurns: 0 };
    }

    // 保留最近若干轮，但最多保留一半：否则轮次不足 KEEP_RECENT_TURNS 时
    // 永远找不到边界，压缩就退化成"只截断最后一条"，早期内容仍然撑满窗口。
    const userTurns = history.filter((m) => m.role === 'user').length;
    const keepTurns = Math.max(1, Math.min(KEEP_RECENT_TURNS, Math.floor(userTurns / 2)));
    const keepFrom = this.findKeepBoundary(history, keepTurns);
    const older = history.slice(0, keepFrom);
    const recent = history.slice(keepFrom);

    if (older.length === 0) {
      // 只有一轮但极长：截断该轮，保留尾部（结论通常在末尾）
      const last = history[history.length - 1];
      const text = messageText(last);
      const trimmed: ChatMessage = { ...last, content: `…（前文过长已截断）…\n${text.slice(-COMPACT_THRESHOLD / 2)}` } as ChatMessage;
      const messages = [...history.slice(0, -1), trimmed];
      return {
        messages,
        compacted: true,
        beforeChars,
        afterChars: this.totalChars(messages),
        droppedTurns: 0,
      };
    }

    const digestLines: string[] = [];
    let droppedTurns = 0;
    for (const m of older) {
      const text = messageText(m);
      if (!text.trim()) continue;
      if (m.role === 'user') {
        droppedTurns += 1;
        digestLines.push(`- 用户提问：${digest(text)}`);
      } else if (m.role === 'assistant') {
        digestLines.push(`  助手回答要点：${digest(text)}`);
      }
    }

    const summaryMessage: ChatMessage = {
      role: 'system',
      content: [
        '以下是本次对话早前轮次的压缩摘要（原始内容已省略以节省上下文）。',
        '摘要保留了提问意图与回答要点；如需精确原文，请让用户重新提供。',
        '',
        ...digestLines,
      ].join('\n'),
    } as ChatMessage;

    const messages = [summaryMessage, ...recent];
    const afterChars = this.totalChars(messages);
    this.logger.log(`[compact] ${beforeChars} → ${afterChars} 字符，归纳 ${droppedTurns} 轮`);
    return { messages, compacted: true, beforeChars, afterChars, droppedTurns };
  }

  /** 从末尾往前数 keepTurns 个 user 消息，返回其下标（作为保留起点） */
  private findKeepBoundary(history: ChatMessage[], keepTurns: number): number {
    let seen = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].role === 'user') {
        seen += 1;
        if (seen === keepTurns) return i;
      }
    }
    return 0;
  }
}
