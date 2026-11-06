/**
 * 列表分页（纯函数，无 IO）。
 *
 * 兼容性优先：旧调用方不带 limit/offset，此时原样返回全量数组（行为不变）；
 * 带任何分页参数时返回 { items, total, limit, offset, hasMore }。
 * limit 上限 200，防止一次拉爆内存；非法值回落默认 50。
 */

export interface PageResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function normalizeLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function normalizeOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** rawLimit/rawOffset 均为 undefined 时返回全量（旧行为）；否则切页。 */
export function paginate<T>(rows: T[], rawLimit?: unknown, rawOffset?: unknown): T[] | PageResult<T> {
  if (rawLimit === undefined && rawOffset === undefined) return rows;
  const limit = normalizeLimit(rawLimit);
  const offset = normalizeOffset(rawOffset);
  const items = rows.slice(offset, offset + limit);
  return { items, total: rows.length, limit, offset, hasMore: offset + items.length < rows.length };
}
