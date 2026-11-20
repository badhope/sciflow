/**
 * 跨 chunk passage 构建（纯函数，无 IO）。
 *
 * 背景：知识库按 800 字切块，单个 chunk 能命中「方法」里的一个论点，却看不到
 * 紧邻的前后文，长方法节因此被切碎。这里以命中块为锚点取前后 N 块，按文档
 * 合并重叠窗口、去掉切块重叠文本，输出可直接交给生成端的 passage。
 *
 * 约束：
 * - 永不跨文档拼接；
 * - 只合并 seq 连续或重叠的窗口，且合并后不超过 maxChars；
 * - 章节边界不猜：窗口内原文保留，标题行不会被删除。
 */

export interface PassageHit {
  id: string;
  docId: string;
  docName: string;
  seq: number;
  content: string;
  context?: string | null;
  score: number;
}

export interface PassageChunk {
  id: string;
  docId: string;
  seq: number;
  content: string;
  context?: string | null;
}

export interface Passage {
  /** 锚点命中块 id（合并窗口时保留得分最高的一块） */
  id: string;
  docId: string;
  docName: string;
  /** 锚点块 seq，保留旧来源卡片字段语义 */
  seq: number;
  /** 扩展窗口起止块序号（含端点） */
  startSeq: number;
  endSeq: number;
  /** 去重叠后的跨块正文 */
  content: string;
  /** 窗口内全部块 id（按 seq 升序） */
  chunkIds: string[];
  /** 实际命中块 id（可能多于一个） */
  matchedChunkIds: string[];
  chunkCount: number;
  score: number;
  context: string | null;
}

export interface PassageOptions {
  /** 前后各扩几块；0 = 不扩展。默认 1 */
  contextChunks?: number;
  /** 单条 passage 正文字符上限，默认 4000 */
  maxChars?: number;
}

const MAX_CONTEXT_CHUNKS = 3;
const MIN_OVERLAP = 12;
const MAX_OVERLAP = 240;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 去掉相邻 chunk 因切块 overlap 产生的重复前缀；过短的重合视为正常重复用词，不删 */
export function joinChunkTexts(contents: string[]): string {
  const parts: string[] = [];
  for (const raw of contents) {
    const next = (raw || '').trim();
    if (!next) continue;
    if (parts.length === 0) {
      parts.push(next);
      continue;
    }
    const prev = parts[parts.length - 1];
    const max = Math.min(prev.length, next.length, MAX_OVERLAP);
    let overlap = 0;
    for (let len = max; len >= MIN_OVERLAP; len -= 1) {
      if (prev.endsWith(next.slice(0, len))) {
        overlap = len;
        break;
      }
    }
    parts.push(overlap > 0 ? next.slice(overlap) : next);
  }
  return parts.join('\n\n').trim();
}

interface InternalPassage extends Passage {
  chunks: PassageChunk[];
}

function sortChunks(chunks: PassageChunk[]): PassageChunk[] {
  return [...chunks].sort((a, b) => a.seq - b.seq);
}

function uniqueChunks(chunks: PassageChunk[]): PassageChunk[] {
  const seen = new Set<string>();
  const out: PassageChunk[] = [];
  for (const c of chunks) {
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return sortChunks(out);
}

/**
 * 以每条命中为锚点扩窗，再按文档合并重叠/连续窗口。
 * 返回按相关度降序的 passage，数量可能少于命中数（同文档相邻命中会合并）。
 */
export function buildPassages(
  hits: PassageHit[],
  chunks: PassageChunk[],
  options: PassageOptions = {},
): Passage[] {
  if (!Array.isArray(hits) || hits.length === 0) return [];
  const radius = clamp(Math.floor(options.contextChunks ?? 1), 0, MAX_CONTEXT_CHUNKS);
  const maxChars = clamp(Math.floor(options.maxChars ?? 4000), 1000, 12000);

  const byDoc = new Map<string, PassageChunk[]>();
  for (const c of uniqueChunks(chunks)) {
    const list = byDoc.get(c.docId) || [];
    list.push(c);
    byDoc.set(c.docId, list);
  }

  const windows: InternalPassage[] = [];
  for (const hit of hits) {
    const docChunks = sortChunks(byDoc.get(hit.docId) || []);
    const hitChunk: PassageChunk = {
      id: hit.id,
      docId: hit.docId,
      seq: Number(hit.seq) || 0,
      content: hit.content || '',
      context: hit.context ?? null,
    };
    // 命中块可能不在邻居查询结果里（例如只查了窗口但命中块被删）：补回锚点，保证窗口不丢命中正文
    if (!docChunks.some((c) => c.id === hitChunk.id)) docChunks.push(hitChunk);
    const sorted = sortChunks(docChunks);
    const anchorSeq = hitChunk.seq;
    const startSeq = Math.max(0, anchorSeq - radius);
    const endSeq = anchorSeq + radius;
    const picked = sorted.filter((c) => c.seq >= startSeq && c.seq <= endSeq);
    if (picked.length === 0) picked.push(hitChunk);
    const content = joinChunkTexts(picked.map((c) => c.content)).slice(0, maxChars);
    windows.push({
      id: hit.id,
      docId: hit.docId,
      docName: hit.docName,
      seq: anchorSeq,
      startSeq: picked[0]?.seq ?? anchorSeq,
      endSeq: picked[picked.length - 1]?.seq ?? anchorSeq,
      content,
      chunkIds: picked.map((c) => c.id),
      matchedChunkIds: [hit.id],
      chunkCount: picked.length,
      score: Number(hit.score) || 0,
      context: hit.context ?? picked.find((c) => c.context)?.context ?? null,
      chunks: picked,
    });
  }

  // 同文档窗口按 seq 排序后合并：重叠一至多块、或正文合并后仍在预算内才合并
  const merged: InternalPassage[] = [];
  for (const win of windows.sort((a, b) => (a.docId === b.docId ? a.startSeq - b.startSeq : a.docId.localeCompare(b.docId)))) {
    const prev = merged[merged.length - 1];
    if (!prev || prev.docId !== win.docId || win.startSeq > prev.endSeq + 1) {
      merged.push(win);
      continue;
    }
    const chunksUnion = uniqueChunks([...prev.chunks, ...win.chunks]);
    const content = joinChunkTexts(chunksUnion.map((c) => c.content));
    if (content.length > maxChars) {
      merged.push(win);
      continue;
    }
    const winner = win.score > prev.score ? win : prev;
    prev.id = winner.id;
    prev.seq = winner.seq;
    prev.startSeq = Math.min(prev.startSeq, win.startSeq);
    prev.endSeq = Math.max(prev.endSeq, win.endSeq);
    prev.content = content;
    prev.chunks = chunksUnion;
    prev.chunkIds = chunksUnion.map((c) => c.id);
    prev.matchedChunkIds = [...new Set([...prev.matchedChunkIds, ...win.matchedChunkIds])];
    prev.chunkCount = chunksUnion.length;
    prev.score = Math.max(prev.score, win.score);
    prev.context = winner.context ?? prev.context;
  }

  return merged
    .sort((a, b) => b.score - a.score || a.startSeq - b.startSeq)
    .map(({ chunks: _chunks, ...p }) => p);
}
