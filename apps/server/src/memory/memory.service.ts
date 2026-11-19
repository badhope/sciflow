import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { eq, desc, like, and, SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { memoryLogs, type MemoryLog } from '../db/schema';
import { parseStringList } from '../common/json-guard';
import { EmbeddingService } from '../knowledge/embedding.service';

export type MemoryType = 'episodic' | 'procedural';
export type MemoryMatchMode = 'semantic' | 'lexical' | 'hybrid' | 'recent';

export interface MemoryRecallHit {
  id: string;
  type: string;
  projectId: string | null;
  content: string;
  keywords: string[];
  createdAt: number;
  score: number;
  match: MemoryMatchMode;
}

/** 把 text 拆成中英混排可比较的检索单元（中文按字二元组，英文按词 + 二元组）。 */
function termsOf(text: string): string[] {
  const cleaned = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (const token of tokens) {
    if (token.length <= 8) out.add(token);
    const chars = Array.from(token);
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
  }
  return [...out];
}

function lexicalScore(queryTerms: string[], text: string): number {
  if (!queryTerms.length) return 0;
  const docTerms = new Set(termsOf(text));
  if (!docTerms.size) return 0;
  let hit = 0;
  for (const term of queryTerms) if (docTerms.has(term)) hit += 1;
  return hit / Math.sqrt(queryTerms.length * docTerms.size);
}

/** Buffer（float32 小端 BLOB）→ 数值向量；长度不合法直接返回 null，不抛。 */
function decodeVector(blob: unknown): number[] | null {
  if (!(blob instanceof Uint8Array) || blob.byteLength < 8 || blob.byteLength % 4 !== 0) return null;
  try {
    const copy = Buffer.from(blob);
    const arr = new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
    return Array.from(arr);
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * 记忆服务（Agentic Memory）
 * - episodic 情景记忆：流水线/研究循环完成时沉淀（主题、结论、失败原因）
 * - procedural 程序记忆：用户维护的写作/研究方法指令
 *
 * 检索不只看关键词：有嵌入后端时用向量余弦召回，没有时自动降级为中英字面匹配；
 * 两种信号同时命中会标为 hybrid。历史行没有向量时在召回时懒补，不阻塞写入。
 */
@Injectable()
export class MemoryService {
  constructor(@Optional() private readonly embedding?: EmbeddingService) {}

  /** 新增记忆（主要供程序记忆：写作风格指令） */
  add(type: MemoryType, content: string, projectId?: string, keywords: string[] = []) {
    if (!content.trim()) throw new BadRequestException('记忆内容不能为空');
    const row = {
      id: randomUUID(),
      type,
      projectId: projectId || null,
      content: content.trim(),
      keywords: JSON.stringify(keywords.slice(0, 10)),
      createdAt: Date.now(),
    };
    db.insert(memoryLogs).values(row).run();
    return { ...row, keywords };
  }

  private dto(row: MemoryLog): Omit<MemoryRecallHit, 'score' | 'match'> {
    const { embedding: _embedding, ...rest } = row;
    return { ...rest, keywords: parseStringList(row.keywords) };
  }

  /** 记忆列表（按类型 + 项目 + 关键词过滤；不做语义计算，供 UI 直读） */
  list(type?: MemoryType, q?: string, projectId?: string): MemoryRecallHit[] {
    const conds: SQL[] = [];
    if (type) conds.push(eq(memoryLogs.type, type));
    if (projectId) conds.push(eq(memoryLogs.projectId, projectId));
    if (q && q.trim()) conds.push(like(memoryLogs.keywords, `%${q.trim()}%`));
    const where = conds.length ? and(...conds) : undefined;
    const rows = where
      ? db.select().from(memoryLogs).where(where).orderBy(desc(memoryLogs.createdAt)).all()
      : db.select().from(memoryLogs).orderBy(desc(memoryLogs.createdAt)).all();
    return rows.map((r) => ({ ...this.dto(r), score: 0, match: 'recent' as const }));
  }

  /**
   * 语义记忆召回：
   * 1) 先在项目内取最近 200 条（防止全库扫）；
   * 2) 有 embedding 时算 query 向量，给缺失历史行懒补向量；
   * 3) 语义分 0.7 + 字面分 0.3，按分数倒序；空 query 直接按时间倒序。
   *
   * 嵌入服务不可用 / 维度不符 / 请求失败时全部退回字面分，不阻塞 Chat 与 MCP。
   */
  async recall(projectId: string, query = '', limit = 6, type?: MemoryType): Promise<MemoryRecallHit[]> {
    if (!projectId) throw new BadRequestException('projectId 不能为空');
    const conds: SQL[] = [eq(memoryLogs.projectId, projectId)];
    if (type) conds.push(eq(memoryLogs.type, type));
    const rows = db
      .select()
      .from(memoryLogs)
      .where(and(...conds))
      .orderBy(desc(memoryLogs.createdAt))
      .limit(200)
      .all();

    const q = query.trim();
    if (!q) {
      return rows.slice(0, limit).map((r) => ({ ...this.dto(r), score: 0, match: 'recent' as const }));
    }

    const queryTerms = termsOf(q);
    let queryVec: number[] | null = null;
    let semanticReady = false;
    if (this.embedding) {
      try {
        const qBlob = await this.embedding.embed(q);
        queryVec = decodeVector(qBlob);
        if (queryVec) {
          const missing = rows.filter((r) => !decodeVector(r.embedding));
          if (missing.length) {
            const blobs = await this.embedding.embedBatch(missing.map((r) => r.content));
            missing.forEach((row, i) => {
              const blob = blobs[i];
              if (!blob) return;
              row.embedding = blob;
              try {
                db.update(memoryLogs).set({ embedding: blob }).where(eq(memoryLogs.id, row.id)).run();
              } catch {
                /* 单条向量写入失败不影响召回 */
              }
            });
          }
          semanticReady = true;
        }
      } catch {
        semanticReady = false;
      }
    }

    const scored = rows.map((row) => {
      const vector = decodeVector(row.embedding);
      const lexical = lexicalScore(queryTerms, `${row.content} ${row.keywords || ''}`);
      const semantic = semanticReady && queryVec && vector ? cosine(queryVec, vector) : 0;
      const score = semanticReady && vector ? semantic * 0.7 + lexical * 0.3 : lexical;
      const match: MemoryMatchMode = semanticReady && vector && lexical > 0 ? 'hybrid' : semanticReady && vector ? 'semantic' : 'lexical';
      return { ...this.dto(row), score, match };
    });

    scored.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
    return scored.slice(0, limit);
  }

  remove(id: string) {
    const row = db.select().from(memoryLogs).where(eq(memoryLogs.id, id)).get();
    if (!row) throw new NotFoundException('记忆不存在');
    db.delete(memoryLogs).where(eq(memoryLogs.id, id)).run();
    return { ok: true };
  }
}
