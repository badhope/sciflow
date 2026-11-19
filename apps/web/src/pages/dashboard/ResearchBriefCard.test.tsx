import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchBriefCard } from './ResearchBriefCard';

const getMock = vi.fn();
const updateMock = vi.fn();
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('../../api/client', () => ({
  api: {
    brief: {
      get: (...a: unknown[]) => getMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
  },
}));

vi.mock('../../App', async () => {
  const { createContext } = await import('react');
  return { ToastContext: createContext(toast) };
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 }, mutations: { retry: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <ResearchBriefCard projectId="p-1" />
    </QueryClientProvider>,
  );
}

describe('ResearchBriefCard', () => {
  beforeEach(() => {
    getMock.mockReset();
    updateMock.mockReset();
    toast.mockReset();
  });
  afterEach(() => cleanup());

  it('读取已有 Brief，进入编辑后可保存局部字段', async () => {
    getMock.mockResolvedValue({
      projectId: 'p-1',
      question: '低资源中文分类是否适合用 GNN？',
      scope: '中文短文本',
      methods: '对照实验',
      constraints: '单卡 24G',
      successCriteria: 'F1 提升 2 个点',
      updatedAt: 1,
    });
    updateMock.mockResolvedValue({
      projectId: 'p-1',
      question: '低资源中文分类是否适合用 GNN？',
      scope: '中文短文本',
      methods: '对照实验 + 消融',
      constraints: '单卡 24G',
      successCriteria: 'F1 提升 2 个点',
      updatedAt: 2,
    });

    renderCard();
    await waitFor(() => expect(screen.getByText(/低资源中文分类/)).toBeTruthy());
    expect(screen.getByText('Agent 已读取')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /编辑/ }));
    const methods = screen.getByDisplayValue('对照实验');
    await userEvent.clear(methods);
    await userEvent.type(methods, '对照实验 + 消融');
    await userEvent.click(screen.getByRole('button', { name: /保存 Brief/ }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock.mock.calls[0][1]).toMatchObject({ methods: '对照实验 + 消融' });
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('已保存'));
    expect(screen.getByText(/对照实验 \+ 消融/)).toBeTruthy();
  });

  it('空 Brief 显示待设置，保存后变为已读取', async () => {
    getMock.mockResolvedValue({
      projectId: 'p-1', question: '', scope: '', methods: '', constraints: '', successCriteria: '', updatedAt: 0,
    });
    updateMock.mockResolvedValue({
      projectId: 'p-1', question: '新问题', scope: '', methods: '', constraints: '', successCriteria: '', updatedAt: 1,
    });
    renderCard();
    await waitFor(() => expect(screen.getByText('待设置')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /设置/ }));
    await userEvent.type(screen.getByPlaceholderText(/图神经网络/), '新问题');
    await userEvent.click(screen.getByRole('button', { name: /保存 Brief/ }));
    await waitFor(() => expect(screen.getByText('Agent 已读取')).toBeTruthy());
  });
});
