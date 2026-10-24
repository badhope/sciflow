import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';
import './csl-register'; // 注册官方补缺样式（IEEE/GB-T 7714/Nature/Chicago/Springer/ACS），必须在 Cite 使用前导入
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { documents, citations, references, polishRecords, qualityReports, reviewComments, experiments, pipelineTasks } from '../db/schema';
import { Document, Packer, Paragraph, HeadingLevel, AlignmentType } from 'docx';
import { AiService } from '../ai/ai.service';
import { ReferencesService } from '../references/references.service';
import { splitTailBlock } from '../pipeline/tail-blocks';
import { parseAuthors as parseAuthorArr, surnameOf } from '../common/authors';
import { parseJson } from '../common/json-guard';
import { toCslAuthors } from '../common/citation-csl';

const MAX_VERSIONS = 20;
const EMPTY_OUTLINE: { title: string; sections: { title: string; subsections: string[] }[] } = { title: '', sections: [] };

@Injectable()
export class DocumentsService {
  constructor(
    private readonly ai: AiService,
    private readonly refs: ReferencesService,
  ) {}

  /** 全部文档（仅本地/桌面单用户模式；企业模式由控制器拒绝） */
  listAll() {
    return db.select().from(documents).orderBy(documents.updatedAt).all();
  }

  list(projectId: string) {
    return db.select().from(documents).where(eq(documents.projectId, projectId)).orderBy(documents.updatedAt).all();
  }

  get(id: string) {
    const row = db.select().from(documents).where(eq(documents.id, id)).get();
    if (!row) throw new NotFoundException('文档不存在');
    return row;
  }

  create(projectId: string, input: { title: string }) {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId,
      title: input.title.trim() || '未命名论文',
      content: '',
      outline: '[]',
      version: 1,
      versions: '[]',
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    db.insert(documents).values(row).run();
    return row;
  }

  /** 更新文档；内容变化时自动保存历史版本（commitMessage 可选，用于手动触发时注入提交信息） */
  update(id: string, patch: Record<string, unknown>) {
    const existing = this.get(id);
    const baseVersion = existing.version ?? 1;
    let versions = parseJson<{ version: number; content: string; updatedAt: number; name?: string; commitMessage?: string }[]>(existing.versions, []);
    // 只允许白名单字段：历史上整包展开会让 PATCH 改写 id/projectId/version 等（越权 + 数据损坏）
    const allowed = ['title', 'content', 'outline', 'status'] as const;
    const safe: Record<string, unknown> = {};
    for (const k of allowed) if (patch[k] !== undefined) safe[k] = patch[k];
    const commitMessage = typeof patch.commitMessage === 'string' ? patch.commitMessage : undefined;
    const nextContent = safe.content as string | undefined;
    if (nextContent !== undefined && nextContent !== existing.content && existing.content) {
      versions = [
        ...versions,
        { version: baseVersion, content: existing.content, updatedAt: existing.updatedAt ?? Date.now(), commitMessage },
      ].slice(-MAX_VERSIONS);
    }
    const row = {
      ...existing,
      ...safe,
      versions: JSON.stringify(versions),
      version: nextContent !== undefined && nextContent !== existing.content ? baseVersion + 1 : baseVersion,
      updatedAt: Date.now(),
    };
    db.update(documents).set(row).where(eq(documents.id, id)).run();
    return this.get(id);
  }

  remove(id: string) {
    this.get(id);
    // 无外键的库靠 service 级联：漏表会留下孤儿质量报告/审稿意见/实验结果（citation-audit 还会假绿）
    db.transaction((tx) => {
      tx.delete(documents).where(eq(documents.id, id)).run();
      tx.delete(citations).where(eq(citations.documentId, id)).run();
      tx.delete(polishRecords).where(eq(polishRecords.documentId, id)).run();
      tx.delete(qualityReports).where(eq(qualityReports.documentId, id)).run();
      tx.delete(reviewComments).where(eq(reviewComments.documentId, id)).run();
      tx.delete(experiments).where(eq(experiments.documentId, id)).run();
      tx.update(pipelineTasks).set({ documentId: null }).where(eq(pipelineTasks.documentId, id)).run();
    });
    return { ok: true };
  }

