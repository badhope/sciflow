import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * ChatSessionService 集成测试 —— 真实 in-memory SQLite + mock AiService。
 */

import { db } from '../db/database';
import { chatSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ChatSessionService } from './chat-session.service';

const TEST_PROJECT = 'test-proj-session-001';

describe('ChatSessionService', () => {
  let svc: ChatSessionService;

  beforeEach(() => {
    db.delete(chatSessions).where(eq(chatSessions.projectId, TEST_PROJECT)).run();
  });

  afterEach(() => {
    db.delete(chatSessions).where(eq(chatSessions.projectId, TEST_PROJECT)).run();
  });

  it('injectPastSummary 无历史时应返回空字符串', () => {
    svc = new ChatSessionService({ complete: async () => '' } as any);
    expect(svc.injectPastSummary(TEST_PROJECT)).toBe('');
  });

  it('injectPastSummary 有历史时应返回拼接的上下文', () => {
    const aiComplete = vi.fn(async () => '摘要A');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    // 插入一条历史
    db.insert(chatSessions).values({ id: 'h1', projectId: TEST_PROJECT, summary: '上次讨论了 CNN', messageCount: 4, totalTokens: 500, createdAt: Date.now() - 1000, updatedAt: Date.now() - 1000 }).run();
    const ctx = svc.injectPastSummary(TEST_PROJECT);
    expect(ctx).toContain('CNN');
    expect(ctx).toContain('对话');
  });

  it('recordSummary 对消息数 < 2 的会话应直接跳过', async () => {
    const aiComplete = vi.fn(async () => '摘要');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [{ role: 'user', content: 'hi' }], 10);
    expect(aiComplete).not.toHaveBeenCalled();
  });

  it('recordSummary 成功 LLM 调用应写入 summary 到 DB', async () => {
    const aiComplete = vi.fn(async () => '研究问题：X方法对比。结论：Y效果最优。');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'user', content: '请帮我查文献' },
      { role: 'assistant', content: '好的，我帮你检索了...' },
    ], 200);
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows.length).toBe(1);
    expect(rows[0].summary).toContain('X方法对比');
    expect(rows[0].totalTokens).toBe(200);
  });

  it('recordSummary 应将 system 消息排除在 messageCount 与 prompt 之外', async () => {
    const aiComplete = vi.fn(async () => '摘要内容');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'system', content: '你是科研助手' },
      { role: 'user', content: '查文献' },
      { role: 'assistant', content: '已检索' },
    ], 150);
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows.length).toBe(1);
    expect(aiComplete.mock.calls[0][0][0].content).not.toContain('你是科研助手');
    expect(rows[0].messageCount).toBe(2);
  });

  it('recordSummary LLM 失败时应 fallback 截取首条 user 内容', async () => {
    const aiComplete = vi.fn(async () => { throw new Error('LLM 不可用'); });
    svc = new ChatSessionService({ complete: aiComplete } as any);
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'user', content: '关于深度学习的文献调研' },
      { role: 'assistant', content: '检索完成' },
    ], 120);
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows.length).toBe(1);
    expect(rows[0].summary).toContain('深度学习');
  });

  it('listSummaries 应按 createdAt 倒序返回且 limit 生效', () => {
    // 原用例只 db.select 后断言行数，从不调用被测方法——orderBy(desc) 被改成 asc 也全绿。
    for (let i = 1; i <= 6; i++) {
      db.insert(chatSessions)
        .values({ id: `s${i}`, projectId: TEST_PROJECT, summary: `m${i}`, messageCount: 2, totalTokens: 100, createdAt: i * 1000, updatedAt: i * 1000 })
        .run();
    }
    svc = new ChatSessionService({ complete: async () => '' } as any);
    const rows = svc.listSummaries(TEST_PROJECT, 5);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.id)).toEqual(['s6', 's5', 's4', 's3', 's2']);
    expect(svc.listSummaries(TEST_PROJECT, 2).map((r) => r.id)).toEqual(['s6', 's5']);
    // 项目隔离：其他项目的摘要不能混进来
    expect(svc.listSummaries('other-project')).toHaveLength(0);
  });

  it('create/list/get/delete 完整会话，旧摘要行不出现在可打开列表', () => {
    svc = new ChatSessionService({ complete: async () => '' } as any);
    const created = svc.createConversation(TEST_PROJECT, {
      id: 'conv-1',
      title: '图神经网络讨论',
      messages: [
        { id: 'm1', role: 'user', content: '图神经网络的消息传递是什么？', createdAt: 1000 },
        { id: 'm2', parentId: 'm1', role: 'assistant', content: '邻居聚合与更新。', createdAt: 2000 },
      ],
      branch: { activeLeafId: 'm2' },
    });
    expect(created.title).toBe('图神经网络讨论');
    expect(created.messageCount).toBe(2);
    expect(created.messages).toHaveLength(2);
    expect(created.branch.activeLeafId).toBe('m2');

    // 旧摘要行：只参与 injectPastSummary，不进入可打开会话。
    db.insert(chatSessions).values({
      id: 'legacy-1', projectId: TEST_PROJECT, title: '旧摘要', summary: '旧摘要内容',
      messagesJson: '[]', branchJson: '{}', messageCount: 2, totalTokens: 20,
      pinned: 0, archived: 0, lastMessageAt: null, source: 'legacy-summary', summaryOnly: 1,
      createdAt: 3000, updatedAt: 3000,
    }).run();
    expect(svc.listConversations(TEST_PROJECT).map((s) => s.id)).toEqual(['conv-1']);

    expect(svc.getConversation(TEST_PROJECT, 'conv-1').messages[1].content).toContain('邻居聚合');
    expect(() => svc.getConversation('other-project', 'conv-1')).toThrow(/会话不存在/);
    svc.deleteConversation(TEST_PROJECT, 'conv-1');
    expect(() => svc.getConversation(TEST_PROJECT, 'conv-1')).toThrow(/会话不存在/);
  });

  it('saveConversation 幂等 upsert，并支持全文搜索', () => {
    svc = new ChatSessionService({ complete: async () => '' } as any);
    svc.createConversation(TEST_PROJECT, { id: 'conv-search', title: '初稿' });
    const saved = svc.saveConversation(TEST_PROJECT, 'conv-search', {
      title: 'CRISPR 脱靶分析',
      messages: [
        { role: 'user', content: '请比较 CRISPR 脱靶检测方法', createdAt: 1000 },
        { role: 'assistant', content: 'GUIDE-seq 与 CFD 是常见方案。', createdAt: 2000 },
      ],
    });
    expect(saved.title).toBe('CRISPR 脱靶分析');
    expect(saved.messageCount).toBe(2);
    expect(svc.listConversations(TEST_PROJECT, { q: 'GUIDE-seq' }).map((s) => s.id)).toEqual(['conv-search']);
    expect(svc.listConversations(TEST_PROJECT, { q: '不存在的关键词' })).toHaveLength(0);
  });

  it('置顶/归档影响列表排序与可见性', () => {
    svc = new ChatSessionService({ complete: async () => '' } as any);
    svc.createConversation(TEST_PROJECT, { id: 'old', title: '旧会话' });
    svc.createConversation(TEST_PROJECT, { id: 'new', title: '新会话' });
    svc.patchConversation(TEST_PROJECT, 'old', { pinned: true });
    expect(svc.listConversations(TEST_PROJECT).map((s) => s.id)).toEqual(['old', 'new']);
    svc.patchConversation(TEST_PROJECT, 'new', { archived: true });
    expect(svc.listConversations(TEST_PROJECT).map((s) => s.id)).toEqual(['old']);
    expect(svc.listConversations(TEST_PROJECT, { includeArchived: true }).map((s) => s.id)).toEqual(['old', 'new']);
    svc.patchConversation(TEST_PROJECT, 'new', { archived: false });
    expect(svc.listConversations(TEST_PROJECT).map((s) => s.id)).toEqual(['old', 'new']);
  });

  it('recordSummary 带 sessionId 时更新现有会话而不是新增一行', async () => {
    const aiComplete = vi.fn(async () => '本轮结论：方法 A 更稳。');
    svc = new ChatSessionService({ complete: aiComplete } as any);
    svc.createConversation(TEST_PROJECT, { id: 'conv-summary', title: '方法比较' });
    await svc.recordSummary(TEST_PROJECT, [
      { role: 'user', content: '比较 A/B 方法' },
      { role: 'assistant', content: 'A 更稳。' },
    ], 321, 'conv-summary', '方法比较');
    const rows = db.select().from(chatSessions).all().filter((s) => s.projectId === TEST_PROJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toContain('方法 A 更稳');
    expect(rows[0].messageCount).toBe(2);
    expect(rows[0].totalTokens).toBe(321);
  });
});
