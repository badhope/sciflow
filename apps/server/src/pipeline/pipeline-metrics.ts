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

/**
 * 选题重叠度（新颖性预检用，v1.7）。
 *
 * 口径：以「选题 token 集合」为分母，取候选论文标题的 token 覆盖率的最大值（0-100）。
 * 为什么不用 Jaccard：候选标题通常远长于选题（含副标题/数据集名），Jaccard 会被长标题
 * 系统性摊薄——同一篇同题论文可能只算出 40 分，反而被判"较新颖"，这是假绿灯。
 *
 * token 规则与 ScholarSearchService 的相关性门禁一致：拉丁词 ≥2 字符 + 中文二元组。
 */
export function tokenizeForMatch(text: string): string[] {
  const low = (text || '').toLowerCase();
  const out: string[] = [];
  for (const m of low.matchAll(/[a-z][a-z0-9_-]{1,}/g)) out.push(m[0]);
  const cn = low.replace(/[^一-龥]/g, '');
  for (let i = 0; i < cn.length - 1; i++) out.push(cn.slice(i, i + 2));
  return out;
}

export function noveltyOverlap(topic: string, titles: string[]): number {
  const topicTokens = new Set(tokenizeForMatch(topic));
  if (!topicTokens.size || !titles.length) return 0;
  let best = 0;
  for (const title of titles) {
    const titleTokens = new Set(tokenizeForMatch(title));
    let hit = 0;
    for (const t of topicTokens) if (titleTokens.has(t)) hit += 1;
    best = Math.max(best, Math.round((hit / topicTokens.size) * 100));
  }
  return Math.min(100, best);
}