  /** versions JSON 历史元素：支持 name + commitMessage（纯 JSON 内嵌，无需额外 DDL） */
  private parseVersions(existing: { versions: string | null }): { version: number; content: string; updatedAt: number; name?: string; commitMessage?: string }[] {
    return parseJson<{ version: number; content: string; updatedAt: number; name?: string; commitMessage?: string }[]>(existing.versions, []);
  }

  /**
   * 缺口#2：为某个历史版本命名（PATCH /api/documents/:id/version-name）。
   *  - 幂等：同 version 重复命名直接覆盖 name，不新增历史条目；
   *  - 仅写入 versions JSON 内嵌的可选 name 字段，不动 content/updatedAt；
   *  - version 不存在（历史已被 MAX_VERSIONS=20 上限淘汰出数组）或 name 非法 → 400；
   *  - 返回更新后的整个 versions 数组。
   */
  setVersionName(id: string, version: number, name: string) {
    const existing = this.get(id);
    if (typeof version !== 'number' || !Number.isFinite(version)) throw new BadRequestException('version 必须是数字');
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new BadRequestException('版本名不能为空');
    if (trimmed.length > 80) throw new BadRequestException('版本名过长（≤80 字）');
    const versions = this.parseVersions(existing);
    const target = versions.find((v) => v.version === version);
    if (!target) {
      throw new BadRequestException(
        `未找到版本 v${version}：它可能尚未产生历史快照，或已被历史上限（${MAX_VERSIONS} 条）淘汰出数组`,
      );
    }
    target.name = trimmed;
    db.update(documents).set({ versions: JSON.stringify(versions), updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return versions;
  }

  /**
   * 创建手动版本快照（对标 git commit）：显式点保存某一刻的内容快照，携带 commit message。
   *  - 幂等：当前内容与最新快照相同时不重复新建（返回已有快照列表）
   *  - commitMessage 为空时自动生成时间戳兜底
   *  - 返回更新后的 versions 数组
   */
  createSnapshot(id: string, commitMessage?: string) {
    const existing = this.get(id);
    const versions = parseJson<{ version: number; content: string; updatedAt: number; name?: string; commitMessage?: string }[]>(existing.versions, []);
    // 与最新快照内容对比：相同则跳过（幂等）
    const latest = versions[versions.length - 1];
    if (latest && latest.content === existing.content) return versions;
    const msg = commitMessage?.trim() || `手动快照 · ${new Date().toLocaleString('zh-CN')}`;
    // 快照号取「历史最大版本号 + 1」：直接复用 baseVersion 会与 update 自动快照产生同号重复（历史缺陷）
    const nextVersion = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
    const entry: { version: number; content: string; updatedAt: number; name?: string; commitMessage?: string } = { version: nextVersion, content: existing.content ?? '', updatedAt: Date.now(), commitMessage: msg };
    versions.push(entry);
    const trimmed = versions.slice(-MAX_VERSIONS);
    db.update(documents).set({ versions: JSON.stringify(trimmed), updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return trimmed;
  }

  /** 为某个历史版本写入/覆盖 commit message（PATCH /api/documents/:id/versions/:version/commit-message） */
  setVersionCommitMessage(id: string, version: number, message: string) {
    const existing = this.get(id);
    if (typeof version !== 'number' || !Number.isFinite(version)) throw new BadRequestException('version 必须是数字');
    const versions = this.parseVersions(existing);
    const target = versions.find((v) => v.version === version);
    if (!target) throw new BadRequestException(`未找到版本 v${version}`);
    target.commitMessage = String(message ?? '').slice(0, 200);
    db.update(documents).set({ versions: JSON.stringify(versions), updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return versions;
  }

  /**
   * 缺口#4：按样式渲染正文锚点 + 文末参考文献列表（纯函数预览，永不落库）。
   *  - 序号样式（ieee/vancouver/gbt/nature/springer/acs）：正文 [n] 保持 [n]（citations 插入序 n=index+1，与现状一致），
   *    references 按插入序渲染，changed=false；
   *  - 著者-年样式（apa/chicago）：正文每个 [n] 重排为 (第一作者姓, 年份)，文末参考文献按作者姓字母序重排，changed=true；
   *    无作者/年份降级为 (佚名, n.d.)；同作者同年多篇按**正文重排后首次出现顺序**分配 a/b 后缀（首现 a、次现 b…），文末列表同步。
   *  - 幂等：相同 style 重复调用逐字节一致（纯函数变换，不读外部可变状态）。
   *  - 不落库：无论 dryRun 传与否，都只返回渲染结果，不写 documents.content——由前端预览确认后自行 PATCH content，
   *    避免破坏编辑器自动保存链。dryRun 入参仅为 API 对称/前向兼容保留。
   */
  renderCitations(docId: string, style: string, _dryRun?: boolean) {
    const doc = this.get(docId);
    const valid: CiteStyleKind[] = ['apa', 'ieee', 'vancouver', 'gbt', 'nature', 'chicago', 'springer', 'acs'];
    if (!valid.includes(style as CiteStyleKind)) throw new BadRequestException(`不支持的引用样式: ${style}`);
    // 著者-年制（正文 [n] 改写为 (姓, 年)）；其余为顺序编码制（官方 CSL 样式自带连续编号）
    const isAuthorYear = style === 'apa' || style === 'chicago' || style === 'springer';

    // citations 按存储顺序（rowid=插入序 = 前端 n=index+1）
    const rows = this.listCitations(docId);
    const refs = rows.map((r) => ({
      title: r.reference.title,
      authors: r.reference.authors ?? '[]',
      year: r.reference.year,
      venue: r.reference.venue ?? '',
      doi: r.reference.doi ?? '',
    }));
    const content = doc.content || '';

    // 顺序编码制：整表一次渲染，官方样式按输入序自动编号 1..N（与正文 [n] 锚点一一对应），
    // 不再手动补编号（官方 IEEE/Vancouver/GB-T/Nature/ACS 均自带 [n]/n. 前缀，手动补会双编号）
    if (!isAuthorYear) {
      const references = renderCitationsAsBibliography(
        // id 必须唯一：citation-js 按 id 去重，全用 'entry' 会导致只渲染最后一条（历史 Critical）
        refs.map((r, i) => ({ reference: { id: `entry-${i + 1}`, ...r } })),
        style,
      );
      return { content, references, style, changed: false };
    }

    // 著者-年样式：解析每条 citation 的第一作者姓 / 年
    const meta = refs.map((ref) => {
      const arr = parseAuthorArr(ref.authors);
      const surname = arr.length ? surnameOf(arr[0]) : '佚名';
      const year = ref.year ? String(ref.year) : 'n.d.';
      return { ref, surname, year };
    });

    // key = 第一作者姓(小写)||年；文末参考文献按此字母序
    const keyOf = (i: number) => `${meta[i].surname.toLowerCase()}||${meta[i].year}`;
    // 先按正文锚点 [n] 的出现顺序收集 citation 下标（0 基），用于 a/b 后缀按正文首现序分配
    const anchorOrder: number[] = [];
    const anchorRe = /\[(\d+)\]/g;
    let am: RegExpExecArray | null;
    while ((am = anchorRe.exec(content)) !== null) {
      const n = Number(am[1]);
      if (Number.isInteger(n) && n >= 1 && n <= meta.length) anchorOrder.push(n - 1);
    }
    // 同 (姓,年) 组内不同引用的数量：≥2 才需要 a/b 后缀
    const groupSize = new Map<string, number>();
    for (let i = 0; i < meta.length; i++) groupSize.set(keyOf(i), (groupSize.get(keyOf(i)) || 0) + 1);

    // 按正文首现序分配 a/b：组内第一次出现→a、第二次→b…；同一引用多次出现复用同一后缀
    const letterByIndex: string[] = meta.map(() => '');
    const groupNext = new Map<string, number>();
    for (const i of anchorOrder) {
      const key = keyOf(i);
      if ((groupSize.get(key) || 0) < 2 || letterByIndex[i]) continue;
      const next = groupNext.get(key) || 0;
      letterByIndex[i] = String.fromCharCode(97 + next);
      groupNext.set(key, next + 1);
    }
    // 兜底：组内未在正文出现的引用，按插入序补字母（确定性，保证纯函数幂等）
    for (let i = 0; i < meta.length; i++) {
      const key = keyOf(i);
      if ((groupSize.get(key) || 0) < 2 || letterByIndex[i]) continue;
      const next = groupNext.get(key) || 0;
      letterByIndex[i] = String.fromCharCode(97 + next);
      groupNext.set(key, next + 1);
    }

    // 正文 [n] → (姓, 年{letter})；n 越界（非本文档引用锚点）原样保留
    const contentOut = content.replace(/\[(\d+)\]/g, (m, g1) => {
      const n = Number(g1);
      if (!Number.isInteger(n) || n < 1 || n > meta.length) return m;
      const i = n - 1;
      return `(${meta[i].surname}, ${meta[i].year}${letterByIndex[i]})`;
    });

    // 参考文献按 key（作者姓字母序→年）；同 key 组内按后缀字母序（= 正文首现序）
    const order = meta.map((_, i) => i);
    order.sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka !== kb) return ka < kb ? -1 : 1;
      return letterByIndex[a] < letterByIndex[b] ? -1 : letterByIndex[a] > letterByIndex[b] ? 1 : 0;
    });
    const references = order.map((idx) => formatRefEntry8(meta[idx].ref, style, 0, `${meta[idx].year}${letterByIndex[idx]}`));
    return { content: contentOut, references, style, changed: true };
  }

  // ---------- AI 写作工具 ----------

  /** 大纲生成（outline-first，借鉴 STORM），保存到文档 */
  async generateOutline(id: string, topic: string, summary = '') {
    const doc = this.get(id);
    const outline = await this.ai.writeOutline(topic || doc.title, summary);
    this.update(id, { outline: JSON.stringify(outline), title: doc.title === '未命名论文' ? outline.title : doc.title });
    return outline;
  }

  /** 章节起草 */
  async draftSection(id: string, sectionTitle: string) {
    const doc = this.get(id);
    const outline = parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline, EMPTY_OUTLINE);
    const refs = this.getRefsForPrompt(id);
    const text = await this.ai.draftSection(sectionTitle, JSON.stringify(outline), refs);
    return { text };
  }

  /** 三段式润色/降重并记录历史（图表/参考文献尾部原样保留，避免被当章节润色洗掉） */
  async polish(id: string, text: string, mode: 'polish' | 'reduce' = 'polish') {
    this.get(id);
    const content = String(text ?? '');
    // 尾部块识别走单一来源（tail-blocks.ts）：此前这里自写 indexOf('## 参考文献'/'## 图表')，
    // 不认识「## 研究资料」，导致知识库参考块被当正文送进润色（与 pipeline.graph 口径不一致）。
    const { body: bodyPart, tail: tailPart } = splitTailBlock(content);
    const result = await this.ai.polish(bodyPart, mode);
    const polished = `${String(result.polished ?? '').trim()}\n\n${tailPart}`.trim();
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId: id,
        type: mode,
        original: result.original,
        polished,
        reason: result.reason,
        createdAt: Date.now(),
      })
      .run();
    return { ...result, polished };
  }

