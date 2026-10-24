import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Doc, Project } from '../types';

/**
 * WorkspacePage 行为测试。
 *
 * 历史问题：本文件此前 4 条用例只断言「元素存在」——文档标题出现、按钮存在、
 * 空线程显示引导文案。`streamChat` 被 mock 成空函数后从不触发回调，
 * 因此**流式聚合逻辑（D1 平方膨胀）完全没被覆盖**，人工实测才发现。
 *
 * 现在补上真正的行为用例：驱动发送 → 回放累积分片 → 断言最终文本。
 */

const docA: Doc = {
  id: 'doc-1',
  projectId: 'p-1',
  title: '验收样稿',
  content: '## 引言\n\n图神经网络的正文内容。',
  version: 2,
  status: 'draft',
  createdAt: 0,
  updatedAt: 0,
} as Doc;

/** 捕获 streamChat 的入参，供测试手动回放分片 */
let lastOpts: Record<string, unknown> | null = null;
const streamChatMock = vi.fn((opts: Record<string, unknown>) => {
  lastOpts = opts;
  return () => undefined;
});

vi.mock('../api/client', () => ({
  api: {
    documents: {
      list: vi.fn(async () => [docA]),
      get: vi.fn(async () => docA),
      create: vi.fn(async () => docA),
      update: vi.fn(async () => docA),
    },
    pipeline: { create: vi.fn(), get: vi.fn(), confirmOutline: vi.fn() },
    settings: { get: vi.fn(async () => ({ ai: { models: [] } })) },
    judgment: { intent: vi.fn(async () => null) },
    chat: { sessions: vi.fn(async () => ({ sessions: [] })) },
    knowledge: { list: vi.fn(async () => []) },
  },
  streamChat: (opts: Record<string, unknown>) => streamChatMock(opts),
}));

import { WorkspacePage } from './WorkspacePage';

const project: Project = { id: 'p-1', name: '测试项目', description: '', status: 'active', createdAt: 0, updatedAt: 0 } as Project;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WorkspacePage project={project} initialDocId={null} onOpenFullEditor={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('WorkspacePage（对话+预览工作台）', () => {
  beforeEach(() => {
    localStorage.clear();
    lastOpts = null;
    streamChatMock.mockClear();
  });

  it('拉取文档列表并自动选中第一篇（标题出现在选择器与预览头）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('验收样稿').length).toBeGreaterThanOrEqual(2));
  });

  it('右侧预览渲染文档正文（Markdown → prose）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/图神经网络的正文内容/)).toBeTruthy());
  });

  it('空线程显示引导文案；输入为空时发送按钮禁用', async () => {
    renderPage();
    expect(screen.getByText('开始与 SciFlow 对话')).toBeTruthy();
    const sendBtn = screen.getByRole('button', { name: /发送/ });
    expect(sendBtn).toBeDisabled();
  });

  it('顶部提供运行流水线与完整编辑器入口', async () => {
    renderPage();
    expect(screen.getByRole('button', { name: /运行流水线/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /完整编辑器/ })).toBeTruthy());
  });

  /* ── 以下为真正的行为测试（此前缺失） ───────────────────────── */

  it('发送消息：调用 streamChat 并传入当前项目', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('验收样稿').length).toBeGreaterThanOrEqual(2));

    const ta = screen.getByPlaceholderText(/问问题/);
    fireEvent.change(ta, { target: { value: '什么是图神经网络？' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });

    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(1));
    // v0.11 起对话请求统一追加 FOLLOWUP_HINT 约定（followUps 追问建议），用户正文必须原样在前
    expect(String(lastOpts?.message).startsWith('什么是图神经网络？')).toBe(true);
    expect(String(lastOpts?.message)).toContain('---FOLLOWUPS---');
    expect(lastOpts?.projectId).toBe('p-1');
  });

  it('流式分片按「累积值」语义渲染：最终文本等于最后一次累积（D1 回归）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('验收样稿').length).toBeGreaterThanOrEqual(2));

    const ta = screen.getByPlaceholderText(/问问题/);
    fireEvent.change(ta, { target: { value: '测试流式' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(1));

    // 模拟网关逐块回调：每次传的是「累积全文」（与 core.ts 契约一致）
    const chunks = ['科研', '科研论文', '科研论文写作', '科研论文写作很重要'];
    const onDelta = lastOpts?.onDelta as (t: string) => void;
    expect(typeof onDelta).toBe('function');
    await act(async () => {
      for (const c of chunks) onDelta(c);
    });

    const expected = chunks[chunks.length - 1];
    // 关键断言：不得出现重复拼接。
    // 不用「长串出现几次」——旧 bug 产生的 "科研科研论文科研论文写作…" 里，
    // 最长的累积串恰好只出现一次，会假通过。
    // 定位到助手消息节点本身，其文本必须严格等于最后一次累积值。
    await waitFor(() => {
      const assistant = document.querySelector('[data-testid="assistant-message"]');
      expect(assistant?.textContent ?? '').toBe(expected);
    });
  });

  it('推理分片同样按累积值渲染（不得重复拼接）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('验收样稿').length).toBeGreaterThanOrEqual(2));

    const ta = screen.getByPlaceholderText(/问问题/);
    fireEvent.change(ta, { target: { value: '测试推理' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(1));

    const onReasoning = lastOpts?.onReasoning as (t: string) => void;
    await act(async () => {
      onReasoning('想');
      onReasoning('想一下');
      onReasoning('想一下再说');
    });

    // 推理面板文本必须严格等于最后一次累积值（重复拼接会出现 "想想一下想一下再说"）
    await waitFor(() => {
      const reasoning = document.querySelector('[data-testid="assistant-reasoning"]');
      expect(reasoning?.textContent ?? '').toBe('想一下再说');
    });
  });

  it('onError：把错误显示在对话流里，不静默吞掉', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('验收样稿').length).toBeGreaterThanOrEqual(2));

    const ta = screen.getByPlaceholderText(/问问题/);
    fireEvent.change(ta, { target: { value: '触发错误' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(1));

    const onError = lastOpts?.onError as (m: string) => void;
    await act(async () => onError('文档内容过短，暂无法评分（至少 50 字）'));

    await waitFor(() => {
      const text = document.querySelector('[data-testid="chat-thread"]')?.textContent ?? '';
      // 中文业务错误必须原样呈现，不能被改写成"无法连接服务器"
      expect(text).toContain('文档内容过短');
    });
  });
});
