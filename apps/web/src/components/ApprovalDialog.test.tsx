import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalDialog, type ApprovalRequest } from './ApprovalDialog';

/**
 * 审批对话框的行为回归。
 *
 * 安全要求：拒绝必须可用且优先可见；批准必须显式点击，不能默认放行。
 * 同时要把"这个操作到底干什么"翻译成人话，而不是丢一个工具名给用户猜。
 */

function req(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'ap-1',
    toolName: 'experiment.run',
    args: '{"code":"print(1)"}',
    reason: '将在本机执行代码，请确认来源可信。',
    status: 'pending',
    createdAt: Date.now(),
    ...over,
  };
}

describe('ApprovalDialog', () => {
  it('无请求时不渲染', () => {
    const { container } = render(<ApprovalDialog request={null} onDecide={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('把工具名翻译成人能读懂的动作', () => {
    render(<ApprovalDialog request={req()} onDecide={vi.fn()} />);
    expect(screen.getByText('在本机运行代码')).toBeInTheDocument();
  });

  it('展示请求原因', () => {
    render(<ApprovalDialog request={req()} onDecide={vi.fn()} />);
    expect(screen.getByText('将在本机执行代码，请确认来源可信。')).toBeInTheDocument();
  });

  it('点击允许时回调 approved=true', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalDialog request={req()} onDecide={onDecide} />);
    await user.click(screen.getByRole('button', { name: /允许执行/ }));
    expect(onDecide).toHaveBeenCalledWith('ap-1', true);
  });

  it('点击拒绝时回调 approved=false', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<ApprovalDialog request={req()} onDecide={onDecide} />);
    await user.click(screen.getByRole('button', { name: /拒绝/ }));
    expect(onDecide).toHaveBeenCalledWith('ap-1', false);
  });

  it('参数默认收起，展开后可查看', async () => {
    const user = userEvent.setup();
    render(<ApprovalDialog request={req()} onDecide={vi.fn()} />);
    // details 未展开时内容不应可见（happy-dom 仍保留 DOM，故断言可见性而非存在性）
    const pre = document.querySelector('pre');
    expect(pre).not.toBeVisible();
    await user.click(screen.getByText('查看参数'));
    expect(document.querySelector('details')).toHaveAttribute('open');
  });

  it('未知工具名回落到可读的通用描述', () => {
    render(<ApprovalDialog request={req({ toolName: 'custom.magic' })} onDecide={vi.fn()} />);
    expect(screen.getByText('执行 custom.magic')).toBeInTheDocument();
  });

  it('忙碌时禁用两个按钮，避免重复提交', () => {
    render(<ApprovalDialog request={req()} onDecide={vi.fn()} busy />);
    expect(screen.getByRole('button', { name: /拒绝/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /允许执行/ })).toBeDisabled();
  });
});
