/**
 * CitationRenderer — pure logic for rendering [Ref:N] numbered citations.
 *
 * Extracted from PipelineService to keep citation-rendering logic self-contained
 * and testable.  Not @Injectable — instantiated directly by PipelineService.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema';
import { references, citations } from '../db/schema';
import type { Reference } from '../db/schema';
import type { PaperHit } from '../references/references.service';

/** Location + context snapshot for a single citation anchor */
export interface CitationSpot {
  location: string;
  context: string;
}

/** Result of scanning a document body for citation anchors */
export interface CitationScanResult {
  poolSpot: Map<number, CitationSpot>;
  suppSpot: Map<number, CitationSpot>;
}

export class CitationRenderer {
  constructor(
    private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  /**
   * 把正文里的 [Ref:N] / [补充Ref:N] 锚点重编号为 [1]、[2]…，并回填 citations 表。
   * 正文不再生成参考文献列表（列表由前端按用户选中的 CSL 样式统一渲染）。
   * Side-effect: back-fills citation rows.
   */
  render(
    documentId: string,
    content: string,
    refPool: Reference[],
    supplementHits: PaperHit[] = [],
    suppRefIds: (string | null)[] = [],
    knowledgeHits: PaperHit[] = [],
  ): string {
    if (!content) return content;
    const refs = refPool;
    const { poolSpot, suppSpot } = this.scanCitationSpots(content, refs.length, supplementHits.length);
    const used = new Set<number>();
    content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; if (refs[idx]) used.add(idx); return ''; });
    const order = [...used].sort((a, b) => a - b);
    const numOf = new Map(order.map((idx, k) => [idx, k + 1]));
    const usedSupp = new Set<number>();
    content.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; if (supplementHits[idx]) usedSupp.add(idx); return ''; });
    const suppOrder = [...usedSupp].sort((a, b) => a - b);
    const base = order.length;
    const suppNum = new Map(suppOrder.map((idx, k) => [idx, base + k + 1]));

    let out = content.replace(/\[Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; return numOf.has(idx) ? `[${numOf.get(idx)}]` : `[文献${n}]`; });
    out = out.replace(/\[补充Ref:(\d+)\]/g, (_m, n: string) => { const idx = Number(n) - 1; return suppNum.has(idx) ? `[${suppNum.get(idx)}]` : '[补充文献]'; });

    const blocks: string[] = [];
    // 注意：不再把参考文献列表写进正文。
    // 历史 bug：这里拼一份硬编码 GB/T 形态的列表，前端 WritingPreview 又按用户选中的样式拼一份，
    // 流水线产物打开后出现两个"参考文献"区且格式不同。
    // 现在正文只保留 [n] 锚点，列表由前端按当前样式统一渲染（数据源是 citations 表）。
    if (knowledgeHits.length) {
      const knLines = knowledgeHits.map((k) => `- 《${k.title}》（知识库 · 匹配 ${(k.matchScore ?? 0).toFixed(2)}）：${(k.abstract || '').slice(0, 100).trim()}`).join('\n');
      blocks.push(`### 知识库参考（研究阶段本地检索）\n\n${knLines}`);
    }
    if (blocks.length) out += `\n\n## 研究资料\n\n${blocks.join('\n\n')}`;

    this.backfillCitations(documentId, refs, order, suppOrder, suppRefIds, poolSpot, suppSpot);
    return out;
  }

  /** Find all [Ref:N] / [补充Ref:N] anchors and record their section + context */
  scanCitationSpots(content: string, poolSize: number, suppSize: number): CitationScanResult {
    const poolSpot = new Map<number, CitationSpot>();
    const suppSpot = new Map<number, CitationSpot>();
    /**
     * 标题分支的正文必须**在锚点前停住**（`(?!(\[Ref:|\[补充Ref:))` 负向前瞻）。
     *
     * 历史缺陷：原写法 `(#{1,6}\s+[^\n]+)` 里的 `[^\n]+` 会一路吃到行尾，把同一行上的
     * 引用锚点整个吞掉。于是「锚点写在标题行」这种形态（如 `## 结论 [Ref:3]`）下：
     *   - render() 的两趟 replace 仍会给它编号成 [3]（走的是独立正则，不受影响）；
     *   - 但 poolSpot 里查不到该 idx → backfillCitations 拿到 undefined →
     *     citations 行的 location / context 落成空串。
     * 结果是「引用三级可追溯」的证据链静默残缺：编号对、文献对，就是查不到这条引用
     * 出现在哪一节、上下文是什么，而且不报错、不告警。
     */
    const tokenRe = /(#{1,6}\s+(?:(?!\[Ref:|\[补充Ref:)[^\n])+)|\[Ref:(\d+)\]|\[补充Ref:(\d+)\]/g;
    let m: RegExpExecArray | null;
    let section = '';
    while ((m = tokenRe.exec(content)) !== null) {
      if (m[1] !== undefined) section = m[1].replace(/^#{1,6}\s+/, '').trim();
      else if (m[2] !== undefined) { const idx = Number(m[2]) - 1; if (idx >= 0 && idx < poolSize && !poolSpot.has(idx)) poolSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) }); }
      else if (m[3] !== undefined) { const idx = Number(m[3]) - 1; if (idx >= 0 && idx < suppSize && !suppSpot.has(idx)) suppSpot.set(idx, { location: section, context: this.contextAround(content, m.index, m[0].length) }); }
    }
    return { poolSpot, suppSpot };
  }

  /** Persist citation rows (idempotent; skips existing refs) */
  backfillCitations(
    documentId: string,
    refs: Reference[],
    order: number[],
    suppOrder: number[],
    suppRefIds: (string | null)[],
    poolSpot: Map<number, CitationSpot>,
    suppSpot: Map<number, CitationSpot>,
  ): void {
    try {
      const existing = this.db.select().from(citations).where(eq(citations.documentId, documentId)).all();
      const have = new Set(existing.map((c) => c.referenceId));
      // createdAt 递增 1ms：同一批插入若共用时间戳，`ORDER BY createdAt` 的先后就不稳定，
      // 正文 [n] 与列表第 n 条可能错位。用递增时间保证插入序 = 正文首次出现序。
      let stamp = Date.now();
      const insertOne = (referenceId: string, spot: CitationSpot | undefined, doi: string) => {
        if (!referenceId || have.has(referenceId)) return;
        this.db
          .insert(citations)
          .values({ id: randomUUID(), documentId, referenceId, location: spot?.location || '', context: spot?.context || '', format: 'pipeline', verified: doi ? 1 : 0, createdAt: stamp })
          .run();
        have.add(referenceId);
        stamp += 1;
      };
      for (const idx of order) { const r = refs[idx]; if (!r) continue; insertOne(r.id, poolSpot.get(idx), r.doi || ''); }
      for (const idx of suppOrder) {
        const refId = suppRefIds[idx];
        if (!refId) continue;
        const ref = this.db.select().from(references).where(eq(references.id, refId)).get();
        insertOne(refId, suppSpot.get(idx), ref?.doi || '');
      }
    } catch {
      // swallow — citation back-fill is best-effort
    }
  }

  private contextAround(text: string, at: number, len: number): string {
    return text.slice(Math.max(0, at - 40), Math.min(text.length, at + len + 40)).replace(/\s+/g, ' ').trim();
  }
}
