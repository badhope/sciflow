import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentOpsPanel } from './AgentOpsPanel';

const metricsMock = vi.fn();
const executionsMock = vi.fn();
const getRunMock = vi.fn();
const plansMock = vi.fn();
const approvalsMock = vi.fn();
const tasksMock = vi.fn();
const decidePlanMock = vi.fn();
const decideApprovalMock = vi.fn();
const notificationsMock = vi.fn();
const markNotificationReadMock = vi.fn();
const markAllNotificationsReadMock = vi.fn();
const retryNotificationMock = vi.fn();
const schedulesMock = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    agent: {
      metrics: (...a: unknown[]) => metricsMock(...a),
      executions: (...a: unknown[]) => executionsMock(...a),
      getRun: (...a: unknown[]) => getRunMock(...a),
      plans: (...a: unknown[]) => plansMock(...a),
      pendingApprovals: (...a: unknown[]) => approvalsMock(...a),
      tasks: (...a: unknown[]) => tasksMock(...a),
      decidePlan: (...a: unknown[]) => decidePlanMock(...a),
      decideApproval: (...a: unknown[]) => decideApprovalMock(...a),
      notifications: (...a: unknown[]) => notificationsMock(...a),
      markNotificationRead: (...a: unknown[]) => markNotificationReadMock(...a),
      markAllNotificationsRead: (...a: unknown[]) => markAllNotificationsReadMock(...a),
      retryNotification: (...a: unknown[]) => retryNotificationMock(...a),
      schedules: (...a: unknown[]) => schedulesMock(...a),
      createSchedule: (...a: unknown[]) => schedulesMock('create', ...a),
      updateSchedule: (...a: unknown[]) => schedulesMock('update', ...a),
      deleteSchedule: (...a: unknown[]) => schedulesMock('delete', ...a),
      runSchedule: (...a: unknown[]) => schedulesMock('run', ...a),
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
  beforeEach(() => {
    executionsMock.mockReset();
    getRunMock.mockReset();
    notificationsMock.mockReset();
    schedulesMock.mockReset();
    notificationsMock.mockResolvedValue({ notifications: [], unread: 0 });
    schedulesMock.mockResolvedValue({ schedules: [] });
    executionsMock.mockResolvedValue({ executions: [] });
  });
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

  it('同一屏展示任务、审批与自动化通知，且各自只请求一次', { timeout: 20000 }, async () => {
    metricsMock.mockResolvedValue({
      rangeDays: 7,
      toolCalls: { total: 0, ok: 0, fail: 0, successRate: 0, avgMs: 0, p95Ms: 0 }, byTool: [], byDay: [],
      runs: { total: 0, done: 0, error: 0, running: 0, avgDurationMs: 0, totalTokens: 0 },
    });
    plansMock.mockResolvedValue({ plans: [] });
    approvalsMock.mockResolvedValue({ approvals: [{ id: 'a-1', toolName: 'document.update', args: '{}', reason: '写入测试稿', status: 'pending', projectId: 'p-1', runId: null, createdAt: 0, decidedAt: null }] });
    tasksMock.mockResolvedValue({ tasks: [{ id: 't-1', content: '跑实验', status: 'in_progress', priority: 'medium', seq: 1 }], summary: { total: 1, completed: 0, inProgress: 0, pending: 1, percent: 0 } });
    notificationsMock.mockResolvedValue({ notifications: [{ id: 'n-1', projectId: 'p-1', kind: 'automation', title: '流水线已完成', body: '可以查看结果', link: '/pipeline', read: false, createdAt: 0 }], unread: 1 });

    renderPanel();
    expect(await screen.findByText('自动化')).toBeInTheDocument();
    expect(await screen.findByText('自动化通知')).toBeInTheDocument();
    expect(await screen.findByText('流水线已完成')).toBeInTheDocument();
    expect(screen.getByText('写入测试稿')).toBeInTheDocument();
    expect(screen.getByText(/任务清单 0\/1/)).toBeInTheDocument();
    expect(tasksMock).toHaveBeenCalledTimes(1);
    expect(approvalsMock).toHaveBeenCalledTimes(1);
    expect(notificationsMock).toHaveBeenCalledTimes(1);
  });

  it('用户中止的执行显示“已中止”，不再伪装成完成', { timeout: 20000 }, async () => {
    metricsMock.mockResolvedValue({
      rangeDays: 7,
      toolCalls: { total: 0, ok: 0, fail: 0, successRate: 0, avgMs: 0, p95Ms: 0 },
      byTool: [],
      byDay: [],
      runs: { total: 0, done: 0, error: 0, running: 0, avgDurationMs: 0, totalTokens: 0 },
    });
    plansMock.mockResolvedValue({ plans: [] });
    approvalsMock.mockResolvedValue({ approvals: [] });
    tasksMock.mockResolvedValue({ tasks: [], summary: { total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 } });
    executionsMock.mockResolvedValue({
      executions: [{
        id: 'run-cancelled', projectId: 'p-1', source: 'chat', input: '读长文档', outputSummary: 'chat 工具会话（58 个工具可用）',
        durationMs: 70682, totalTokens: 0, status: 'cancelled', error: '用户中止', model: 'test-model', createdAt: 1,
      }],
    });
    getRunMock.mockResolvedValue({
      id: 'run-cancelled', projectId: 'p-1', source: 'chat', input: '读长文档', outputSummary: 'chat 工具会话（58 个工具可用）',
      durationMs: 70682, totalTokens: 0, status: 'cancelled', error: '用户中止', model: 'test-model', createdAt: 1,
      steps: [],
    });

    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /chat/ }));
    expect(await screen.findByText('已中止')).toBeInTheDocument();
  });

  it('点开最近执行可查看步骤链、工具返回和失败原因', { timeout: 20000 }, async () => {
    metricsMock.mockResolvedValue({
      rangeDays: 7,
      toolCalls: { total: 1, ok: 1, fail: 0, successRate: 100, avgMs: 42, p95Ms: 42 },
      byTool: [],
      byDay: [],
      runs: { total: 1, done: 1, error: 0, running: 0, avgDurationMs: 1000, totalTokens: 123 },
    });
    plansMock.mockResolvedValue({ plans: [] });
    approvalsMock.mockResolvedValue({ approvals: [] });
    tasksMock.mockResolvedValue({ tasks: [], summary: { total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 } });
    executionsMock.mockResolvedValue({
      executions: [{
        id: 'run-1', projectId: 'p-1', source: 'chat', input: '列出项目', outputSummary: '找到 2 个项目',
        durationMs: 1000, totalTokens: 123, status: 'done', error: '', model: 'test-model', createdAt: 1,
      }],
    });
    getRunMock.mockResolvedValue({
      id: 'run-1', projectId: 'p-1', source: 'chat', input: '列出项目', outputSummary: '找到 2 个项目',
      durationMs: 1000, totalTokens: 123, status: 'done', error: '', model: 'test-model', createdAt: 1,
      steps: [{
        id: 'step-1', runId: 'run-1', seq: 1, kind: 'tool', title: 'project.list', input: '{}',
        output: '2 个项目', durationMs: 42, tokens: 0, toolName: 'project.list', status: 'ok', error: '', createdAt: 1,
      }],
    });

    renderPanel();
    const runButton = await screen.findByTitle('查看 chat 的步骤链');
    await userEvent.click(runButton);

    expect(await screen.findByText('执行详情')).toBeInTheDocument();
    expect(screen.getByText('project.list')).toBeInTheDocument();
    expect(screen.getByText('2 个项目')).toBeInTheDocument();
    expect(getRunMock).toHaveBeenCalledWith('run-1');
  });

  it('待批计划展开后能看到结构化计划正文', { timeout: 20000 }, async () => {
    metricsMock.mockResolvedValue({
      rangeDays: 7,
      toolCalls: { total: 0, ok: 0, fail: 0, successRate: 0, avgMs: 0, p95Ms: 0 },
      byTool: [],
      byDay: [],
      runs: { total: 0, done: 0, error: 0, running: 0, avgDurationMs: 0, totalTokens: 0 },
    });
    plansMock.mockResolvedValue({
      plans: [{
        id: 'plan-detail', projectId: 'p-1', runId: null, title: '验证 H1', summary: '先跑实验',
        plan: { question: 'X 是否提升 Y？', hypothesis: 'X 提升 Y', risks: ['样本偏差'] },
        allowedTools: ['experiment.run'], status: 'pending',
        maxSteps: 3, usedSteps: 0, budgetTokens: 0, usedTokens: 0, createdAt: 0, approvedAt: null, expiresAt: null,
      }],
    });
    approvalsMock.mockResolvedValue({ approvals: [] });
    tasksMock.mockResolvedValue({ tasks: [], summary: { total: 0, completed: 0, inProgress: 0, pending: 0, percent: 0 } });

    renderPanel();
    expect(await screen.findByText('验证 H1')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/查看计划详情/));
    expect(screen.getByText('研究问题')).toBeInTheDocument();
    expect(screen.getByText('X 是否提升 Y？')).toBeInTheDocument();
    expect(screen.getByText('样本偏差')).toBeInTheDocument();
  });
});
