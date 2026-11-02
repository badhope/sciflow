import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskListPanel, TaskProgressPill, type AgentTask } from './TaskListPanel';

/**
 * 任务清单面板的行为回归。
 *
 * 关注点：用户能不能从界面上判断"做到哪了"。空清单不该占位，
 * 进度百分比要正确，折叠态下也要能看到当前在做的事。
 */

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: Math.random().toString(36),
    content: '默认任务',
    status: 'pending',
    priority: 'medium',
    seq: 0,
    ...over,
  };
}

describe('TaskListPanel', () => {
  it('没有任务时不渲染任何内容', () => {
    const { container } = render(<TaskListPanel tasks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('显示已完成数与总数', () => {
    render(
      <TaskListPanel
        tasks={[task({ status: 'completed' }), task({ status: 'pending' })]}
        summary={{ total: 2, completed: 1, inProgress: 0, percent: 50 }}
      />,
    );
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('有进行中任务时默认展开，让用户看到当前步骤', () => {
    render(<TaskListPanel tasks={[task({ content: '正在检索文献', status: 'in_progress' })]} />);
    expect(screen.getByText('正在检索文献')).toBeInTheDocument();
  });

  it('折叠后仍显示当前进行中的任务摘要', async () => {
    const user = userEvent.setup();
    render(
      <TaskListPanel
        tasks={[task({ content: '正在写作第二章', status: 'in_progress' }), task({ content: '待办事项' })]}
      />,
    );
    // 展开态能看到两项
    expect(screen.getByText('待办事项')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /任务进度/ }));
    // 折叠后只保留进行中那一条
    expect(screen.getByText('正在写作第二章')).toBeInTheDocument();
    expect(screen.queryByText('待办事项')).not.toBeInTheDocument();
  });

  it('完成项加删除线，视觉上与未完成区分', () => {
    render(<TaskListPanel tasks={[task({ content: '已完成的步骤', status: 'completed' })]} defaultOpen />);
    const el = screen.getByText('已完成的步骤');
    expect(el.className).toContain('line-through');
  });

  it('高优先级未完成项带标记', () => {
    render(<TaskListPanel tasks={[task({ content: '关键任务', priority: 'high', status: 'pending' })]} defaultOpen />);
    expect(screen.getByText('高')).toBeInTheDocument();
  });

  it('已完成的高优先级项不再显示优先级标记', () => {
    render(<TaskListPanel tasks={[task({ content: '做完了', priority: 'high', status: 'completed' })]} defaultOpen />);
    expect(screen.queryByText('高')).not.toBeInTheDocument();
  });
});

describe('TaskProgressPill', () => {
  it('无任务时不渲染', () => {
    const { container } = render(<TaskProgressPill summary={{ total: 0, completed: 0, inProgress: 0, percent: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('显示进度数字', () => {
    render(<TaskProgressPill summary={{ total: 4, completed: 2, inProgress: 1, percent: 50 }} />);
    expect(screen.getByText('2/4')).toBeInTheDocument();
  });
});
