/**
 * 修改计划执行队列：纯类型 + 章节匹配。
 *
 * 队列本身挂在 document.revision_queue（JSON），不新建表：
 * - 单文档同一时间只跑一队，天然随文档删除/复制；
 * - 每个条目保存 before/after 正文，前端可直接展示逐条 diff；
 * - 运行态由后台 async 循环推进，前端轮询队列状态。
 */

export type RevisionQueueStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped';
export type RevisionQueueItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface RevisionQueueInput {
  /** 评审计划条目 id（如 R1），仅用于回链展示 */
  planItemId?: string;
  /** 目标章节标题；为空时按 excerpt/suggestedAction 在正文标题中匹配 */
  sectionTitle?: string;
  /** 实际交给改写模型的要求；为空时用 excerpt + suggestedAction */
  reviewPoints?: string;
  excerpt?: string;
  suggestedAction?: string;
}

export interface RevisionQueueItem {
  id: string;
  planItemId: string;
  sectionTitle: string;
  reviewPoints: string;
  status: RevisionQueueItemStatus;
  error: string;
  before: string;
  after: string;
  changed: boolean;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RevisionQueue {
  id: string;
  documentId: string;
  status: RevisionQueueStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  items: RevisionQueueItem[];
}

/**
 * 从计划条目中定位章节：
 * - 显式 sectionTitle 必须与正文标题完全一致才采用（避免拼错章节）；
 * - 否则在 excerpt + suggestedAction 中找最长命中的标题；
 * - 未命中返回空串，由调用方标记 skipped，绝不默认改第一节。
 */
export function inferSectionTitle(input: RevisionQueueInput, sectionTitles: string[]): string {
  const explicit = (input.sectionTitle || '').trim();
  if (explicit) return sectionTitles.includes(explicit) ? explicit : '';
  const hay = `${input.excerpt || ''}\n${input.suggestedAction || ''}`.toLowerCase();
  let best = '';
  for (const title of sectionTitles) {
    const needle = title.trim();
    if (!needle) continue;
    if (hay.includes(needle.toLowerCase()) && needle.length > best.length) best = needle;
  }
  return best;
}

/** 构造一个空白队列（id/时间由调用方注入，便于测试确定性）。 */
export function createRevisionQueue(
  documentId: string,
  queueId: string,
  items: RevisionQueueItem[],
  now: number,
): RevisionQueue {
  return {
    id: queueId,
    documentId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    items,
  };
}
