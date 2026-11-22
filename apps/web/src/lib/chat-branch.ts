/**
 * 对话分支树纯函数。
 *
 * 存储仍是“节点平铺数组 + parentId”，不引入递归 CTE；界面只渲染 activeLeaf 到根的一条路径。
 * 这样编辑/重新生成只追加 sibling，不截断历史，A2 的三个回答版本可以来回切换。
 */

export interface BranchNode {
  id?: string;
  parentId?: string | null;
  role?: string;
  createdAt?: number;
}

export interface BranchMeta {
  /** 当前节点在 sibling 中的序号（0 起） */
  index: number;
  /** sibling 总数 */
  count: number;
  ids: string[];
}

let seq = 0;

export function newMessageId(prefix = 'm'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

/**
 * 补齐旧会话的 id/parentId，并选出可恢复的 activeLeaf。
 * - 旧线性消息：parentId 默认指向数组中的上一条；
 * - 已有 parentId：保留（允许根节点显式 null，形成多个根分支）；
 * - 悬空 parentId：降级为根，避免渲染时静默丢消息。
 */
export function normalizeMessageTree<T extends BranchNode>(
  items: T[],
  preferredLeafId?: string | null,
): { items: T[]; leafId: string | null } {
  const seen = new Set<string>();
  const ids = items.map((item, index) => {
    let id = typeof item.id === 'string' && item.id.trim() ? item.id : '';
    if (!id || seen.has(id)) id = newMessageId(`m${index}`);
    seen.add(id);
    return id;
  });
  const normalized = items.map((item, index) => {
    const parent = item.parentId;
    const nextParent = parent === null
      ? null
      : typeof parent === 'string' && parent && seen.has(parent) && parent !== ids[index]
        ? parent
        : index > 0
          ? ids[index - 1]
          : null;
    return { ...item, id: ids[index], parentId: nextParent } as T;
  });

  const byId = new Map(normalized.map((m) => [m.id!, m]));
  // 悬空父引用降级为根；同时断开环，防止 path 死循环。
  for (const m of normalized) {
    if (m.parentId && !byId.has(m.parentId)) m.parentId = null;
    const chain = new Set<string>([m.id!]);
    let cursor: string | null = m.parentId ?? null;
    while (cursor) {
      if (chain.has(cursor)) {
        m.parentId = null;
        break;
      }
      chain.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const preferred = preferredLeafId && byId.has(preferredLeafId) ? preferredLeafId : null;
  const leafId = preferred ?? normalized[normalized.length - 1]?.id ?? null;
  return { items: normalized, leafId };
}

/** activeLeaf 到根的一条路径（根在前）。 */
export function pathToLeaf<T extends BranchNode>(items: T[], leafId: string | null): T[] {
  if (!leafId) return [];
  const byId = new Map(items.filter((m) => m.id).map((m) => [m.id!, m]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leafId;
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    path.push(node);
    cursor = node.parentId ?? null;
  }
  return path.reverse();
}

/** 同父、同角色的版本兄弟；数组顺序即创建顺序。 */
export function siblingsOf<T extends BranchNode>(items: T[], id: string): T[] {
  const node = items.find((m) => m.id === id);
  if (!node) return [];
  return items.filter((m) => (m.parentId ?? null) === (node.parentId ?? null) && (m.role ?? '') === (node.role ?? ''))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function branchMeta<T extends BranchNode>(items: T[]): Record<string, BranchMeta> {
  const groups = new Map<string, T[]>();
  for (const node of items) {
    if (!node.id) continue;
    const key = `${node.parentId ?? 'root'}:${node.role ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  const result: Record<string, BranchMeta> = {};
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group
      .slice()
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
      .forEach((node, index) => {
        result[node.id!] = { index, count: group.length, ids: group.map((m) => m.id!) };
      });
  }
  return result;
}

/** 从某节点往下选最新一条后代，作为切换分支后的 activeLeaf。 */
export function bestLeaf<T extends BranchNode>(items: T[], nodeId: string): string {
  let current = nodeId;
  const seen = new Set<string>([current]);
  for (;;) {
    const children = items.filter((m) => m.parentId === current);
    if (!children.length) return current;
    const sorted = children.slice().sort((a, b) => {
      const delta = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      return delta !== 0 ? delta : items.indexOf(a) - items.indexOf(b);
    });
    const next = sorted[sorted.length - 1];
    if (!next.id || seen.has(next.id)) return current;
    seen.add(next.id);
    current = next.id;
  }
}

/** 切换当前消息的版本：返回目标 sibling 的最深叶子 id；越界返回 null。 */
export function switchBranchTarget<T extends BranchNode>(items: T[], id: string, direction: -1 | 1): string | null {
  const siblings = siblingsOf(items, id);
  if (siblings.length < 2) return null;
  const index = siblings.findIndex((m) => m.id === id);
  if (index < 0) return null;
  const target = siblings[index + direction];
  return target?.id ? bestLeaf(items, target.id) : null;
}

/** 删除节点及其全部后代（删除分支不影响其他分支）。 */
export function removeSubtree<T extends BranchNode>(items: T[], nodeId: string): T[] {
  const doomed = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.id && item.parentId && doomed.has(item.parentId) && !doomed.has(item.id)) {
        doomed.add(item.id);
        changed = true;
      }
    }
  }
  return items.filter((m) => !m.id || !doomed.has(m.id));
}

/** 持久化用的分支状态。 */
export function branchState(leafId: string | null): { activeLeafId: string | null } {
  return { activeLeafId: leafId };
}

/** 当前路径上最宽的分支点（用于会话抽屉显示“分支 2/3”）。 */
export function activeBranchSummary<T extends BranchNode>(items: T[], leafId: string | null): { index: number; count: number } | null {
  const metas = branchMeta(items);
  let selected: { index: number; count: number } | null = null;
  for (const node of pathToLeaf(items, leafId)) {
    const meta = node.id ? metas[node.id] : null;
    if (meta && (!selected || meta.count > selected.count)) selected = { index: meta.index, count: meta.count };
  }
  return selected;
}
