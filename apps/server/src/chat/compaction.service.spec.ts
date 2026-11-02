import { describe, expect, it } from 'vitest';
import { CompactionService } from './compaction.service';
import type { ChatMessage } from '../ai/ai.service';

/**
 * 上下文压缩的行为回归。
 *
 * 存在原因：对话历史无限增长会把早期指令挤出上下文窗口，模型开始"忘记"
 * 用户最初的要求。压缩必须真的减少字符数、必须保留最近轮次、且不能编造
 * 原文里没有的内容。
 */

const svc = new CompactionService();

function turn(user: string, assistant: string): ChatMessage[] {
  return [
    { role: 'user', content: user } as ChatMessage,
    { role: 'assistant', content: assistant } as ChatMessage,
  ];
}

describe('CompactionService', () => {
  it('短历史不压缩，原样返回', () => {
    const history = turn('问题一', '回答一');
    const r = svc.compact(history);
    expect(r.compacted).toBe(false);
    expect(r.messages).toBe(history);
    expect(r.afterChars).toBe(r.beforeChars);
  });

  it('超长历史触发压缩且字符数下降', () => {
    const big = 'x'.repeat(20_000);
    const history = [
      ...turn(big, big),
      ...turn(big, big),
      ...turn('最近的问题', '最近的回答'),
    ];
    const r = svc.compact(history);
    expect(r.compacted).toBe(true);
    expect(r.afterChars).toBeLessThan(r.beforeChars);
    expect(r.droppedTurns).toBeGreaterThan(0);
  });

  it('压缩后保留最近轮次原文', () => {
    const big = 'y'.repeat(20_000);
    const history = [...turn(big, big), ...turn(big, big), ...turn('最近的独特问题', '最近的独特回答')];
    const r = svc.compact(history);
    const texts = r.messages.map((m) => String(m.content));
    expect(texts.some((t) => t.includes('最近的独特问题'))).toBe(true);
    expect(texts.some((t) => t.includes('最近的独特回答'))).toBe(true);
  });

  it('摘要消息标注为压缩内容，模型可区分摘要与原文', () => {
    const big = 'z'.repeat(20_000);
    const history = [...turn(big, big), ...turn(big, big), ...turn('最新问题', '最新回答')];
    const r = svc.compact(history);
    const summary = r.messages[0];
    expect(summary.role).toBe('system');
    expect(String(summary.content)).toContain('压缩摘要');
  });

  it('needsCompaction 与实际压缩判断一致', () => {
    const small = turn('短', '短');
    expect(svc.needsCompaction(small)).toBe(false);
    const huge = [...turn('w'.repeat(30_000), 'w'.repeat(30_000))];
    expect(svc.needsCompaction(huge)).toBe(true);
  });

  it('单条超长消息被截断而不是整段丢弃', () => {
    const history = [{ role: 'user', content: 'a'.repeat(60_000) } as ChatMessage];
    const r = svc.compact(history);
    expect(r.compacted).toBe(true);
    expect(r.messages).toHaveLength(1);
    expect(String(r.messages[0].content)).toContain('已截断');
  });
});
