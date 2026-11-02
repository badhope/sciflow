import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectCockpit, type QualityGateState } from './ProjectCockpit';
import type { Doc, Project } from '../../types';

/**
 * 项目驾驶舱行为锁（v2.0 信息架构重构）。
 *
 * 为什么必须锁：这是首屏唯一主区域，回答「现在在哪 / 下一步点哪 / 达没达标」。
 * 一旦阶段推断或门禁口径退化，用户会重新失去方向感——而且不会报错，只会用起来别扭。
 */

const project = { id: 'p1', name: '测试项目', description: '', status: 'active', createdAt: 0, updatedAt: 0 } as unknown as Project;

const doc = (over: Partial<Doc> = {}): Doc =>
  ({ id: 'd1', projectId: 'p1', title: '稿件', content: '', status: 'draft', version: 1, versions: '[]', outline: '[]', createdAt: 0, updatedAt: 0, ...over }) as unknown as Doc;

const baseGate: QualityGateState = { score: null, passScore: null, standardLabel: null, hardFailCount: 0 };

function setup(opts: { docs?: Doc[]; gate?: QualityGateState; submissionCount?: number } = {}) {
  const onNavigate = vi.fn();
  const onOpenDoc = vi.fn();
  render(
    <ProjectCockpit
      project={project}
      docs={opts.docs ?? []}
      overview={null}
      gate={opts.gate ?? baseGate}
      submissionCount={opts.submissionCount ?? 0}
      onNavigate={onNavigate}
      onOpenDoc={onOpenDoc}
    />,
  );
  return { onNavigate, onOpenDoc };
}

describe('ProjectCockpit', () => {
  it('空项目：当前阶段是「选题」，主行动直接给「运行一次流水线」并可跳转', async () => {
    const { onNavigate } = setup();
    expect(screen.getByText('项目驾驶舱')).toBeTruthy();
    // 「选题」在阶段条与「当前：」摘要各出现一次，用摘要那句做精确断言
    expect(screen.getByText(/阶段 0\/6 完成 · 当前：/)).toBeTruthy();
    expect(screen.getByText('运行一次流水线')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /前往选题阶段/ }));
    expect(onNavigate).toHaveBeenCalledWith('pipeline');
  });

  it('有正文但无评分：阶段推进到评审，质量门显示「未评分」而不是假绿', () => {
    setup({ docs: [doc({ content: '## 引言\n' + '正文内容。'.repeat(50) })] });
    expect(screen.getByText('未评分')).toBeTruthy();
    expect(screen.getByText(/质量门用确定性规则评分/)).toBeTruthy();
  });

  it('分数低于所选标准：显示差值且判定为未达标（不显示通过）', () => {
    setup({
      docs: [doc({ content: '## 引言\n正文' })],
      gate: { score: 62, passScore: 85, standardLabel: '顶刊（IEEE Trans / Nature 子刊）', hardFailCount: 0 },
    });
    expect(screen.getByText('62/100')).toBeTruthy();
    expect(screen.getByText(/距及格还差 23 分/)).toBeTruthy();
    expect(screen.getByText(/顶刊（IEEE Trans \/ Nature 子刊）/)).toBeTruthy();
  });

  it('有硬伤时明示「封顶 40 分」，不给用户侥幸空间', () => {
    setup({
      docs: [doc({ content: '## 引言\n正文' })],
      gate: { score: 40, passScore: 80, standardLabel: 'SCI 通用期刊', hardFailCount: 2 },
    });
    expect(screen.getByText(/2 项硬伤，封顶 40 分/)).toBeTruthy();
  });

  it('阶段进度可点击跳转：点「文献」进文献页（阶段条不是只读装饰）', async () => {
    const { onNavigate } = setup();
    await userEvent.click(screen.getByRole('button', { name: '文献' }));
    expect(onNavigate).toHaveBeenCalledWith('literature');
  });

  it('全部阶段完成（有投稿记录）时停在最后一阶段，不再回指「选题」', () => {
    setup({
      docs: [doc({ content: '## 引言\n' + '正文。'.repeat(60), status: 'final' })],
      gate: { score: 88, passScore: 80, standardLabel: 'SCI 通用期刊', hardFailCount: 0 },
      submissionCount: 1,
    });
    expect(screen.getByText('投稿')).toBeTruthy();
    expect(screen.getByText('88/100')).toBeTruthy();
  });
});
