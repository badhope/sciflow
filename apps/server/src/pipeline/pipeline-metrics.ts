/**
 * 流水线与指标口径的纯函数（集中放置，便于单测锁定语义）。
 */

/**
 * 知识库检索分归一化。
 *
 * 契约来源：packages/retrieval/src/knowledge.service.ts 的 search() 返回
 * `score: Math.max(1, Math.round((rrf / topScore) * 100))` —— **百分制（1-100）**。
 * v1.0.0 之前这里除以 8，任何 ≥8 分的命中都会被夹到 1.0，跨库匹配度完全失去区分度
 * （且与本地文献库的 0-1 口径不可比）。
 */
export function normalizeKnScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, Math.round((score / 100) * 100) / 100));
}

/**
 * Agent 用量按日聚合的日期键：**本地时区** YYYY-MM-DD。
 *
 * 历史问题：用 toISOString()（UTC）切日，与 usage.service 的
 * `date(created_at/1000,'unixepoch','localtime')` 口径不一致，东八区用户在
 * 00:00-08:00 之间的调用会被算到前一天，两张报表对不上。
 */
export function normalizeAgentDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
