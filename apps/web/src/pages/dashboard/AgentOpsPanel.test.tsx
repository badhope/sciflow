import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentOpsPanel } from './AgentOpsPanel';

const metricsMock = vi.fn();
const plansMock = vi.fn();
const approvalsMock = vi.fn();
const tasksMock = vi.fn();
const decidePlanMock = vi.fn();
const decideApprovalMock = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    agent: {
      metrics: (...a: unknown[]) => metricsMock(...a),
      plans: (...a: unknown[]) => plansMock(...a),
      pendingApprovals: (...a: unknown[]) => approvalsMock(...a),
      tasks: (...a: unknown[]) => tasksMock(...a),
      decidePlan: (...a: unknown[]) => decidePlanMock(...a),
      decideApproval: (...a: unknown[]) => decideApprovalMock(...a),
    },
  },
  errMsg: (e: unknown) => String(e),
}));

vi.mock('../../App', async () => {
  const { createContext } = await import('react');
  return { ToastContext: createContext(() => undefined) };
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgentOpsPanel projectId="p-1" />
    </QueryClientProvider>,
  );
}

describe('AgentOpsPanel', () => {
  afterEach(() => cleanup());

  it('渲染工具指标、待批计划与审批，并能批准计划', { timeout: 20000 }, async () => {
    metricsMock.mockResolvedValue({
      rangeDays: 7,
      toolCalls: { total: 12, ok: 9, fail: 3, successRate: 75, avgMs: 20, p95Ms: 80 },
      byTool: [],
      byDay: [],
      runs: { total: 3, done: 2, error: 1, running: 0, avgDurationMs: 1000, totalTokens: 1200 },
    });
    plansMock.mockResolvedValue({
      plans: [{
        id: 'plan-1', projectId: 'p-1', runId: null, title: '验证 H1', summary: '先跑实验再写文档',
        plan: {}, allowedTools: ['document.update', 'experiment.run'], status: 'pending',
        maxSteps: 3, usedSteps: 0, budgetTokens: 0, usedTokens: 0, createdAt: 0, approvedAt: null, expiresAt: null,
      }],
    });
    approvalsMock.mockResolvedValue({
      approvals: [{ id: 'a-1', toolName: 'document.update', args: '{}', reason: '写入测试稿', status: 'pending', projectId: 'p-1', runId: null, createdAt: 0, decidedAt: null }],
    });
    tasksMock.mockResolvedValue({ tasks: [], summary: { total: 4, completed: 2, inProgress: 1, pending: 1, percent: 50 } });
    decidePlanMock.mockResolvedValue({});

    renderPanel();
    await waitFor(() => expect(screen.getByText('Agent 运行')).toBeInTheDocument());
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('验证 H1')).toBeInTheDocument();
    expect(screen.getByText('待批准')).toBeInTheDocument();
    expect(screen.getByText('写入测试稿')).toBeInTheDocument();
    expect(screen.getByText(/任务清单 2\/4/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /批准计划/ }));
    await waitFor(() => expect(decidePlanMock).toHaveBeenCalledWith('plan-1', true));
  });

  it('显示生效中的计划、步数与 token 预算消耗', { timeout: 20000 }, async () => {
    metricsMock.mockResolvedValue({
      rangeDays: 7,
      toolCalls: { total: 0, ok: 0, fail: 0, successRate: 0, avgMs: 0, p95Ms: 0 },
      byTool: [],
      byDay: [],
      runs: { total: 0, done: 0, error: 0, running: 0, avgDurationMs: 0, totalTokens: 0 },
    });
    plansMock.mockResolvedValue({
      plans: [{
        id: 'plan-active', projectId: 'p-1', runId: null, title: '正在执行的计划', summary: '',
        plan: {}, allowedTools: ['document.update'], status: 'approved',
        maxSteps: 5, usedSteps: 3, budgetTokens: 100, usedTokens: 60, createdAt: 0, approvedAt: 1, expiresAt: Date.now() + 3600_000,
      }],
    });
    approvalsMock.mockResolvedValue({ approvals: [] });
    tasksMock.mockResolvedValue({ tasks: [], summary: { total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 } });

    renderPanel();
    expect(await screen.findByText('生效中')).toBeInTheDocument();
    expect(screen.getByText('正在执行的计划')).toBeInTheDocument();
    expect(screen.getByText('步数 3/5')).toBeInTheDocument();
    expect(screen.getByText('预算 60 / 100 tokens')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('document.update')).toBeInTheDocument();
    expect(screen.getByText(/有效至/)).toBeInTheDocument();
  });
});
