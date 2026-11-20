/**
 * 修改计划执行队列：纯类型 + 章节匹配 + 历史存储。
 *
 * 队列本身仍挂在 document.revision_queue（JSON），不新建表：
 * - 单文档同一时间只跑一队，天然随文档删除/复制；
 * - 队列按 { queues: RevisionQueue[] } 存最近 20 队，旧格式（单队对象）读取时自动兼容；
 * - 每个条目保存 before/after 正文，前端可直接展示逐条 diff；
 * - 运行态由后台 async 循环推进，前端通过 SSE/轮询读取队列状态。
 */

export type RevisionQueueStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped';
export type RevisionQueueItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** 历史队列上限：旧队超过 20 队后从尾部淘汰，避免 document JSON 无限膨胀。 */
export const MAX_REVISION_QUEUES = 20;

export interface RevisionQueueInput {
  /** 评审计划条目 id（如 R1），仅用于回链展示 */
  planItemId?: string;
  /** 目标章节标题；为空时按 excerpt/suggestedAction 在正文标题中匹配 */
  sectionTitle?: string;
  /** 实际交给改写模型的要求；为空时用 excerpt + suggestedAction */
  reviewPoints?: string;
  excerpt?: string;
  suggestedAction?: string;
  /** 关联的 review_comment id；成功改写且内容有变化时自动把该意见置为 resolved */
  reviewCommentId?: string;
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
  /** review_comment.id；为空表示这条计划没有可回链的审稿意见 */
  reviewCommentId: string;
  /** 本次执行是否已把对应审稿意见自动置为 resolved */
  commentResolved: boolean;
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
  /** 队列完成后是否自动 resolve 带 reviewCommentId 的意见 */
  autoResolve: boolean;
  /** 本队自动 resolve 的意见 id 列表（审计/去重用） */
  resolvedCommentIds: string[];
  items: RevisionQueueItem[];
}

/** 队列审计摘要：列表接口只返回它，避免历史队列把整篇 before/after 全量吐给前端。 */
export interface RevisionQueueSummary {
  id: string;
  documentId: string;
  status: RevisionQueueStatus;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
  changed: number;
  resolvedComments: number;
  autoResolve: boolean;
}

export interface RevisionQueueStore {
  queues: RevisionQueue[];
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
  autoResolve = true,
): RevisionQueue {
  return {
    id: queueId,
    documentId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
    autoResolve,
    resolvedCommentIds: [],
    items,
  };
}

/** 单条旧数据归一化：补 reviewCommentId/commentResolved，避免历史 JSON 读崩。 */
function normalizeItem(raw: Partial<RevisionQueueItem> | null | undefined): RevisionQueueItem | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  return {
    id: raw.id,
    planItemId: typeof raw.planItemId === 'string' ? raw.planItemId : '',
    sectionTitle: typeof raw.sectionTitle === 'string' ? raw.sectionTitle : '',
    reviewPoints: typeof raw.reviewPoints === 'string' ? raw.reviewPoints : '',
    status: (raw.status as RevisionQueueItem['status']) || 'pending',
    error: typeof raw.error === 'string' ? raw.error : '',
    before: typeof raw.before === 'string' ? raw.before : '',
    after: typeof raw.after === 'string' ? raw.after : '',
    changed: Boolean(raw.changed),
    reviewCommentId: typeof raw.reviewCommentId === 'string' ? raw.reviewCommentId : '',
    commentResolved: Boolean(raw.commentResolved),
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
    finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : null,
  };
}

/** 单队归一化：旧格式没有 autoResolve/resolvedCommentIds 时补默认值。 */
export function normalizeRevisionQueue(raw: Partial<RevisionQueue> | null | undefined): RevisionQueue | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter((i): i is RevisionQueueItem => Boolean(i)) : [];
  return {
    id: raw.id,
    documentId: typeof raw.documentId === 'string' ? raw.documentId : '',
    status: (raw.status as RevisionQueue['status']) || 'queued',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : null,
    autoResolve: raw.autoResolve !== false,
    resolvedCommentIds: Array.isArray(raw.resolvedCommentIds)
      ? raw.resolvedCommentIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : [],
    items,
  };
}

/**
 * 解析 document.revision_queue 的两种历史形态：
 * 1. 旧格式：单个 RevisionQueue 对象（带 id）；
 * 2. 新格式：{ queues: RevisionQueue[] }。
 * 任何坏值都返回空队列，不让一条历史脏数据阻断文档编辑。
 */
export function normalizeRevisionQueueStore(raw: unknown): RevisionQueueStore {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { queues: [] };
    }
  }
  if (!raw || typeof raw !== 'object') return { queues: [] };
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj.queues)) {
    const queues = obj.queues
      .map((q) => normalizeRevisionQueue(q as Partial<RevisionQueue>))
      .filter((q): q is RevisionQueue => Boolean(q))
      .slice(0, MAX_REVISION_QUEUES);
    return { queues };
  }
  const legacy = normalizeRevisionQueue(obj as Partial<RevisionQueue>);
  return { queues: legacy ? [legacy] : [] };
}

/** 序列化前统一裁剪，保证任何写入路径都不会把历史队列写爆。 */
export function serializeRevisionQueueStore(store: RevisionQueueStore): string {
  return JSON.stringify({ queues: store.queues.slice(0, MAX_REVISION_QUEUES) });
}

/** 审计摘要：列表/历史面板共用，避免每次把 before/after 全文传给前端。 */
export function summarizeRevisionQueue(queue: RevisionQueue): RevisionQueueSummary {
  const counts = {
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  };
  let changed = 0;
  for (const item of queue.items) {
    if (item.status in counts) counts[item.status] += 1;
    if (item.status === 'done' && item.changed) changed += 1;
  }
  return {
    id: queue.id,
    documentId: queue.documentId,
    status: queue.status,
    createdAt: queue.createdAt,
    updatedAt: queue.updatedAt,
    finishedAt: queue.finishedAt,
    total: queue.items.length,
    pending: counts.pending,
    running: counts.running,
    done: counts.done,
    failed: counts.failed,
    skipped: counts.skipped,
    changed,
    resolvedComments: queue.resolvedCommentIds.length,
    autoResolve: queue.autoResolve,
  };
}
