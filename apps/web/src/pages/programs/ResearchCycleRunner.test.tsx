import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 自主研究循环面板契约（阶段 4）。
 *
 * 锁三件事：
 *  1) 面板能发起循环（填问题 → 点启动 → 调用 start API）；
 *  2) 门禁态必须显式呈现「批准并继续 / 驳回」两个动作——L2 下没人点批准，循环就不该继续；
 *  3) 循环状态（轮次/token/结论）要能从服务端对象直接读出来，不在前端另存一份状态。
 */

const start = vi.fn();
const resume = vi.fn();
const status = vi.fn();
const list = vi.fn();
const approveProtocol = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    researchCycles: {
      start: (...a: unknown[]) => start(...a),
      resume: (...a: unknown[]) => resume(...a),
      status: (...a: unknown[]) => status(...a),
      list: (...a: unknown[]) => list(...a),
    },
    programs: {
      approveProtocol: (...a: unknown[]) => approveProtocol(...a),
    },
  },
}));

vi.mock('../../App', async () => {
  // 工厂会被提升到文件顶部，不能引用顶层变量；React 要在工厂内部动态引入
  const react = await import('react');
  return { ToastContext: react.createContext(() => undefined) };
});

const cycleStatus = {
  id: 'cycle-1',
  programId: 'prog-1',
  seq: 1,
  state: 'awaiting_approval',
  objective: 'q',
  summary: '等待人工审批研究协议',
  budget: {},
  startedAt: 1,
  endedAt: null,
  createdAt: 1,
  updatedAt: 1,
  program: { id: 'prog-1', title: 'RobustnessStudy', autonomyLevel: 'L2' },
  claims: [],
  runs: [],
  protocols: [{ id: 'proto-1', status: 'draft', version: 1 }],
  tokensSpent: 1234,
};

async function renderPanel() {
  const { ResearchCycleRunner } = await import('./ResearchCycleRunner');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ResearchCycleRunner programId="prog-1" programTitle="RobustnessStudy" autonomyLevel="L2" onChanged={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('ResearchCycleRunner', () => {
  beforeEach(() => {
    start.mockReset();
    resume.mockReset();
    status.mockReset();
    list.mockReset();
    approveProtocol.mockReset();
    list.mockResolvedValue([{ id: 'cycle-1' }]);
    status.mockResolvedValue(cycleStatus);
    start.mockResolvedValue(cycleStatus);
    resume.mockResolvedValue(cycleStatus);
    approveProtocol.mockResolvedValue({ id: 'proto-1', status: 'approved' });
  });

  afterEach(() => cleanup());

  it('展示面板并可发起循环', async () => {
    await renderPanel();
    expect(await screen.findByText('自主研究循环')).toBeTruthy();

    await act(async () => {
      fireEvent.change(screen.getByLabelText('研究问题'), { target: { value: '离群点下中位数是否更稳健' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('启动循环'));
    });

    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0][0]).toBe('prog-1');
    expect(start.mock.calls[0][1].question).toBe('离群点下中位数是否更稳健');
  });

  it('可切换全自动模式并以 approvalMode=ai 发起循环', async () => {
    await renderPanel();
    await act(async () => {
      fireEvent.change(screen.getByLabelText('研究问题'), { target: { value: '全自动验证问题' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('全自动（AI 专家审批）'));
    });
    expect(screen.getByText('全自动启动')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('全自动启动'));
    });
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start.mock.calls[0][1]).toMatchObject({ question: '全自动验证问题', approvalMode: 'ai' });
  });

  it('门禁态显示批准与驳回两个动作', async () => {
    await renderPanel();
    expect(await screen.findByText('批准并继续')).toBeTruthy();
    expect(screen.getByText('驳回并终止')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('驳回并终止'));
    });
    await waitFor(() => expect(resume).toHaveBeenCalledWith('cycle-1', { approved: false }));
  });

  it('状态区展示轮次与 token 用量', async () => {
    await renderPanel();
    expect(await screen.findByText(/token 1234/)).toBeTruthy();
    expect(screen.getByText(/待审批协议/)).toBeTruthy();
  });
});
