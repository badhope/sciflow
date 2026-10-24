import { describe, expect, it } from 'vitest';
import { deriveStages, stageOfView } from './stages';
import type { Project, DashboardOverview } from '../types';

const project = { id: 'p1', name: 't' } as Project;

function overview(patch: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    pendingOutline: 0,
    overdueSubmissions: [],
    openReviewComments: 0,
    lowQualityDocs: [],
    experimentCount: 0,
    docCount: 0,
    refCount: 0,
    ...patch,
  };
}

const base = { project, view: 'workspace', score: null, reviewedDocCount: 0, submissionCount: 0 };

describe('deriveStages（项目阶段推断）', () => {
  it('空项目：停在「选题」，其余未完成', () => {
    const stages = deriveStages({ ...base, overview: overview(), docCount: 0, hasContent: false });
    expect(stages[0].current).toBe(true);
    expect(stages.filter((s) => s.done)).toHaveLength(0);
  });

  it('有文献 + 有正文 + 已评审 + 有投稿：后四阶段完成', () => {
    const stages = deriveStages({
      ...base,
      overview: overview({ refCount: 3 }),
      docCount: 1,
      hasContent: true,
      reviewedDocCount: 1,
      submissionCount: 1,
    });
    expect(stages.find((s) => s.key === 'literature')!.done).toBe(true);
    expect(stages.find((s) => s.key === 'draft')!.done).toBe(true);
    expect(stages.find((s) => s.key === 'review')!.done).toBe(true);
    expect(stages.find((s) => s.key === 'submit')!.done).toBe(true);
  });

  it('大纲待确认：大纲阶段有 pending 角标', () => {
    const stages = deriveStages({ ...base, overview: overview({ pendingOutline: 2 }), docCount: 1, hasContent: false });
    const outline = stages.find((s) => s.key === 'outline')!;
    expect(outline.pending).toBe(2);
    expect(outline.done).toBe(false);
  });

  it('全部完成时停在最后一个阶段，不会越界', () => {
    const stages = deriveStages({
      ...base,
      overview: overview({ refCount: 1 }),
      docCount: 1,
      hasContent: true,
      reviewedDocCount: 1,
      submissionCount: 1,
    });
    expect(stages[stages.length - 1].current).toBe(true);
  });

  it('视图到阶段的映射', () => {
    expect(stageOfView('writing')).toBe('draft');
    expect(stageOfView('quality')).toBe('review');
    expect(stageOfView('settings')).toBeNull();
  });
});
