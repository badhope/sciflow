import type { ReactNode } from 'react';
import type { SubmissionStatus } from '../../types';
import { Badge } from '../../components/ui';

export type SubmissionTab = 'readiness' | 'journals' | 'cover' | 'reply' | 'track';

/** 状态 → 中文标签 / Badge 颜色 / 阶段分组（页面顶部常量） */
export const STATUS_META: Record<SubmissionStatus, { label: string; tone: 'slate' | 'green' | 'amber' | 'red' | 'teal' | 'blue'; group: string }> = {
  submitted: { label: '收稿', tone: 'blue', group: '投稿中' },
  initial_review: { label: '初审', tone: 'teal', group: '外审中' },
  external_review: { label: '外审', tone: 'amber', group: '外审中' },
  review_returned: { label: '意见已回', tone: 'amber', group: '外审中' },
  minor_revision: { label: '小修', tone: 'amber', group: '返修' },
  major_revision: { label: '大修', tone: 'red', group: '返修' },
  re_review: { label: '复审', tone: 'amber', group: '返修' },
  final_review: { label: '终审', tone: 'blue', group: '终审' },
  accepted: { label: '录用', tone: 'green', group: '完结' },
  in_production: { label: '编辑加工', tone: 'green', group: '完结' },
  rejected: { label: '拒稿', tone: 'red', group: '终止' },
  withdrawn: { label: '撤稿', tone: 'slate', group: '终止' },
  transferred: { label: '转投他刊', tone: 'slate', group: '终止' },
};

export const STATUS_OPTIONS = (Object.keys(STATUS_META) as SubmissionStatus[]).map((s) => ({
  value: s,
  label: STATUS_META[s].label,
}));

/** 活跃链路 Stepper 节点（终态不展示步进条） */
export const STEPPER_CHAIN: SubmissionStatus[] = ['submitted', 'initial_review', 'external_review', 'review_returned', 'minor_revision', 're_review', 'final_review', 'accepted', 'in_production'];
export const TERMINAL = new Set<SubmissionStatus>(['rejected', 'withdrawn', 'transferred']);
/** 返修链路状态：出现时需要录入/展示修回截止日 */
export const REVISION_STATUSES = new Set<SubmissionStatus>(['minor_revision', 'major_revision']);

export const fmtDate = (ts?: number | null) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—');
export const todayISO = () => new Date().toISOString().slice(0, 10);

/** 修回截止日倒计时徽章：>=7 天绿，<7 琥珀，<3 红，超期红 + 提醒 */
export function revisionBadge(deadline: number | null): ReactNode {
  if (!deadline) return null;
  const ms = deadline - Date.now();
  const days = Math.ceil(ms / 86400000);
  if (ms < 0) return <Badge tone="red">修回已超期 {-days} 天 · 建议联系编辑部</Badge>;
  const tone: 'green' | 'amber' | 'red' = days < 3 ? 'red' : days < 7 ? 'amber' : 'green';
  return <Badge tone={tone}>修回剩 {days} 天</Badge>;
}

/** 按 open 审稿意见的 category 推断应推进到的投稿状态（与既有 major/minor 枚举对齐） */
export function inferStatusFromComments(comments: { category?: string | null }[]): SubmissionStatus {
  const cats = comments.map((c) => (c.category || '').toLowerCase());
  if (cats.some((c) => /major|大修|大改/.test(c))) return 'major_revision';
  if (cats.some((c) => /minor|小修|小改/.test(c))) return 'minor_revision';
  return 'external_review';
}
