import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 记忆中心的项目作用域契约（v1.8）。
 *
 * 背景：服务端在企业模式（AUTH_MODE=jwt）下要求 `GET /api/memory` 必须带 projectId
 * （记忆是项目级资源，跨项目混列会泄露他人研究摘要）。若前端漏传，本地模式测试仍然全绿，
 * 但部署到企业模式会整页 403 —— 因此这里直接断言「页面发出的请求一定带 projectId」。
 */

const listMock = vi.fn();
vi.mock('../api/client', () => ({
  api: {
    memory: {
      list: (...args: unknown[]) => listMock(...args),
      add: vi.fn(),
      remove: vi.fn(),
    },
  },
  errMsg: (e: unknown) => String(e),
}));

const project = { id: 'p-42', name: '测试项目', description: '', createdAt: 0, updatedAt: 0 } as never;

async function renderPage() {
  const { MemoryPage } = await import('./MemoryPage');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryPage project={project} />
    </QueryClientProvider>,
  );
}

describe('记忆中心：项目作用域', () => {
  // 显式 cleanup：并发跑全量时 RTL 自动清理可能滞后，导致上一次渲染残留、查询命中多个元素
  afterEach(() => cleanup());

  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue([]);
  });

  it('列表与概览请求都带 projectId', { timeout: 20000 }, async () => {
    await renderPage();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const calls = listMock.mock.calls;
    // 至少两条：明细查询 + 概览聚合
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const args of calls) {
      expect(args[2]).toBe('p-42');
    }
  });

  it('空态给出「记忆从哪来」说明（不是只有一行「还没有记忆」）', { timeout: 20000 }, async () => {
    await renderPage();
    await waitFor(() => expect(screen.getByText('两类记忆从哪来')).toBeInTheDocument());
    // 说明卡里三项来源都有解释（含「程序记忆」与「项目隔离」）
    expect(screen.getAllByText(/情景记忆/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/程序记忆/).length).toBeGreaterThan(0);
  });
});
