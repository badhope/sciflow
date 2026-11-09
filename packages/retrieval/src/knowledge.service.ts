import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../../db/src/database';
import { sqlite } from '../../db/src/database';
import { knowledgeDocs, knowledgeChunks, references, appSettings } from '../../db/src/schema';
import { eq, inArray, and, asc, sql } from 'drizzle-orm';
import { AiService } from '../../ai/src/ai.service';
import { EmbeddingService } from './embedding.service';
import { fingerprint } from '../../core/src/fingerprint';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { parseAuthors } from '../../core/src/authors';
import { projectTo2D, blobToVector, downsampleIndices } from './projection';
import { mmrSelect, normalizeScores } from './mmr';

const CHUNK_SIZE = 800; // 每块约 800 字（段落聚合，与文档切分逻辑保持一致）
const CHUNK_OVERLAP = 120; // 15% 重叠：块边界处上下文连续，RAG 检索质量关键参数（不可为 0）

/** 文献库↔知识库打通（#5）：列表/检索中嵌入的 reference 摘要 */
interface RefSummary {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
  /** 归一化后的作者串（逗号分隔；无作者为空串） */
  authors: string;
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly ai: AiService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** 文本分块：RecursiveCharacterTextSplitter（@langchain/textsplitters）——按段落→换行→中文句读递归切分到 CHUNK_SIZE */
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    separators: ['\n\n', '\n', '。', '；', '，', ' ', ''],
  });

  private async chunkText(text: string): Promise<string[]> {
    const cleaned = text.replace(/\r/g, '').replace(/[  ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned) return [];
    const parts = await this.splitter.splitText(cleaned);
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  // ---------- 文献库↔知识库打通（#5） ----------
  /** 上传时按标题自动命中项目内已有文献：先指纹精确，再忽略大小写标题兜底；命中不中都可继续（不强绑） */
  private matchReference(projectId: string, title: string): string | null {
    const fp = fingerprint(title);
    const all = db.select().from(references).where(eq(references.projectId, projectId)).all();
    const hit = all.find(
      (r) => (fp && r.fingerprint === fp) || (r.title || '').trim().toLowerCase() === (title || '').trim().toLowerCase(),
    );
    return hit ? hit.id : null;
  }

  /**
   * 差距 #6 补全：标题指纹未命中时，把上传文件名自动建成一条文献（source='knowledge-upload'）并回填 referenceId。
   * 判定逻辑（谨慎防误建）：
   *  1) 标题取 name 去扩展名后 trim，长度必须 ≥ 4；
   *  2) 标题含「笔记/纪要/备忘录/会议/草稿/提纲/notes/memo/minutes/agenda/todo」等词时视为非论文文档，不建；
   *  3) 同项目标题指纹已存在则不重复建（幂等）。
   */
  private autoCreateReference(projectId: string, name: string): string | null {
    const title = (name || '').replace(/\.[a-zA-Z0-9]{1,12}$/, '').trim();
    if (title.length < 4) return null;
    if (/笔记|纪要|备忘录|会议|草稿|提纲|notes?|memo|minutes|agenda|todo/i.test(title)) return null;
    const fp = fingerprint(title);
    if (fp) {
      const dup = db.select().from(references).where(and(eq(references.projectId, projectId), eq(references.fingerprint, fp))).get();
      if (dup) return dup.id;
    }
    const id = randomUUID();
    db.insert(references)
      .values({
        id,
        projectId,
        title,
        authors: '[]',
        year: null,
        venue: '',
        doi: '',
        url: '',
        abstract: '',
        source: 'knowledge-upload',
        tags: '[]',
        citationCount: 0,
        readingStatus: 'unread',
        fingerprint: fp,
        isDuplicateOf: '',
        createdAt: Date.now(),
      })
      .run();
    return id;
  }

  /** 批量取 reference 摘要映射：docId -> RefSummary（列表/检索共用，避免 N+1） */
  private referenceSummaryMap(rows: { referenceId: string | null }[]): Map<string, RefSummary> {
    const refIds = [...new Set(rows.map((r) => r.referenceId).filter((x): x is string => !!x))];
    const map = new Map<string, RefSummary>();
    if (refIds.length === 0) return map;
    for (const r of db.select().from(references).where(inArray(references.id, refIds)).all()) {
      map.set(r.id, {
        id: r.id,
        title: r.title,
        year: r.year,
        venue: r.venue ?? '',
        citationCount: r.citationCount ?? 0,
        authors: this.formatAuthorsForSummary(r.authors),
      });
    }
    return map;
  }

  /** 渲染作者 JSON 为逗号分隔字符串（摘要用）；复用 common/authors 的公共解析，避免对象元素渲染为 [object Object] */
  private formatAuthorsForSummary(authorsJson: string | null): string {
    return parseAuthors(authorsJson).join(', ');
  }

  /** 上传文档（type: text | pdf | markdown；content 为文本或 PDF 的 base64）
   *  RAG 升级：每块生成 BLOB 向量（sqlite-vec ANN 检索）+ 文档上下文前缀（Contextual Retrieval） */
  async upload(projectId: string, name: string, type: string, content: string) {
    let text = '';
    if (type === 'pdf') {
      try {
        // unpdf 2 起只发 ESM（无 CJS 入口），本项目服务端产物是 CommonJS，
        // 因此必须动态 import；模块级 import 会在 require 阶段直接抛 ERR_REQUIRE_ESM。
        const { extractText } = await import('unpdf');
        const buf = new Uint8Array(Buffer.from(content, 'base64'));
        const parsed = await extractText(buf, { mergePages: true });
        text = parsed.text || '';
      } catch (e: any) {
        throw new HttpException(`PDF 解析失败: ${e.message}`, HttpStatus.BAD_REQUEST);
      }
    } else {
      text = content;
    }
    const chunks = await this.chunkText(text);
    if (chunks.length === 0) throw new HttpException('文档内容为空或无法解析', HttpStatus.BAD_REQUEST);

    const docId = randomUUID();
    // 文献库↔知识库打通：先按文档标题指纹命中项目内已有文献回填 referenceId
    let referenceId = this.matchReference(projectId, name);
    if (!referenceId) referenceId = this.autoCreateReference(projectId, name);
    // Contextual Retrieval：文档级上下文描述（文档名 + 首段要点），检索时拼在块前，显著提升命中精度
    const head = text.replace(/\s+/g, ' ').trim().slice(0, 100);
    const context = `【${name}】${head}`;

    // 向量嵌入：为每个 chunk 生成 embedding BLOB（异步批量）
    const embeddings = await this.embedChunks(chunks);

    // 事务写入：doc + chunks + vec0 虚拟表（崩溃时自动回滚，防止"有 doc 无 chunk"的脏数据）
    const insertDoc = sqlite.transaction(() => {
      db.insert(knowledgeDocs).values({
        id: docId,
        projectId,
        name,
        type,
        chunkCount: chunks.length,
        referenceId,
        createdAt: Date.now(),
      }).run();
      const insertChunk = sqlite.prepare(
        `INSERT INTO knowledge_chunk (id, doc_id, content, seq, context, embedding) VALUES (?, ?, ?, ?, ?, ?)`
      );
      const insertVec = sqlite.prepare(
        `INSERT OR REPLACE INTO knowledge_chunks_embedding (chunk_id, embedding) VALUES (?, ?)`
      );
      for (let i = 0; i < chunks.length; i++) {
        const chunkId = randomUUID();
        insertChunk.run(chunkId, docId, chunks[i], i, context, embeddings[i] ?? null);
        // vec0 仅在有向量时写入（无向量则走 LIKE/BM25 兜底检索）
        if (embeddings[i]) insertVec.run(chunkId, embeddings[i]);
      }
    });
    insertDoc();

    return { id: docId, name, chunkCount: chunks.length, referenceId: referenceId || null };
  }

  /** 为多段文本生成 embedding（批量入口；失败位置为 null → 该块只有全文检索） */
  private async embedChunks(texts: string[]): Promise<(Buffer | null)[]> {
    return this.embedding.embedBatch(texts);
  }

  /** 项目知识库列表：每条嵌入绑定文献的摘要（未绑定时 reference=null） */
  /** 全量知识库列表（仅本地单用户模式；企业模式由 controller 拒绝） */
  async listAll() {
    const docs = db.select().from(knowledgeDocs).orderBy(knowledgeDocs.createdAt).all();
    const refMap = this.referenceSummaryMap(docs);
    return docs.map((d) => ({ ...d, reference: d.referenceId ? (refMap.get(d.referenceId) || null) : null }));
  }
  async list(projectId: string) {
    const docs = db
      .select()
      .from(knowledgeDocs)
      .where(eq(knowledgeDocs.projectId, projectId))
      .orderBy(knowledgeDocs.createdAt)
      .all();
    const refMap = this.referenceSummaryMap(docs);
    return docs.map((d) => ({ ...d, reference: d.referenceId ? (refMap.get(d.referenceId) || null) : null }));
  }

  /**
   * 学习复盘取数：按 id 返回文档元信息 + 全部分块正文（按 seq 升序）+ outline。
   * outline 从分块正文里抽取 Markdown 标题（#/##/###）派生；无任何标题时返回 null。
   */
  async get(id: string) {
    const doc = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id)).get();
    if (!doc) throw new HttpException('知识库文档不存在', HttpStatus.NOT_FOUND);
    const chunks = db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.docId, id))
      .orderBy(asc(knowledgeChunks.seq))
      .all();
    const headings: string[] = [];
    for (const c of chunks) {
      for (const line of (c.content || '').split('\n')) {
        const m = line.match(/^\s{0,3}(#{1,3})\s+(\S.*?)\s*$/);
        if (m) {
          const h = m[2].trim();
          if (h && !headings.includes(h)) headings.push(h);
        }
      }
    }
    const outline = headings.length > 0 ? headings.join('\n') : null;
    const refMap = this.referenceSummaryMap([doc]);
    return {
      ...doc,
      chunks: chunks.map((c) => ({ id: c.id, seq: c.seq, content: c.content })),
      outline,
      reference: doc.referenceId ? (refMap.get(doc.referenceId) || null) : null,
    };
  }

  /** 手动绑定/解除文献：入参 referenceId 传 null 即解绑；绑定校验文献必须属于同一项目 */
  async bind(id: string, referenceId: string | null) {
    const doc = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id)).get();
    if (!doc) throw new HttpException('知识库文档不存在', HttpStatus.NOT_FOUND);
    let resolved: string | null = null;
    if (referenceId) {
      const ref = db
        .select()
        .from(references)
        .where(and(eq(references.id, referenceId), eq(references.projectId, doc.projectId)))
        .get();
      if (!ref) throw new HttpException('绑定失败：所选文献不在当前项目内', HttpStatus.BAD_REQUEST);
      resolved = ref.id;
    }
    await db.update(knowledgeDocs).set({ referenceId: resolved }).where(eq(knowledgeDocs.id, id)).run();
    const updated = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, id)).get()!;
    const refMap = this.referenceSummaryMap([updated]);
    return { ...updated, reference: updated.referenceId ? (refMap.get(updated.referenceId) || null) : null };
  }

  async remove(id: string) {
    // 同步清理 vec0 虚拟表
    const chunkRows = db.select({ id: knowledgeChunks.id }).from(knowledgeChunks).where(eq(knowledgeChunks.docId, id)).all();
    const delVec = sqlite.prepare('DELETE FROM knowledge_chunks_embedding WHERE chunk_id = ?');
    for (const c of chunkRows) delVec.run(c.id);
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, id));
    await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
    return { ok: true };
  }

  // ---------- 检索升级：sqlite-vec ANN 向量检索（替代手搓 BM25 + TF 余弦混合） ----------

  /** 向量 ANN 检索（sqlite-vec vec0）：语义召回 TopK */
  private async annSearch(projectId: string, questionEmbedding: Buffer, topK: number): Promise<any[]> {
    try {
      const rows = sqlite
        .prepare(
          `SELECT c.id AS chunk_id, c.doc_id, c.content, c.context, c.seq,
                  d.name AS doc_name, d.reference_id,
                  e.distance
           FROM knowledge_chunks_embedding e
           JOIN knowledge_chunk c ON c.id = e.chunk_id
           JOIN knowledge_doc d ON d.id = c.doc_id
           WHERE d.project_id = ? AND e.embedding MATCH ?
           ORDER BY e.distance ASC
           LIMIT ?`,
        )
        .all(projectId, questionEmbedding, topK + 5) as any[]; // 多召回 5 条留给 rerank/去重
      return rows;
    } catch {
      return []; // vec0 不可用：返回空，由 search() 的 RRF 单路退化处理
    }
  }

  /**
   * FTS5 全文检索（trigram tokenizer + BM25 评分）。
   * 中文查询构造：CJK 连续段按 3-gram 展开、拉丁词直接入词，全部用 OR 连接
   * （trigram 短语查询要求单 token ≥3 字符；OR 保召回，bm25 负责排序）。
   * 无可用 token（如 2 字中文查询）或 FTS 异常时回落 likeSearch（终极兜底）。
   */
  private ftsSearch(projectId: string, question: string, topK: number): any[] {
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return [];
    const tokens = KnowledgeService.buildTrigramQuery(question);
    if (!tokens) return this.likeSearch(projectId, question, topK);
    try {
      const rows = sqlite
        .prepare(
          `SELECT f.chunk_id AS chunk_id, c.doc_id AS doc_id, c.content AS content,
                  c.context AS context, c.seq AS seq,
                  d.name AS doc_name, d.reference_id AS reference_id,
                  bm25(knowledge_chunk_fts) AS score
           FROM knowledge_chunk_fts f
           JOIN knowledge_chunk c ON c.id = f.chunk_id
           JOIN knowledge_doc d ON d.id = c.doc_id
           WHERE d.project_id = ?
             AND knowledge_chunk_fts MATCH ?
           ORDER BY bm25(knowledge_chunk_fts) ASC
           LIMIT ?`,
        )
        .all(projectId, tokens, topK * 2) as any[]; // bm25() 值越小越相关；多召回留给 rerank
      return rows.length ? rows : this.likeSearch(projectId, question, topK);
    } catch {
      // FTS5 不可用或查询语法错误 → LIKE 终极兜底
      return this.likeSearch(projectId, question, topK);
    }
  }

  /**
   * 查询 → FTS5 trigram MATCH 表达式（OR 连接 3-gram 与拉丁词；不可构造时返回空串）。
   *
   * 两处修正：
   *
   * 1）**配额饿死**：原实现把拉丁词全部塞在 `parts` 前面、CJK 三元组接在后面，
   *    最后 `[...new Set(parts)].slice(0, 24)` 从头截断。中英混合问题里只要拉丁词
   *    达到 24 个，中文三元组就被**整段截掉** → 检索退化成「只搜英文」，
   *    问题里的中文那一半完全没参与召回，bm25 排序也看不到它们。
   *    用户看到的是「知识库里明明有这段中文却搜不到」，日志无任何异常。
   *    改为两路**交错**取词，保证各自都有配额；上限 24 不变（查询体积不放大）。
   *
   * 2）**文字系统覆盖**：CJK 段正则原写死 `[一-鿿]`（仅 CJK 统一表意文字），
   *    纯假名 / 纯谚文的问题一个 token 都构造不出来 → 返回空串 → 直接掉到 LIKE
   *    全表兜底，trigram 索引形同虚设（与 fingerprint 曾犯的是同一个字符类盲区）。
   *    改用 Unicode Script 属性，覆盖汉字（含扩展区）+ 平假名 + 片假名 + 谚文。
   */
  static buildTrigramQuery(question: string): string {
    const q = (question || '').replace(/[(){}"@#:^~\\]/g, ' ');
    const latin = [...new Set(q.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) || [])];
    const cjk: string[] = [];
    for (const run of q.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{3,}/gu) || []) {
      for (let i = 0; i + 3 <= run.length; i++) cjk.push(run.slice(i, i + 3));
    }
    const MAX_TOKENS = 24;
    const merged: string[] = [];
    const seen = new Set<string>();
    const push = (t: string) => {
      if (seen.has(t)) return;
      seen.add(t);
      merged.push(t);
    };
    const rounds = Math.max(latin.length, cjk.length);
    for (let i = 0; i < rounds && merged.length < MAX_TOKENS; i++) {
      if (i < latin.length) push(latin[i]!);
      if (i < cjk.length) push(cjk[i]!);
    }
    return merged
      .slice(0, MAX_TOKENS)
      .map((t) => `"${t}"`)
      .join(' OR ');
  }

  /** LIKE 兜底检索（FTS5 不可用或查询语法错误时的终极兜底） */
  private likeSearch(projectId: string, question: string, topK: number): any[] {
    const NO_SCORE = 999;
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return [];
    // 终极兜底也要 SQL 级限流：LIKE 全匹配 + LIMIT topK*4，防止大知识库全量拉进内存；LIKE 通配符转义
    const like = `%${question.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = db
      .select({
        chunk_id: knowledgeChunks.id,
        doc_id: knowledgeChunks.docId,
        content: knowledgeChunks.content,
        context: knowledgeChunks.context,
        seq: knowledgeChunks.seq,
        doc_name: knowledgeDocs.name,
        reference_id: knowledgeDocs.referenceId,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocs, eq(knowledgeChunks.docId, knowledgeDocs.id))
      .where(and(eq(knowledgeDocs.projectId, projectId), sql`${knowledgeChunks.content} LIKE ${like} ESCAPE '\\'`))
      .limit(Math.max(1, topK * 4))
      .all();
    return rows.map((r) => ({ ...r, distance: NO_SCORE }));
  }

  async search(projectId: string, question: string, topK = 5) {
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return [];
    const refMap = this.referenceSummaryMap(docs);

    // B-3.2：ANN(语义) + FTS5(词面) 双路并行召回 → RRF 融合（k=60）。
    // 单路失败自动退化为另一路；两路皆空回退 likeSearch 终极兜底。
    const recallK = topK * 2 + 5; // 双路超召回，融合后裁回 topK
    // annSearch 依赖 embed 结果，二者必须串行；但与 ftsSearch 可并行（原实现多等了一次 AN N 往返）
    const embedPromise = this.embedding.embed(question).catch(() => null);
    const ftsPromise = Promise.resolve()
      .then(() => this.ftsSearch(projectId, question, recallK))
      .catch(() => [] as any[]);
    const [qVec, ftsRows] = await Promise.all([embedPromise, ftsPromise]);
    const annRows = qVec ? await this.annSearch(projectId, qVec, recallK).catch(() => [] as any[]) : [];
    const fused = KnowledgeService.rrfFuse(annRows, ftsRows);
    let rows = fused.length > 0 ? fused : this.likeSearch(projectId, question, topK);

    // B-3.3：可选 LLM 重排（app_setting retrieval_rerank=on；默认 off）。失败静默保融合序。
    if (fused.length > 0 && this.rerankEnabled()) {
      try {
        const candidates = fused.slice(0, 12).map((r) => ({ id: String(r.chunk_id), content: r.content }));
        const scores = await this.ai.rerankChunks(question, candidates);
        if (scores.size > 0) {
          rows = fused
            .map((r) => ({ ...r, _llm: scores.get(String(r.chunk_id)) ?? -1 }))
            .sort((a, b) => (b._llm as number) - (a._llm as number));
        }
      } catch {
        /* 重排失败：保 RRF 序 */
      }
    }

    /**
     * MMR 去冗余：同一文档的相邻块（800 字切分 + 15% 重叠）在 RRF 里天然霸榜，
     * 直接取 topK 会让「5 条来源」变成同一段话的 5 个切片，生成端拿不到互补信息。
     * 这里在融合后做一次多样性重排（零 LLM 成本，默认 λ=0.7 偏相关性）。
     */
    const topScore = rows[0]?.rrf || 1 / 61;
    if (rows.length > topK) {
      const relList = normalizeScores(rows.slice(0, 40).map((r) => Number(r.rrf ?? 1 / 61)));
      const chosen = mmrSelect(
        rows.slice(0, 40).map((r, i) => ({
          id: String(r.chunk_id),
          relevance: relList[i],
          text: String(r.content || ''),
          row: r,
        })),
        topK,
        { lambda: 0.7 },
      );
      rows = chosen.map((c) => c.row);
    }
    return rows
      .slice(0, topK)
      .map((row) => ({
        id: row.chunk_id,
        docId: row.doc_id,
        docName: row.doc_name,
        content: row.content,
        context: row.context || null,
        seq: row.seq,
        // RRF 归一百分制：榜首=100，其余按分数比例；LIKE 兜底行无 rrf，给保守分（1/61 归一后约 1 分档）
        score: Math.max(1, Math.round(((row.rrf ?? 1 / 61) / topScore) * 100)),
        ...(row._llm !== undefined ? { rerankScore: row._llm as number } : {}),
        referenceId: row.reference_id || null,
        referenceTitle: row.reference_id ? (refMap.get(row.reference_id)?.title || null) : null,
        referenceAuthors: row.reference_id ? (refMap.get(row.reference_id)?.authors || null) : null,
        referenceYear: row.reference_id ? (refMap.get(row.reference_id)?.year || null) : null,
      }));
  }

  /** B-3.3：LLM 重排开关（app_setting retrieval_rerank=on；env WEBSEARCH 同款优先级：DB > env > 默认 off） */
  private rerankEnabled(): boolean {
    try {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'retrieval_rerank')).get();
      if (row) return row.value === 'on';
    } catch { /* 表未建 */ }
    return process.env.RETRIEVAL_RERANK === 'on';
  }

  /** B-3.2：Reciprocal Rank Fusion——两路排名融合为统一分数（k=60，标准参数）。纯函数可单测。 */
  static rrfFuse(a: any[], b: any[]): any[] {
    const K = 60;
    const byId = new Map<string, { row: any; rrf: number }>();
    const add = (rows: any[]) =>
      rows.forEach((r, i) => {
        const id = String(r.chunk_id);
        const cur = byId.get(id) || { row: r, rrf: 0 };
        cur.rrf += 1 / (K + i + 1);
        byId.set(id, cur);
      });
    add(a);
    add(b);
    return [...byId.values()].sort((x, y) => y.rrf - x.rrf).map((e) => ({ ...e.row, rrf: e.rrf }));
  }

  /**
   * 知识库语义地图（F-2.2）：把所有分块的 embedding 投影到 2D，供前端散点图渲染。
   *
   * - 只用已有向量，不调用嵌入模型（无需 AI Key）
   * - 按文档聚簇着色所需的元信息（docId/docName）
   * - 超过 limit 时分档下采样，并返回 sampled 标记供前端提示
   */
  semanticMap(projectId: string, limit = 5000) {
    const docs = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, projectId)).all();
    if (docs.length === 0) return { points: [], total: 0, sampled: false, limit };
    const docMap = new Map(docs.map((d) => [d.id, d]));

    const rows = sqlite
      .prepare(
        `SELECT c.id AS chunk_id, c.doc_id, c.seq, c.content, c.embedding
           FROM knowledge_chunk c
           JOIN knowledge_doc d ON d.id = c.doc_id
          WHERE d.project_id = ? AND c.embedding IS NOT NULL
          ORDER BY c.doc_id, c.seq`,
      )
      .all(projectId) as Array<{ chunk_id: string; doc_id: string; seq: number; content: string; embedding: Buffer }>;

    if (rows.length === 0) return { points: [], total: 0, sampled: false, limit };

    const idx = downsampleIndices(rows.length, Math.max(1, limit));
    const picked = idx.map((i) => rows[i]);
    const vectors = picked.map((r) => blobToVector(r.embedding));
    // 向量维度可能不一致（换过嵌入模型）——过滤掉与首个不同的，避免投影失真
    const dim = vectors[0]?.length ?? 0;
    const usable = vectors.map((v, i) => ({ v, i })).filter((e) => e.v.length === dim && dim > 0);
    if (usable.length === 0) return { points: [], total: rows.length, sampled: idx.length < rows.length, limit };

    const projected = projectTo2D(usable.map((e) => e.v));
    const points = projected.map((pt, k) => {
      const row = picked[usable[k].i];
      const doc = docMap.get(row.doc_id);
      return {
        id: row.chunk_id,
        docId: row.doc_id,
        docName: doc?.name ?? '未命名',
        seq: row.seq,
        x: Math.round(pt.x * 10000) / 10000,
        y: Math.round(pt.y * 10000) / 10000,
        // 预览文本：只给前 160 字，完整内容由 /api/knowledge/:id 取
        snippet: (row.content || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      };
    });
    return { points, total: rows.length, sampled: idx.length < rows.length, limit };
  }

  /** RAG 问答：检索 + LLM 基于资料回答（Contextual Retrieval：块前带文档上下文前缀） */
  async query(projectId: string, question: string) {
    const hits = await this.search(projectId, question, 5);
    if (hits.length === 0) {
      return { answer: '知识库中没有找到与问题相关的资料。请先上传相关文献或文档。', sources: [] };
    }
    const chunksText = hits
      .map((h, i) => `【来源${i + 1}｜文档：${h.docName}】\n${h.context ? `${h.context}\n` : ''}${h.content}`)
      .join('\n\n---\n\n');
    const answer = await this.ai.knowledgeQa(question, chunksText);
    return {
      answer,
      sources: hits.map((h) => ({
        docName: h.docName,
        snippet: h.content.slice(0, 120),
        score: h.score,
        chunkId: h.id,
        chunkText: h.content,
        chunkSeq: h.seq,
        referenceId: h.referenceId ?? null,
        referenceTitle: h.referenceTitle ?? null,
        referenceAuthors: h.referenceAuthors ?? null,
        referenceYear: h.referenceYear ?? null,
      })),
    };
  }
}
