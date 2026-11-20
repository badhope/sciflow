import { describe, expect, it } from 'vitest';
import {
  createRevisionQueue,
  inferSectionTitle,
  normalizeRevisionQueueStore,
  serializeRevisionQueueStore,
  summarizeRevisionQueue,
  MAX_REVISION_QUEUES,
  type RevisionQueue,
  type RevisionQueueItem,
} from './revision-queue';

const TITLES = ['引言', '方法', '实验结果', '结论'];

function item(id: string, patch: Partial<RevisionQueueItem> = {}): RevisionQueueItem {
  return {
    id,
    planItemId: id,
    sectionTitle: '方法',
    reviewPoints: '补重复次数',
    status: 'done',
    error: '',
    before: 'before',
    after: 'after',
    changed: true,
    reviewCommentId: '',
    commentResolved: false,
    startedAt: 1,
    finishedAt: 2,
    ...patch,
  };
}

function queue(id: string, items: RevisionQueueItem[] = [item('i1')]): RevisionQueue {
  return createRevisionQueue('doc-1', id, items, 10);
}

describe('inferSectionTitle', () => {
  it('uses an explicit section title only when it exactly matches the document', () => {
    expect(inferSectionTitle({ sectionTitle: '方法' }, TITLES)).toBe('方法');
    expect(inferSectionTitle({ sectionTitle: '方法部分' }, TITLES)).toBe('');
  });

  it('matches the longest section title mentioned in the plan text', () => {
    expect(inferSectionTitle({ excerpt: '实验结果缺少误差棒，方法部分缺少对照。' }, TITLES)).toBe('实验结果');
    expect(inferSectionTitle({ excerpt: '结论需要补充局限。' }, TITLES)).toBe('结论');
  });

  it('returns empty instead of guessing when no section is named', () => {
    expect(inferSectionTitle({ excerpt: '整体语言需要更学术。' }, TITLES)).toBe('');
  });
});

describe('revision queue store', () => {
  it('reads the legacy single-queue JSON without losing items', () => {
    const legacy = queue('q1');
    const store = normalizeRevisionQueueStore(legacy);
    expect(store.queues).toHaveLength(1);
    expect(store.queues[0].id).toBe('q1');
    expect(store.queues[0].items[0].reviewCommentId).toBe('');
    expect(store.queues[0].autoResolve).toBe(true);
  });

  it('keeps newest queues first and caps history at MAX_REVISION_QUEUES', () => {
    const queues = Array.from({ length: MAX_REVISION_QUEUES + 3 }, (_, i) => queue(`q${i}`));
    const raw = serializeRevisionQueueStore({ queues });
    const store = normalizeRevisionQueueStore(raw);
    expect(store.queues).toHaveLength(MAX_REVISION_QUEUES);
    expect(store.queues[0].id).toBe('q0');
    expect(store.queues[MAX_REVISION_QUEUES - 1].id).toBe(`q${MAX_REVISION_QUEUES - 1}`);
  });

  it('returns an empty store for corrupt JSON instead of throwing', () => {
    expect(normalizeRevisionQueueStore('{broken').queues).toEqual([]);
    expect(normalizeRevisionQueueStore(null).queues).toEqual([]);
    expect(normalizeRevisionQueueStore({ queues: 'no' }).queues).toEqual([]);
  });

  it('summarizes counts used by the audit list', () => {
    const q = queue('q1', [
      item('done', { status: 'done' }),
      item('failed', { status: 'failed', changed: false }),
      item('skipped', { status: 'skipped', changed: false }),
      item('pending', { status: 'pending', changed: false }),
    ]);
    q.resolvedCommentIds = ['c1'];
    const summary = summarizeRevisionQueue(q);
    expect(summary.total).toBe(4);
    expect(summary.done).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.changed).toBe(1);
    expect(summary.resolvedComments).toBe(1);
  });
});
