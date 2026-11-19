import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';
import { StageBar } from './StageBar';

const project = { id: 'p1', name: '测试项目' } as Project;

describe('StageBar', () => {
  it('navigates into the six-entry tabs instead of the hidden legacy routes', async () => {
    const onNavigate = vi.fn();
    render(
      <StageBar
        project={project}
        view="dashboard"
        overview={null}
        docCount={0}
        hasContent={false}
        score={null}
        reviewedDocCount={0}
        submissionCount={0}
        onNavigate={onNavigate}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /大纲/ }));
    expect(onNavigate).toHaveBeenCalledWith('design', 'pipeline');

    await userEvent.click(screen.getByRole('button', { name: /起草/ }));
    expect(onNavigate).toHaveBeenCalledWith('write-review', 'writing');

    await userEvent.click(screen.getByRole('button', { name: /评审/ }));
    expect(onNavigate).toHaveBeenCalledWith('write-review', 'quality');
  });
});