  /** 学术翻译 */
  async translate(id: string, text: string, targetLang: 'zh' | 'en') {
    this.get(id);
    const translated = await this.ai.translate(text, targetLang);
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId: id,
        type: 'translate',
        original: text,
        polished: translated,
        reason: `学术翻译（目标语言：${targetLang === 'zh' ? '中文' : '英文'}）`,
        createdAt: Date.now(),
      })
      .run();
    return { translated };
  }

  listPolishRecords(id: string) {
    return db.select().from(polishRecords).where(eq(polishRecords.documentId, id)).orderBy(polishRecords.createdAt).all();
  }

  // ---------- 引用管理（Citation -> Reference 可追溯） ----------
  // 注：写入逻辑统一委托 ReferencesService.addCitation（单一事实源）；documents 仅保留查询与渲染。

  addCitation(documentId: string, input: { referenceId: string; location?: string; context?: string; format?: string }) {
    return this.refs.addCitation({ documentId, ...input });
  }

  /**
   * 文档引用列表。
   *
   * 顺序契约：正文 [n] 锚点与列表第 n 条必须指向同一篇文献。
   * 因此显式按 createdAt 升序（= 首次插入顺序 = 流水线 render 的首次出现序），
   * 不依赖 SQLite 的隐式 rowid 顺序——否则重跑/手工增删后会出现编号错位。
   */
  listCitations(documentId: string) {
    const rows = db
      .select({
        citation: citations,
        reference: references,
      })
      .from(citations)
      .innerJoin(references, eq(citations.referenceId, references.id))
      .where(eq(citations.documentId, documentId))
      .orderBy(asc(citations.createdAt), asc(citations.id))
      .all();
    return rows.map((r) => ({ ...r.citation, reference: r.reference }));
  }

  removeCitation(citationId: string) {
    db.delete(citations).where(eq(citations.id, citationId)).run();
    return { ok: true };
  }

  /** 按格式导出参考文献（APA / IEEE / Vancouver） */
  /** 科研加强：论文摘要 + 关键词生成 */
  async generateAbstract(id: string) {
    const doc = this.get(id);
    return this.ai.generateAbstract(doc.title || '', doc.content || '');
  }

  /**
   * 按格式导出参考文献（citation-js CSL 引擎，覆盖 9000+ 引文格式）
   * BibTeX 走 citation-js 原生输出路径，不再手写模板
   */
  exportCitations(documentId: string, format: string) {
    const rows = this.listCitations(documentId);
    return renderCitationsAsBibliography(rows, format);
  }

  /** 导出 Markdown 全文（标题 + 大纲 + 正文 + 引用列表） */
  exportMarkdown(id: string) {
    const doc = this.get(id);
    const outline = parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline, EMPTY_OUTLINE);
    // 按 citation 插入序（= 正文 [n] 编号）取文献；直接 inArray 的返回顺序不可依赖，会导致导出编号错位
    const refList = this.listCitations(id).map((r) => r.reference);
    const lines: string[] = [];
    lines.push(`# ${doc.title}`);
    lines.push('');
    lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')} · SciFlow 全自动 AI 科研助手`);
    lines.push('');
    if (outline.sections?.length) {
      lines.push('## 大纲');
      outline.sections.forEach((s) => {
        lines.push(`- ${s.title}`);
        (s.subsections || []).forEach((sub) => lines.push(`  - ${sub}`));
      });
      lines.push('');
    }
    lines.push('## 正文');
    lines.push('');
    lines.push(doc.content || '（正文为空）');
    lines.push('');
    if (refList.length) {
      lines.push('## 参考文献');
      lines.push('');
      refList.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}${r.authors && r.authors !== '[]' ? ` — ${r.authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`);
      });
    }
    return { markdown: lines.join('\n'), filename: `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.md` };
  }

  /** Markdown 纯文本化（docx 段落用）：去 #、**、链接、列表符 */
  private mdToPlain(md: string): string {
    return md
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/[|>]+\s?/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** 导出 Word(.docx) 全文——交稿/投稿刚需（标题 + 大纲 + 正文 + 参考文献） */
  /**
   * B-4.3 引用体检：正文锚点 × citation 落库记录交叉审计（引用闭环第一版）。
   * 红牌 = 编号超出落库引用数（幽灵引用）；黄牌 = 已绑定但无 DOI；
   * score = 100 - 红牌×20 - 空表×60 - 黄牌×5（下限 0）。
   */
  citationAudit(documentId: string) {
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    const content = doc.content || '';
    // 尾部块（参考文献/图表）不计锚点——与 pipeline.graph H8 切割口径一致
    const tailRegex = /\n+#{1,3}\s*(参考文献|引用文献|图表|references)(?=[\s（(:：\-—]|$)[^\n]*/gi;
    let cut = -1;
    for (const m of content.matchAll(tailRegex)) {
      const idx = m.index ?? -1;
      if (idx >= 0 && (cut === -1 || idx < cut)) cut = idx;
    }
    const body = cut >= 0 ? content.slice(0, cut) : content;
    // 锚点识别：兼容 `[n]`、`[Ref:n]`、`【n】` 与上标形式 `^[n]`（历史缺陷：只认 `[n]`，
    // 导致正文用 `[Ref:1]` 时 audit 认为 0 锚点、直接给满分「假绿」）。
    const anchorNums = new Set<number>();
    for (const m of body.matchAll(/\[\s*(?:Ref\s*[:：]\s*)?(\d{1,3})\s*\]/gi)) {
      const n = Number(m[1]);
      if (n > 0) anchorNums.add(n);
    }
    for (const m of body.matchAll(/【\s*(\d{1,3})\s*】/g)) {
      const n = Number(m[1]);
      if (n > 0) anchorNums.add(n);
    }
    const rows = db.select().from(citations).where(eq(citations.documentId, documentId)).all();
    // 可解析引用 = 能 join 到 reference 的行；孤儿 citation（文献已删除）不能算作「已绑定」，
    // 否则 citationRows 虚高、audit 假绿（历史缺陷）。
    const orphanRows = rows.filter((r) => !r.referenceId || !db.select({ id: references.id }).from(references).where(eq(references.id, r.referenceId)).get());
    const resolvable = rows.length - orphanRows.length;
    const maxAnchor = anchorNums.size > 0 ? Math.max(...anchorNums) : 0;
    const ghost = maxAnchor > resolvable ? maxAnchor - resolvable : 0;
    const noDoi = rows.filter((r) => {
      if (r.verified) return false;
      const ref = r.referenceId ? db.select().from(references).where(eq(references.id, r.referenceId)).get() : null;
      return !ref?.doi;
    }).length;
    const issues: string[] = [];
    if (ghost > 0) issues.push(`红牌：${ghost} 个锚点编号超出已落库引用（幽灵引用），请重跑引用渲染或检查文献库`);
    if (resolvable === 0 && anchorNums.size > 0) issues.push('红牌：正文有锚点但无可用引用——文档未经引用渲染流程或引用的文献已删除');
    if (orphanRows.length > 0) issues.push(`红牌：${orphanRows.length} 条引用指向已删除文献（孤儿引用），请重新渲染引用`);
    if (noDoi > 0) issues.push(`黄牌：${noDoi} 条已绑定引用无 DOI，可信度待核`);
    if (issues.length === 0 && anchorNums.size > 0) issues.push('绿牌：全部锚点已绑定且具备 DOI 可信度');
    // 无锚点不再直接算「满分」：此前 0 锚点 → issues 为空 + score=100，用户会误以为引用体检通过。
    // 现在显式给「未检测到引用」提示并封顶 60（不是错误，但也不是通过）。
    const noAnchors = anchorNums.size === 0;
    if (noAnchors) issues.push('提示：正文未检测到引用锚点（[n] / [Ref:n] / 【n】），无法评估引用完整性');
    const base = noAnchors ? 60 : 100;
    const score = Math.max(0, base - ghost * 20 - (rows.length === 0 && anchorNums.size > 0 ? 60 : 0) - noDoi * 5);
    return {
      anchorTotal: anchorNums.size,
      maxAnchor,
      citationRows: rows.length,
      verifiedCount: rows.filter((r) => r.verified).length,
      noDoi,
      ghost,
      score,
      issues,
    };
  }

  async exportDocx(id: string) {
    const doc = this.get(id);
    const outline = parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline, EMPTY_OUTLINE);
    // 按 citation 插入序（= 正文 [n] 编号）取文献；直接 inArray 的返回顺序不可依赖，会导致导出编号错位
    const refList = this.listCitations(id).map((r) => r.reference);

    const children: Paragraph[] = [
      new Paragraph({ text: doc.title || '未命名论文', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: `导出时间：${new Date().toLocaleString('zh-CN')} · SciFlow 全自动 AI 科研助手`, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: '', spacing: { after: 120 } }),
    ];

    if (outline.sections?.length) {
      children.push(new Paragraph({ text: '大纲', heading: HeadingLevel.HEADING_1 }));
      outline.sections.forEach((s) => {
        children.push(new Paragraph({ text: s.title, bullet: { level: 0 } }));
        (s.subsections || []).forEach((sub) => children.push(new Paragraph({ text: sub, bullet: { level: 1 } })));
      });
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    }

    children.push(new Paragraph({ text: '正文', heading: HeadingLevel.HEADING_1 }));
    const content = doc.content || '（正文为空）';
    const rawParagraphs = content.split('\n');
    // 正文按段落转 docx 段落：先识别标题层级，再对非标题行剥离 markdown 语法
    for (const raw of rawParagraphs) {
      const line = raw.trim();
      if (!line) continue;
      if (/^##\s/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^##\s+/, ''), heading: HeadingLevel.HEADING_2, spacing: { before: 160 } }));
      } else if (/^###\s/.test(line)) {
        children.push(new Paragraph({ text: line.replace(/^###\s+/, ''), heading: HeadingLevel.HEADING_3, spacing: { before: 120 } }));
      } else {
        children.push(new Paragraph({ text: this.mdToPlain(line), spacing: { after: 100 } }));
      }
    }

    if (refList.length) {
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      children.push(new Paragraph({ text: '参考文献', heading: HeadingLevel.HEADING_1 }));
      refList.forEach((r, i) => {
        const authors = parseAuthorArr(r.authors).join(', ');
        const line = `${i + 1}. ${r.title}${authors ? ` — ${authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`;
        children.push(new Paragraph({ text: line, spacing: { after: 80 } }));
      });
    }

    const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
    return {
      base64: buffer.toString('base64'),
      filename: `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.docx`,
    };
  }

  private getRefsForPrompt(documentId: string): string {
    const rows = this.listCitations(documentId);
    return rows
      .map(
        (r, i) =>
          `[Ref:${i + 1}] ${r.reference.title}（${r.reference.authors}，${r.reference.year || 'n.d.'}，${r.reference.venue}${r.reference.doi ? `，DOI:${r.reference.doi}` : ''}）`,
      )
      .join('\n');
  }
}

// ---------- citation-js 引文格式化（替代手写 8 样式渲染器） ----------

/** CSL 模板名映射（产品内 format 值 → citation-js CSL 模板；除内置 apa/vancouver 外均由 csl-register 注册） */
const CSL_TEMPLATE_MAP: Record<string, string> = {
  apa: 'apa',
  ieee: 'ieee',
  vancouver: 'vancouver',
  gbt: 'chinese-gb7714-2005-numeric',
  chicago: 'chicago-author-date-16th-edition',
  nature: 'nature',
  springer: 'springer-basic-author-date',
  acs: 'american-chemical-society',
};

/** citation-js Cite 对象构建（从 citation row 构建 CSL-JSON 条目） */
function buildCiteEntry(row: { reference: { id: string; title: string; authors: string | null; year: number | null; venue: string | null; doi: string | null } }) {
  return {
    id: row.reference.id,
    type: 'article-journal' as const,
    title: row.reference.title,
    author: toCslAuthors(row.reference.authors),
    issued: row.reference.year ? { 'date-parts': [[row.reference.year]] } : undefined,
    'container-title': row.reference.venue || undefined,
    DOI: row.reference.doi || undefined,
  };
}

/**
 * 用 citation-js CSL 引擎渲染参考文献列表（替代手写的 formatCitation + formatRefEntry8）。
 * BibTeX 直接用 citation-js bibtex 输出。
 */
export function renderCitationsAsBibliography(
  rows: { reference: { id: string; title: string; authors: string | null; year: number | null; venue: string | null; doi: string | null } }[],
  format: string,
): string[] {
  const entries = rows.map(buildCiteEntry);
  const cite = new Cite(entries);

  // bibtex 走 citation-js 原生输出（标准 LaTeX 合规）
  if (format === 'bibtex') {
    return [cite.format('bibtex')];
  }

  const template = CSL_TEMPLATE_MAP[format] || 'apa';
  const formatted = cite.format('bibliography', { format: 'text', template, lang: 'zh-CN' });
  return formatted.split('\n').filter((l) => l.trim());
}

/** 兼容 export 名（老接口 exportCitations）：单条渲染 + 序号样式补全局编号 */
export function formatCitation(
  ref: { title: string; authors: string; year: number | null; venue: string; doi: string },
  format: string,
  index: number,
): string {
  const result = renderCitationsAsBibliography([{ reference: { ...ref, id: 'entry', authors: ref.authors || null, venue: ref.venue || null, doi: ref.doi || null } }], format);
  let line = result[0] || '';
  // 顺序编码制官方样式（IEEE/GB-T/Nature/Vancouver/ACS）单条渲染会自带从 1 起的编号，
  // 这里剥离后重写为调用方指定的全局序号；著者-年样式（apa/chicago/springer）不编号。
  const NUMERIC_STYLES = ['ieee', 'vancouver', 'gbt', 'nature', 'acs'];
  if (NUMERIC_STYLES.includes(format)) {
    // 官方样式自带编号形态各异：IEEE/GB-T "[1]"、Vancouver/Nature "1."、ACS "(1)"
    line = line.replace(/^\[\d+\]\s*/, '').replace(/^\d+\.\s*/, '').replace(/^\(\d+\)\s*/, '');
    return line ? `[${index}] ${line}` : '';
  }
  return line;
}

/* =====================================================================
 * render-citations 用的 8 样式单条条目渲染——现在走 citation-js CSL 引擎，
 * 保留 a/b 后缀和年份覆写能力用于著者-年样式（apa/chicago）。
 * ===================================================================== */
export type CiteStyleKind = 'apa' | 'ieee' | 'vancouver' | 'gbt' | 'nature' | 'chicago' | 'springer' | 'acs';

type RefLite = { title: string; authors: string; year: number | null; venue: string; doi: string };

/**
 * 单条参考文献条目渲染（走 citation-js CSL）。
 * yearOverride 用于著者-年样式注入 a/b 后缀（如 2024a, 2024b）。
 * index=0 时不注入序号（用于著者-年样式文末列表，序号无意义）。
 */
function formatRefEntry8(ref: RefLite, format: string, index: number, yearOverride?: string): string {
  // 用 citation-js 单条目格式化（注入年份覆写）
  const entry = {
    id: 'entry',
    type: 'article-journal' as const,
    title: ref.title,
    author: toCslAuthors(ref.authors),
    issued: { 'date-parts': [[Number(yearOverride?.replace(/[a-z]/g, '')) || ref.year || 0]] } as any,
    'container-title': ref.venue || undefined,
    DOI: ref.doi || undefined,
  };
  const template = CSL_TEMPLATE_MAP[format] || 'apa';
  const cite = new Cite([entry]);
  const formatted = cite.format('bibliography', { format: 'text', template, lang: 'zh-CN' }).trim();
  // 著者-年样式需注入 a/b 后缀
  if (yearOverride && /[a-z]$/.test(yearOverride) && (format === 'apa' || format === 'chicago' || format === 'springer')) {
    return formatted.replace(/\)\./, `${yearOverride.replace(/\d/g, '')}).`);
  }
  return formatted;
}
