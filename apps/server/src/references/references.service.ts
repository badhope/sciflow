import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { sql, eq, and, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import { z } from 'zod';
import { db, sqlite } from '../db/database';
import { references, screeningQueue, extractionFields, extractionValues, documents, citations } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { buildCslEntries } from '../common/citation-csl';
import { parseAuthors } from '../common/authors';
import { fingerprint } from '../common/fingerprint';
import { parseTagsJson, parseStringList } from '../common/json-guard';

/** Zod schemas for references input validation */
const createSchema = z.object({
  projectId: z.string().min(1),
  hit: z.object({
    title: z.string().min(1).max(500),
    // 作者三形态兼容（字符串 / {name} / {family,given}）——归一化统一走 parseAuthors（common/authors 单一来源）
    authors: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional().default([]),
    year: z.number().int().min(1000).max(2100).nullable().optional(),
    venue: z.string().max(500).optional().default(''),
    doi: z.string().max(200).optional().default(''),
    url: z.string().max(2000).optional().default(''),
    abstract: z.string().max(50000).optional().default(''),
    citationCount: z.number().int().min(0).optional().default(0),
  }),
});

const updateSchema = z.object({
  id: z.string().min(1),
  patch: z.object({
    readingStatus: z.enum(['unread', 'reading', 'read', 'cited']).optional(),
    tags: z.string().max(10000).optional(),
    notes: z.string().max(50000).nullable().optional(),
  }),
});

const importPipelineHitsSchema = z.object({
  projectId: z.string().min(1),
  hits: z.array(z.object({
    title: z.string().min(1).max(500),
    authors: z.array(z.string()).optional(),
    year: z.number().int().min(1000).max(2100).nullable().optional(),
    venue: z.string().max(500).optional(),
    doi: z.string().max(200).optional(),
    url: z.string().max(2000).optional(),
    abstract: z.string().max(50000).optional(),
    citationCount: z.number().int().min(0).optional(),
  })).max(100),
});

/** 文献命中条目（本地文献库检索/入库共用） */
export interface PaperHit {
  id?: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: 'manual';
  citationCount: number;
  /** 跨库检索增强：命中来源库（文献库 references / 知识库 knowledge / 联网检索 web）；未标视为文献库 */
  origin?: 'library' | 'knowledge' | 'web';
  /** 跨库检索增强：匹配度分数（0~1），产物参考文献块回标用 */
  matchScore?: number;
}

@Injectable()
export class ReferencesService {
  constructor(private readonly ai: AiService) {}

  /**
   * B-5.2 DOI 核验（opt-in：用户逐条手动触发，非内置依赖、无启动链路调用）。
   * 查 Crossref 公共 API（无需 Key）；成功 → verified=1 + 回填缺失元数据；失败 → 返回原因不抛断。
   */
  async verifyDoi(id: string) {
    const ref = this.get(id);
    const doi = (ref.doi || '').trim();
    if (!doi) throw new BadRequestException('该文献没有 DOI，无法核验；请先补充 DOI 或改用 BibTeX 导入');
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SciFlow/0.4 (mailto:user@local)' } });
      if (!res.ok) {
        return { ok: false, status: res.status, reason: res.status === 404 ? 'Crossref 无此 DOI（DOI 本身可能是幻觉）' : `Crossref ${res.status}` };
      }
      const data = (await res.json()) as { message?: Record<string, unknown> };
      const msg = data.message || {};
      const issued = (msg.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0] ?? null;
      const venue = Array.isArray(msg['container-title']) ? String(msg['container-title'][0] || '') : '';
      const title = Array.isArray(msg.title) ? String(msg.title[0] || '') : '';
      // 回填缺失字段（已有值不覆盖——用户手工数据优先）
      db.update(references)
        .set({
          year: ref.year ?? (issued as number | null),
          venue: ref.venue || venue,
          title: ref.title || title,
        })
        .where(eq(references.id, id))
        .run();
      // citation 表同引用的 verified 同步（references 表无 verified 列，核验态落在 citation 侧）
      sqlite.prepare('UPDATE citation SET verified=1 WHERE reference_id=?').run(id);
      return { ok: true, doi, title: title || ref.title, year: issued, venue: venue || ref.venue, source: 'crossref' };
    } catch (e: unknown) {
      const reason = e instanceof Error && e.name === 'AbortError' ? 'Crossref 超时（8s）' : `网络失败：${e instanceof Error ? e.message : String(e)}`;
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 本地文献库检索（标题/作者/摘要模糊匹配，已移除国外在线源，零外部网络依赖） */
  search(query: string, limit = 8, projectId?: string): PaperHit[] {
    const q = query.trim();
    if (!q) return [];
    // LIKE 通配符转义：用户输入中的 % _ \ 按字面匹配（防 % 全命中）
    const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const q2 = `%${esc}%`;
    const cond = sql`${references.title} LIKE ${q2} ESCAPE '\\' OR COALESCE(${references.authors}, '') LIKE ${q2} ESCAPE '\\' OR COALESCE(${references.abstract}, '') LIKE ${q2} ESCAPE '\\'`;
    const rows = db
      .select()
      .from(references)
      .where(projectId ? sql`${references.projectId} = ${projectId} AND (${cond})` : cond)
      .limit(Math.max(1, Math.min(limit, 200))) // SQL 级截断：不再全量取回后内存切片
      .all();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      authors: parseAuthors(r.authors),
      year: r.year,
      venue: r.venue ?? '',
      doi: r.doi ?? '',
      url: r.url || (r.doi ? `https://doi.org/${r.doi}` : ''),
      abstract: r.abstract ?? '',
      source: 'manual' as const,
      citationCount: r.citationCount ?? 0,
    }));
  }

  list(projectId: string) {
    return db.select().from(references).where(eq(references.projectId, projectId)).orderBy(references.createdAt).all();
  }

  get(id: string) {
    const row = db.select().from(references).where(eq(references.id, id)).get();
    if (!row) throw new NotFoundException('文献不存在');
    return row;
  }

  /** 手动/检索结果入库（自动计算去重指纹，同项目内重复则标记 isDuplicateOf） */
  create(projectId: string, hit: Partial<PaperHit> & { title: string }) {
    const validated = createSchema.parse({ projectId, hit });
    projectId = validated.projectId;
    hit = validated.hit as Partial<PaperHit> & { title: string };
    // 作者归一化（对象数组 → 字符串数组，单一来源 parseAuthors）；入库只存字符串形态
    const authorsNorm = parseAuthors(hit.authors);
    // 空元数据守卫：无作者且无年份的条目（如 Agentic RAG 补检的纯标题）不进文献库，
    // 避免污染引用池导致 [Unknown n.d.] / 佚名
    const authorsOk = authorsNorm.length > 0;
    if (!authorsOk && !hit.year) {
      throw new BadRequestException('文献元数据不足：作者与年份至少填写一项（避免收录无法引用的空条目）');
    }
    // 标题归一化指纹去重：命中同项目已存在文献时，新条目标记为其重复（保留两条记录供筛选流程核对）
    const fp = fingerprint(hit.title);
    const dupOf = fp
      ? db
          .select()
          .from(references)
          .where(and(eq(references.projectId, projectId), eq(references.fingerprint, fp)))
          .get()
      : undefined;
    const row = {
      id: randomUUID(),
      projectId,
      title: hit.title,
      authors: JSON.stringify(authorsNorm),
      year: hit.year ?? null,
      venue: hit.venue || '',
      doi: hit.doi || '',
      url: hit.url || '',
      abstract: hit.abstract || '',
      source: hit.source || 'manual',
      tags: '[]',
      citationCount: hit.citationCount || 0,
      readingStatus: 'unread',
      fingerprint: fp,
      isDuplicateOf: dupOf ? dupOf.id : '',
      createdAt: Date.now(),
    };
    db.insert(references).values(row).run();
    return row;
  }

  /** 批量导入检索结果 */
  import(projectId: string, hits: (Partial<PaperHit> & { title: string })[]) {
    return hits.map((h) => this.create(projectId, h)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  }

  remove(id: string) {
    this.get(id);
    // 无外键库必须显式清理：citation 孤儿会让 citation-audit 假绿，筛选队列/编码值也会残留
    db.transaction((tx) => {
      tx.delete(references).where(eq(references.id, id)).run();
      tx.delete(citations).where(eq(citations.referenceId, id)).run();
      tx.delete(screeningQueue).where(eq(screeningQueue.referenceId, id)).run();
      tx.delete(extractionValues).where(eq(extractionValues.referenceId, id)).run();
    });
    return { ok: true };
  }

  /** PATCH /:id：阅读状态 / 标签 / 文献笔记（zod 校验） */
  update(id: string, patch: { readingStatus?: string; tags?: string; notes?: string | null }) {
    const validated = updateSchema.parse({ id, patch });
    this.get(validated.id);
    const set: Record<string, unknown> = {};
    if (validated.patch.readingStatus !== undefined) {
      set.readingStatus = validated.patch.readingStatus;
    }
    if (validated.patch.tags !== undefined) {
      // tags 以 JSON 字符串落库；校验可解析
      const parsed = parseTagsJson(validated.patch.tags);
      if (parsed.length === 0 && validated.patch.tags.trim().length > 2) {
        // 非空输入但解析为空 → 非法 JSON（parseTagsJson 内部已容错）
        throw new BadRequestException('tags 必须是合法 JSON 数组字符串');
      }
      set.tags = validated.patch.tags;
    }
    if (validated.patch.notes !== undefined) {
      set.notes = validated.patch.notes ?? '';
    }
    db.update(references).set(set).where(eq(references.id, validated.id)).run();
    return this.get(validated.id);
  }

  // ---------- 批量 DOI 本地核验（差距 #20，不调外部 API） ----------

  /** 宽松 DOI 格式（满足 Crossref 常见形态即可，本地正则校验） */
  static DOI_RE = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/;

  /**
   * 批量核验文献 DOI 格式：
   * - 合法：readingStatus 为 unread/reading/read 任一者置为 cited（已是 cited 不动）
   * - 非法/空：不动状态，进 invalid
   * - ids 中不存在的：进 skipped
   * 幂等：重复调用对已是 cited 的合法文献不再写库。
   */
  verifyDois(ids: string[]) {
    const valid: { id: string; title: string; doi: string }[] = [];
    const invalid: { id: string; title: string; doi: string }[] = [];
    const skipped: { id: string; title: string; doi: string }[] = [];
    for (const id of ids || []) {
      const row = db.select().from(references).where(eq(references.id, id)).get();
      if (!row) {
        skipped.push({ id, title: '', doi: '' });
        continue;
      }
      const doi = (row.doi || '').trim();
      if (doi && ReferencesService.DOI_RE.test(doi)) {
        if (row.readingStatus && row.readingStatus !== 'cited') {
          db.update(references).set({ readingStatus: 'cited' }).where(eq(references.id, id)).run();
        }
        valid.push({ id, title: row.title, doi });
      } else {
        invalid.push({ id, title: row.title, doi });
      }
    }
    return { valid, invalid, skipped };
  }

  // ---------- 流水线研究 hits 自动入库（差距 #6） ----------

  /**
   * 流水线 ResearchAgent 命中入库：与手动 create 同款标题指纹，
   * 但同项目指纹已存在则整条跳过（不产生 isDuplicateOf 副本），source 标记 pipeline-research。
   * 幂等：多轮重跑因指纹命中恒为 skipped。
   */
  importPipelineHits(projectId: string, hits: { title: string; authors?: string[]; year?: number | null; venue?: string; doi?: string; url?: string; abstract?: string; citationCount?: number }[]) {
    const validated = importPipelineHitsSchema.parse({ projectId, hits });
    let imported = 0;
    let skipped = 0;
    for (const hit of validated.hits) {
      if (!hit.title) continue;
      const fp = fingerprint(hit.title);
      if (fp) {
        const dup = db.select().from(references).where(and(eq(references.projectId, validated.projectId), eq(references.fingerprint, fp))).get();
        if (dup) { skipped++; continue; }
      }
      db.insert(references).values({ id: randomUUID(), projectId: validated.projectId, title: hit.title, authors: JSON.stringify(hit.authors || []), year: hit.year ?? null, venue: hit.venue || '', doi: hit.doi || '', url: hit.url || '', abstract: hit.abstract || '', source: 'pipeline-research', tags: '[]', citationCount: hit.citationCount || 0, readingStatus: 'unread', fingerprint: fp, isDuplicateOf: '', createdAt: Date.now() }).run();
      imported++;
    }
    return { imported, skipped, total: validated.hits.length };
  }

  // ---------- 引用写入（幂等：document+reference 已存在则返回既有记录） ----------

  /**
   * 给某文档引用一篇文献（前端 RAG 来源卡 / 写作页通用入口）。
   * 幂等：同一 (documentId, referenceId) 已存在则直接返回既有记录，不重复插入。
   * verified 与 documents.addCitation 对齐：有 DOI 视为可核验。
   */
  addCitation(body: { documentId: string; referenceId: string; location?: string; context?: string; format?: string }) {
    const ref = db.select().from(references).where(eq(references.id, body.referenceId)).get();
    if (!ref) throw new NotFoundException('引用的文献不存在，请先加入文献库');
    const doc = db.select().from(documents).where(eq(documents.id, body.documentId)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    const existing = db
      .select()
      .from(citations)
      .where(and(eq(citations.documentId, body.documentId), eq(citations.referenceId, body.referenceId)))
      .get();
    if (existing) return existing;
    // createdAt 必须严格大于该文档已有引用：同毫秒插入会让 ORDER BY 不稳定，
    // 导致正文 [n] 与列表第 n 条错位（列表顺序 = 插入顺序 = 正文首次出现顺序）。
    const maxRow = db
      .select({ createdAt: citations.createdAt })
      .from(citations)
      .where(eq(citations.documentId, body.documentId))
      .orderBy(desc(citations.createdAt))
      .get();
    const createdAt = Math.max(Date.now(), (maxRow?.createdAt ?? 0) + 1);
    const row = {
      id: randomUUID(),
      documentId: body.documentId,
      referenceId: body.referenceId,
      location: body.location || '',
      context: body.context || '',
      format: body.format || 'apa',
      verified: ref.doi ? 1 : 0,
      createdAt,
    };
    db.insert(citations).values(row).run();
    return row;
  }

  // ---------- 系统综述·筛选队列 ----------

  /** 单条筛选：同 (project, reference) 已存在则更新，否则新建。直接返回受影响的行（避免全表重查 O(n)） */
  screenUpsert(projectId: string, referenceId: string, status: string, reason = '') {
    const allowed = ['pending', 'included', 'excluded', 'uncertain'];
    if (!allowed.includes(status)) throw new BadRequestException('筛选 status 取值不合法');
    const now = Date.now();
    const existing = db
      .select()
      .from(screeningQueue)
      .where(and(eq(screeningQueue.projectId, projectId), eq(screeningQueue.referenceId, referenceId)))
      .get();
    let id: string;
    if (existing) {
      id = existing.id;
      db.update(screeningQueue).set({ status, reason, updatedAt: now }).where(eq(screeningQueue.id, id)).run();
    } else {
      id = randomUUID();
      db.insert(screeningQueue)
        .values({ id, projectId, referenceId, status, reason, reviewer: 'me', createdAt: now, updatedAt: now })
        .run();
    }
    // 回包带文献标题（前端筛选列表无需二次查询；与 screenList 的 join 口径一致）
    const row = db.select().from(screeningQueue).where(eq(screeningQueue.id, id)).get();
    const ref = db.select().from(references).where(eq(references.id, referenceId)).get();
    return { ...row, title: ref?.title || '' };
  }

  /** 批量筛选（事务包裹，全部成功或全部回滚） */
  screenBulk(projectId: string, referenceIds: string[], status: string, reason = '') {
    const allowed = ['pending', 'included', 'excluded', 'uncertain'];
    if (!allowed.includes(status)) throw new BadRequestException('筛选 status 取值不合法');
    const refs = referenceIds || [];
    db.transaction((tx) => {
      const now = Date.now();
      for (const refId of refs) {
        const existing = tx
          .select()
          .from(screeningQueue)
          .where(and(eq(screeningQueue.projectId, projectId), eq(screeningQueue.referenceId, refId)))
          .get();
        let id: string;
        if (existing) {
          id = existing.id;
          tx.update(screeningQueue).set({ status, reason, updatedAt: now }).where(eq(screeningQueue.id, id)).run();
        } else {
          id = randomUUID();
          tx.insert(screeningQueue)
            .values({ id, projectId, referenceId: refId, status, reason, reviewer: 'me', createdAt: now, updatedAt: now })
            .run();
        }
      }
    });
    return { ok: true, updated: refs.length };
  }

  /** 筛选队列列表（join reference 元数据） */
  screenList(projectId: string) {
    const rows = db
      .select({
        id: screeningQueue.id,
        projectId: screeningQueue.projectId,
        referenceId: screeningQueue.referenceId,
        status: screeningQueue.status,
        reason: screeningQueue.reason,
        reviewer: screeningQueue.reviewer,
        createdAt: screeningQueue.createdAt,
        updatedAt: screeningQueue.updatedAt,
        title: references.title,
        year: references.year,
        venue: references.venue,
        authors: references.authors,
      })
      .from(screeningQueue)
      .leftJoin(references, eq(screeningQueue.referenceId, references.id))
      .where(eq(screeningQueue.projectId, projectId))
      .orderBy(screeningQueue.updatedAt)
      .all();
    return rows.map((r) => ({ ...r, title: r.title ?? '', venue: r.venue ?? '', authors: r.authors ?? '[]' }));
  }

  // ---------- 系统综述·文献编码抽取表 ----------

  /** 新建抽取字段（key 小写字母数字下划线，项目内唯一） */
  addExtractionField(projectId: string, key: string, label: string, kind = 'text', options: string[] = []) {
    const k = (key || '').trim();
    if (!/^[a-z0-9_]+$/.test(k)) throw new BadRequestException('key 仅允许小写字母、数字与下划线');
    if (!label?.trim()) throw new BadRequestException('字段 label 必填');
    const fieldKind = kind === 'select' ? 'select' : 'text';
    const dup = db
      .select()
      .from(extractionFields)
      .where(and(eq(extractionFields.projectId, projectId), eq(extractionFields.key, k)))
      .get();
    if (dup) throw new BadRequestException('该项目下已存在相同 key 的字段');
    const row = {
      id: randomUUID(),
      projectId,
      key: k,
      label: label.trim(),
      kind: fieldKind,
      options: JSON.stringify(Array.isArray(options) ? options.map(String) : []),
      createdAt: Date.now(),
    };
    db.insert(extractionFields).values(row).run();
    return this.toFieldDto(row);
  }

  listExtractionFields(projectId: string) {
    return db
      .select()
      .from(extractionFields)
      .where(eq(extractionFields.projectId, projectId))
      .orderBy(extractionFields.createdAt)
      .all()
      .map((f) => this.toFieldDto(f));
  }

  /** 删除字段并级联清理其取值 */
  removeExtractionField(id: string) {
    db.delete(extractionValues).where(eq(extractionValues.fieldId, id)).run();
    db.delete(extractionFields).where(eq(extractionFields.id, id)).run();
    return { ok: true };
  }

  /** 设置/更新某字段在某文献上的取值（upsert） */
  setExtractionValue(fieldId: string, referenceId: string, value: string) {
    const now = Date.now();
    const existing = db
      .select()
      .from(extractionValues)
      .where(and(eq(extractionValues.fieldId, fieldId), eq(extractionValues.referenceId, referenceId)))
      .get();
    if (existing) {
      db.update(extractionValues).set({ value: value ?? '', updatedAt: now }).where(eq(extractionValues.id, existing.id)).run();
    } else {
      db.insert(extractionValues)
        .values({ id: randomUUID(), fieldId, referenceId, value: value ?? '', createdAt: now, updatedAt: now })
        .run();
    }
    return { ok: true };
  }

  /** 抽取表矩阵：字段列表 + 每篇文献一行的取值映射 */
  extractionTable(projectId: string) {
    const fields = this.listExtractionFields(projectId);
    const refs = db.select().from(references).where(eq(references.projectId, projectId)).orderBy(references.createdAt).all();
    const fieldIds = fields.map((f) => f.id);
    const values = fieldIds.length
      ? db
          .select()
          .from(extractionValues)
          .where(sql`${extractionValues.fieldId} IN (${sql.join(fieldIds.map((id) => sql`${id}`), sql`, `)})`)
          .all()
      : [];
    const rows = refs.map((r) => {
      const valuesMap: Record<string, string> = {};
      for (const v of values) {
        if (v.referenceId === r.id) valuesMap[v.fieldId] = v.value ?? '';
      }
      return { referenceId: r.id, title: r.title, year: r.year, venue: r.venue ?? '', values: valuesMap };
    });
    return { fields, rows };
  }

  private toFieldDto(row: typeof extractionFields.$inferSelect) {
    const options = parseStringList(row.options);
    return {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      label: row.label,
      kind: (row.kind === 'select' ? 'select' : 'text') as 'text' | 'select',
      options,
      createdAt: row.createdAt,
    };
  }

  // ---------- 引用网络图（共引 + 去重边，前端自研力导向布局） ----------

  /**
   * 聚合项目引用网络：
   * - nodes：项目全部文献的布局所需元数据
   * - edges：①共引边（同一 document 的 citations 内出现的文献对，每文档计一次，weight=共引文档数）
   *          ②重复边（isDuplicateOf 指向，type='dup'，weight 固定高亮）
   * 效率：先取项目全部文档 id，再按 documentId 批量取 citations（避免逐文档查询）。
   */
  graph(projectId: string) {
    const refs = this.list(projectId);
    const nodes = refs.map((r) => ({
      id: r.id,
      title: r.title,
      year: r.year,
      venue: r.venue || '',
      citationCount: r.citationCount ?? 0,
      tags: parseTagsJson(r.tags),
      readingStatus: r.readingStatus || 'unread',
      isDuplicateOf: r.isDuplicateOf || '',
    }));
    const refIds = new Set(refs.map((r) => r.id));

    // 共引边：项目文档 -> citations -> 同文档内同项目文献两两配对
    const docRows = db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, projectId)).all();
    const docIds = docRows.map((d) => d.id);
    const coCite = new Map<string, { a: string; b: string; weight: number }>();
    if (docIds.length) {
      const citeRows = db
        .select()
        .from(citations)
        .where(sql`${citations.documentId} IN (${sql.join(docIds.map((id) => sql`${id}`), sql`, `)})`)
        .all();
      const byDoc = new Map<string, Set<string>>();
      for (const c of citeRows) {
        if (!refIds.has(c.referenceId)) continue;
        let s = byDoc.get(c.documentId);
        if (!s) {
          s = new Set<string>();
          byDoc.set(c.documentId, s);
        }
        s.add(c.referenceId);
      }
      for (const s of byDoc.values()) {
        const arr = [...s];
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const a = arr[i] < arr[j] ? arr[i] : arr[j];
            const b = arr[i] < arr[j] ? arr[j] : arr[i];
            const key = `${a}|${b}`;
            const ex = coCite.get(key);
            if (ex) ex.weight += 1;
            else coCite.set(key, { a, b, weight: 1 });
          }
        }
      }
    }
    const edges: { a: string; b: string; weight: number; type: 'co-cite' | 'dup' }[] = [...coCite.values()].map((e) => ({
      ...e,
      type: 'co-cite' as const,
    }));

    // 重复边
    for (const r of refs) {
      if (r.isDuplicateOf && refIds.has(r.isDuplicateOf)) {
        edges.push({ a: r.id, b: r.isDuplicateOf, weight: 5, type: 'dup' as const });
      }
    }
    return { nodes, edges };
  }

  // ---------- BibTeX / RIS 导出导入（citation-js 替代手搓全栈） ----------

  /** 导出项目全部文献为 BibTeX 或 RIS 文本（citation-js 自动生成标准合规格式） */
  exportRefs(projectId: string, format: string) {
    const refs = this.list(projectId);
    return (format || 'bibtex').toLowerCase() === 'ris' ? this.toRis(refs) : this.toBibtex(refs);
  }

  /** citation-js 共享 CSL-JSON 构造 */
  private toCslJson(refs: (typeof references.$inferSelect)[]) {
    return buildCslEntries(refs.map((r) => ({
      id: r.id,
      title: r.title,
      authors: r.authors,
      year: r.year,
      venue: r.venue,
      doi: r.doi,
    })));
  }

  private toBibtex(refs: (typeof references.$inferSelect)[]): string {
    const raw = new Cite(this.toCslJson(refs)).format('bibtex');
    // citation-js 会为大写保护的单词加花括号（{Graph} {Regression}），保证 BibTeX 编译时大小写不丢。
    // 但下载/交换场景普遍期望明文标题（下游工具不需要保护，且肉眼可读）——按测试契约解包单词级保护括号。
    // 负向后行断言保证 LaTeX 命令参数（\textbf{...}）不被解包；非单词内容（数学/空格/符号）保持原样。
    return raw.replace(/(?<!\\)\{([A-Za-z0-9][A-Za-z0-9_-]*)\}/g, '$1');
  }

  private toRis(refs: (typeof references.$inferSelect)[]): string {
    return new Cite(this.toCslJson(refs)).format('ris');
  }

  /** 导入 BibTeX 文本：citation-js 解析（替代手搓 parseBibtex 75 行）；逐条容错 — 单条坏 entry 不废整批，事务包裹确保原子性 */
  importBibtex(projectId: string, text: string) {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    let cite: any;
    try {
      cite = new Cite(text);
    } catch (e: any) {
      throw new BadRequestException(`BibTeX 整体解析失败: ${e.message}`);
    }
    if (!cite.data.length) throw new BadRequestException('BibTeX 解析结果为空');
    db.transaction((tx) => {
      for (let i = 0; i < cite.data.length; i++) {
        const entry = cite.data[i];
        try {
          const title = entry.title || '';
          if (!title) { skipped++; continue; }
          const fp = fingerprint(title);
          if (fp) { const dup = tx.select().from(references).where(and(eq(references.projectId, projectId), eq(references.fingerprint, fp))).get(); if (dup) { skipped++; continue; } }
          const yearRaw = entry.issued?.['date-parts']?.[0]?.[0];
          const year = yearRaw ? Number(yearRaw) : null;
          const venue = entry['container-title'] || entry['collection-title'] || '';
          const doi = entry.DOI || '';
          const auths = (entry.author || []).map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean);
          tx.insert(references).values({
            id: randomUUID(),
            projectId,
            title,
            authors: JSON.stringify(auths),
            year,
            venue,
            doi,
            abstract: entry.abstract || '',
            source: 'bibtex',
            tags: '[]',
            citationCount: 0,
            readingStatus: 'unread',
            fingerprint: fp,
            isDuplicateOf: '',
            notes: '',
            createdAt: Date.now(),
          }).run();
          imported++;
        } catch (e: any) {
          errors.push(`第 ${i + 1} 条: ${e.message}`);
          skipped++;
        }
      }
    });
    return { imported, skipped, total: cite.data.length, errors: errors.length ? errors : undefined };
  }

  /** AI 文献综述（只基于文献库内真实文献，禁止编造） */
  async summarize(projectId: string, topic: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = this.paperListText(refs);
    return this.ai.summarizeLiterature(topic, papers);
  }

  private paperListText(refs: (typeof references.$inferSelect)[]) {
    return refs
      .map(
        (r, i) =>
          `[Ref:${i + 1}] ${r.title}（作者:${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）\n摘要:${(r.abstract || '').slice(0, 300)}`,
      )
      .join('\n\n');
  }

  /** Elicit 式：文献结构化提取（方法/结果/贡献/局限） */
  async extract(projectId: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（年份:${r.year || 'n.d.'}）\n摘要:${(r.abstract || '').slice(0, 400)}`)
      .join('\n\n');
    const rows = await this.ai.extractPaperTable(papers);
    return rows.map((row, i) => ({ ...row, ref: row.ref || String(i + 1) }));
  }

  /** 科研加强：单篇文献深度精读 */
  async deepDive(projectId: string, refId: string) {
    const ref = this.get(refId);
    const paper = `标题:${ref.title}\n作者:${ref.authors}\n年份:${ref.year || 'n.d.'}\n期刊/会议:${ref.venue || '未知'}\nDOI:${ref.doi || '无'}\n摘要:${(ref.abstract || '').slice(0, 800)}`;
    return this.ai.deepDivePaper(paper);
  }

  /** 科研加强：研究缺口定位（选题顾问） */
  async gap(projectId: string, topic: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（年份:${r.year || 'n.d.'}，${r.venue}）\n摘要:${(r.abstract || '').slice(0, 300)}`)
      .join('\n\n');
    return this.ai.researchGap(topic, papers);
  }

  /** Consensus 式：证据综合（论断 + 支持/矛盾 + 证据强度） */
  async evidence(projectId: string, question: string) {
    const refs = this.list(projectId);
    if (refs.length === 0) throw new BadRequestException('文献库为空，请先检索并导入文献');
    const papers = refs
      .map((r, i) => `[Ref:${i + 1}] ${r.title}（年份:${r.year || 'n.d.'}）\n摘要:${(r.abstract || '').slice(0, 350)}`)
      .join('\n\n');
    return this.ai.evidenceSynthesis(question, papers);
  }
}
