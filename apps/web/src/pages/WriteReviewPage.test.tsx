import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';
import { WriteReviewPage } from './WriteReviewPage';

vi.mock('../lib/queries', () => ({
  useProjectDocs: () => ({ data: [{ id: 'd1', title: '论文 A' }, { id: 'd2', title: '论文 B' }] }),
}));

vi.mock('./WritingPage', () => ({
  WritingPage: ({ docId, onDocChange }: { docId: string | null; onDocChange: (id: string | null) => void }) => (
    <div>
      <span>写作当前：{docId}</span>
      <button onClick={() => onDocChange('d1')}>选择论文 A</button>
    </div>
  ),
}));

vi.mock('./QualityPage', () => ({
  QualityPage: ({ docId }: { docId: string | null }) => <div>评审当前：{docId}</div>,
}));

const project = { id: 'p1', name: '测试项目' } as Project;

describe('WriteReviewPage', () => {
  it('shares the selected document across writing and quality tabs', async () => {
    const onDocChange = vi.fn();
    render(<WriteReviewPage project={project} initialDocId={null} onTabChange={vi.fn()} onDocChange={onDocChange} />);
    expect(await screen.findByText('写作当前：d2')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '选择论文 A' }));
    expect(await screen.findByText('写作当前：d1')).toBeTruthy();
    expect(onDocChange).toHaveBeenLastCalledWith('d1');
    await userEvent.click(screen.getByRole('tab', { name: '质量评审' }));
    expect(await screen.findByText('评审当前：d1')).toBeTruthy();
  });
});
