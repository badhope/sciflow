import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanApprovalCard } from './PlanApprovalCard';

const plansMock = vi.fn();
const decidePlanMock = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    agent: {
      plans: (...a: unknown[]) => plansMock(...a),
      decidePlan: (...a: unknown[]) => decidePlanMock(...a),
    },
  },
}));

const pendingPlan = {
  id: 'plan-1',
  projectId: 'p-1',
  runId: null,
  title: '验证 H1',
  summary: '先跑实验，再更新文档',
  plan: {},
  allowedTools: ['document.update', 'experiment.run'],
  status: 'pending' as const,
  maxSteps: 4,
  usedSteps: 0,
  budgetTokens: 0,
  usedTokens: 0,
  createdAt: 0,
  approvedAt: null,
  expiresAt: null,
};

function renderCard(streaming = true, onApproved = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlanApprovalCard projectId="p-1" streaming={streaming} onApproved={onApproved} />
    </QueryClientProvider>,
  );
}

describe('PlanApprovalCard', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('展示待批计划，批准后通知父组件继续', { timeout: 20000 }, async () => {
    plansMock.mockResolvedValue({ plans: [pendingPlan] });
    decidePlanMock.mockResolvedValue({ plan: { ...pendingPlan, status: 'approved' } });
    const onApproved = vi.fn();
    renderCard(true, onApproved);

    expect(await screen.findByText('研究计划待批准 · 1 项')).toBeInTheDocument();
    expect(screen.getByText('验证 H1')).toBeInTheDocument();
    expect(screen.getByText('document.update')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /批准并继续/ }));
    await waitFor(() => expect(decidePlanMock).toHaveBeenCalledWith('plan-1', true));
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith(pendingPlan, true));
  });

  it('没有待批计划时不渲染', async () => {
    plansMock.mockResolvedValue({ plans: [{ ...pendingPlan, status: 'approved' }] });
    renderCard(false);
    await waitFor(() => expect(plansMock).toHaveBeenCalled());
    expect(screen.queryByText(/研究计划待批准/)).not.toBeInTheDocument();
  });
});
