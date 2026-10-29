/**
 * MMR（Maximal Marginal Relevance）多样性重排 — 纯函数，零依赖。
 *
 * 为什么需要：RRF 融合后的 TopK 经常被「同一篇文档的相邻分块」占满
 * （知识库按 800 字切块、15% 重叠），用户看到 5 条来源其实是同一段话的 5 个切片；
 * 生成端也拿不到互补信息。MMR 在「相关性」与「新颖性」之间做贪心折中：
 *
 *   score(d) = λ · rel(d) − (1−λ) · max_{s∈S} sim(d, s)
 *
 * 其中 rel 用检索分（RRF 归一化），sim 用向量余弦；没有向量时退化为「文本前缀去重 + 相关度排序」。
 * 这与 PaperQA2 的「先超召回再精挑」思路一致，但只在本地做、零 LLM 成本。
 */

export interface MmrCandidate {
  id: string;
  /** 检索相关度（越大越相关）；调用方负责归一化到 0-1（不归一化也能工作，只是量纲不一致时 λ 语义会变） */
  relevance: number;
  /** 文本（无向量时的退化信号：前缀重复视为冗余） */
  text?: string;
  /** 向量（可选；有则用余弦，无则用文本前缀相似度） */
  vector?: number[] | null;
}

export interface MmrOptions {
  /** 相关性与多样性的折中；0.7 = 偏相关（默认），0.5 = 均衡，0.9 = 几乎只按相关度 */
  lambda?: number;
  /** 参与 MMR 的候选上限（防止 O(n²) 在大召回上爆掉） */
  maxCandidates?: number;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 无向量时的退化相似度：前 80 字完全相同 → 1；否则按字符 3-gram Jaccard（0-1） */
function textSimilarity(a: string, b: string): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x.slice(0, 80) === y.slice(0, 80)) return 1;
  const grams = (s: string): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
    return out;
  };
  const gx = grams(x);
  const gy = grams(y);
  if (!gx.size || !gy.size) return 0;
  let inter = 0;
  for (const g of gx) if (gy.has(g)) inter += 1;
  return inter / (gx.size + gy.size - inter);
}

/**
 * 贪心 MMR 选择。
 * @returns 选择顺序的候选（最多 k 条）；候选不足时原样返回。
 */
export function mmrSelect<T extends MmrCandidate>(candidates: T[], k: number, opts: MmrOptions = {}): T[] {
  const lambda = Math.min(1, Math.max(0, opts.lambda ?? 0.7));
  const limit = Math.max(1, Math.floor(opts.maxCandidates ?? 40));
  const pool = [...candidates].slice(0, limit);
  const want = Math.max(0, Math.floor(k));
  if (want === 0 || pool.length === 0) return [];
  if (pool.length <= want) return pool;

  const sim = (a: T, b: T): number =>
    a.vector && b.vector && a.vector.length && a.vector.length === b.vector.length
      ? cosine(a.vector, b.vector)
      : textSimilarity(a.text || '', b.text || '');

  const selected: T[] = [];
  const remaining = new Set(pool.map((_, i) => i));

  // 第一条永远取最相关的（避免 λ 较小时随机性）
  let firstIdx = 0;
  for (let i = 1; i < pool.length; i++) if (pool[i].relevance > pool[firstIdx].relevance) firstIdx = i;
  selected.push(pool[firstIdx]);
  remaining.delete(firstIdx);

  while (selected.length < want && remaining.size > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (const i of remaining) {
      const cand = pool[i];
      let maxSim = 0;
      for (const s of selected) {
        const v = sim(cand, s);
        if (v > maxSim) maxSim = v;
      }
      const score = lambda * cand.relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    selected.push(pool[bestIdx]);
    remaining.delete(bestIdx);
  }
  return selected;
}

/** 归一化：把分数线性映射到 0-1（min-max）；全等时统一给 1 */
export function normalizeScores(scores: number[]): number[] {
  if (!scores.length) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-12) return scores.map(() => 1);
  return scores.map((s) => (s - min) / (max - min));
}
