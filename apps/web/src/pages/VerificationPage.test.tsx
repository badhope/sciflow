import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';
import { VerificationPage } from './VerificationPage';

vi.mock('./ExperimentsPage', () => ({
  ExperimentsPage: () => <div>实验记录内容</div>,
}));
vi.mock('./WebSandboxPage', () => ({
  WebSandboxPage: () => <div>Web 项目内容</div>,
}));
vi.mock('./BrowserPage', () => ({
  BrowserPage: () => <div>浏览器内容</div>,
}));

const project = { id: 'p1', name: '测试项目' } as Project;

describe('VerificationPage', () => {
  it('把实验、Web 项目与浏览器收进同一个入口的二级 Tab', async () => {
    render(<VerificationPage project={project} onTabChange={vi.fn()} />);
    expect(await screen.findByText('实验记录内容')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '实验记录' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Web 项目' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '内置浏览器' })).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Web 项目' }));
    expect(await screen.findByText('Web 项目内容')).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: '内置浏览器' }));
    expect(await screen.findByText('浏览器内容')).toBeTruthy();
  });
});
