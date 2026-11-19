import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../types';
import { EvidenceSummary } from './EvidenceSummary';

vi.mock('../lib/queries', () => ({
  useProjectRefs: () => ({ data: [{ id: 'r1' }, { id: 'r2' }] }),
  useProjectKnowledge: () => ({ data: [{ id: 'k1' }] }),
}));

const project = { id: 'p1', name: '测试项目' } as Project;

describe('EvidenceSummary', () => {
  it('shows counts shared by the literature and knowledge tabs', () => {
    render(<EvidenceSummary project={project} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText(/文献与资料共用同一项目上下文/)).toBeTruthy();
  });
});
