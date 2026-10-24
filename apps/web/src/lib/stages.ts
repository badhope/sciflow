import { useMemo } from 'react';
import type { Project } from '../types';
import type { DashboardOverview } from '../types';

export type StageKey = 'research' | 'literature' | 'outline' | 'draft' | 'review' | 'submit';

export interface StageState {
  key: StageKey;
  label: string;
  /** 该阶段是否已完成（可从后端聚合推断） */
  done: boolean;
  /** 当前所在阶段 */
  current: boolean;
  /** 该阶段有需要处理的卡点（角标数字） */
  pending: number;
  /** 点击跳转视图（默认阶段对应页） */
  view: string;
  hint: string;
}

export interface StageInput {
  project: Project;
  /** 后端 /api/dashboard/overview；未就绪时传 null（只做阶段导航，不做完成度推断） */
  overview: DashboardOverview | null;
  /** 文档数量与是否有正文（来自 documents 列表） */
  docCount: number;
  hasContent: boolean;
  /** 质量分（有则视为已评审） */
  score: number | null;
  /** 已进入评审/定稿状态的文档数（status=reviewing|polished|final） */
  reviewedDocCount: number;
  /** 投稿跟踪条数 */
  submissionCount: number;
  /** 当前视图，用于高亮 */
  view: string;
}

/**
 * 项目阶段推断（纯函数，便于测试）
 *
 * 六个阶段对应产品的真实叙事：选题 → 文献 → 大纲 → 起草 → 评审 → 投稿。
 * 只有「有真实数据」才算完成，避免空项目显示全绿。
 */
export function deriveStages(input: StageInput): StageState[] {
  const { overview, docCount, hasContent, score, submissionCount, reviewedDocCount } = input;
  const pendingOutline = overview?.pendingOutline ?? 0;
  const openComments = overview?.openReviewComments ?? 0;
  const overdue = overview?.overdueSubmissions?.length ?? 0;

  const literatureDone = (overview?.refCount ?? 0) > 0 || (overview?.experimentCount ?? 0) > 0;
  const outlineDone = docCount > 0 && pendingOutline === 0 && hasContent;
  const draftDone = hasContent;
  const reviewDone = (typeof score === 'number' && score > 0) || reviewedDocCount > 0;
  const submitDone = submissionCount > 0;

  const raw: Omit<StageState, 'current'>[] = [
    { key: 'research', label: '选题', done: docCount > 0 || literatureDone, pending: 0, view: 'workspace', hint: '确认研究主题与可行性' },
    { key: 'literature', label: '文献', done: literatureDone, pending: 0, view: 'literature', hint: '检索、筛选与编码文献' },
    { key: 'outline', label: '大纲', done: outlineDone, pending: pendingOutline, view: 'pipeline', hint: '生成并确认章节大纲' },
    { key: 'draft', label: '起草', done: draftDone, pending: 0, view: 'writing', hint: '分章起草与润色' },
    { key: 'review', label: '评审', done: reviewDone, pending: openComments, view: 'quality', hint: '7 维质量评分与改进' },
    { key: 'submit', label: '投稿', done: submitDone, pending: overdue, view: 'submission', hint: '选刊、投稿信与状态跟踪' },
  ];

  // 当前阶段 = 第一个未完成阶段；全部完成则停在最后一个
  const firstOpen = raw.findIndex((s) => !s.done);
  const currentIndex = firstOpen === -1 ? raw.length - 1 : firstOpen;
  return raw.map((s, i) => ({ ...s, current: i === currentIndex }));
}

const VIEW_TO_STAGE: Record<string, StageKey> = {
  workspace: 'research',
  literature: 'literature',
  pipeline: 'outline',
  writing: 'draft',
  quality: 'review',
  submission: 'submit',
};

/** 当前视图属于哪个阶段（用于阶段条高亮跟随页面） */
export function stageOfView(view: string): StageKey | null {
  return VIEW_TO_STAGE[view] ?? null;
}

export function useStages(input: StageInput): StageState[] {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => deriveStages(input), [input.overview, input.docCount, input.hasContent, input.score, input.submissionCount, input.reviewedDocCount, input.view]);
}
