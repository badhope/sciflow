import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, asc, inArray } from 'drizzle-orm';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-csl';
import './csl-register'; // 注册官方补缺样式（IEEE/GB-T 7714/Nature/Chicago/Springer/ACS），必须在 Cite 使用前导入
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { documents, citations, references, polishRecords, qualityReports, reviewComments, experiments, pipelineTasks } from '../db/schema';
import { checkPaperQuality } from '../common/quality-audit';
import { auditCitations } from '../common/citation-audit';
import { buildManuscriptDocx } from './manuscript-docx';
import { AiService } from '../ai/ai.service';
import { ReferencesService } from '../references/references.service';
import { splitTailBlock } from '../pipeline/tail-blocks';
import { parseAuthors as parseAuthorArr } from '../common/authors';
import { readProjectQualityStandard } from '../common/project-quality-standard';
import { extractSections, replaceSectionBody, restoreSection as restoreSectionText, sectionDiff, type SectionDiffEntry } from './section-restore';
import { createRevisionQueue, inferSectionTitle, MAX_REVISION_QUEUES, normalizeRevisionQueueStore, serializeRevisionQueueStore, summarizeRevisionQueue, type RevisionQueue, type RevisionQueueInput, type RevisionQueueItem, type RevisionQueueStore } from './revision-queue';

import { parseJson } from '../common/json-guard';
import { toCslAuthors, buildCslEntry, cslSurname } from '../common/citation-csl';

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
   * 按评审意见定向重写指定章节（评审闭环的执行环节，路线图 #1）。
   * 只改命中的那一节，其余章节逐字保留；改前自动快照，便于一键回退。
   */
  async reviseSectionFromReview(id: string, title: string, reviewPoints: string) {
    const doc = this.get(id);
    if (!title) throw new BadRequestException('请指定要修改的章节标题');
    if (!reviewPoints || !reviewPoints.trim()) throw new BadRequestException('请提供要落实的评审意见');
    const current = doc.content ?? '';
    const target = extractSections(current).find((s) => s.title === title);
    if (!target) throw new BadRequestException(`正文中没有找到章节「${title}」`);
    const revisedRaw = await this.ai.reviseSection(title, target.body, reviewPoints);
    // 模型偶尔会带回标题行：剥掉，避免标题重复
    const revised = String(revisedRaw || '')
      .trim()
      .replace(/^#{1,6}\s+[^\n]*\n+/, '')
      .trim();
    if (!revised) throw new BadRequestException('模型未返回有效内容，请重试');
    const next = replaceSectionBody(current, title, revised);
    if (next === current) return { content: current, changed: false };
    this.createSnapshot(id, `按评审意见修改「${title}」前的自动快照`);
    db.update(documents).set({ content: next, updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return { content: next, changed: true };
  }

  /** 读取文档的修改队列存储（兼容旧单队 JSON），空值返回空队列。 */
  private readRevisionQueueStore(doc: { revisionQueue?: string | null }): RevisionQueueStore {
    return normalizeRevisionQueueStore(parseJson<unknown>(doc.revisionQueue || '{}', {}));
  }

  /** 只更新 document.revision_queue，不触碰正文/版本号，避免队列轮询把文档版本炒热 */
  private saveRevisionQueueStore(documentId: string, store: RevisionQueueStore) {
    db.update(documents).set({ revisionQueue: serializeRevisionQueueStore(store) }).where(eq(documents.id, documentId)).run();
  }

  /** 按 queueId 在历史队列里查找；不存在返回 null（不抛异常，方便内部循环复用）。 */
  private findRevisionQueue(documentId: string, queueId: string): RevisionQueue | null {
    const store = this.readRevisionQueueStore(this.get(documentId));
    return store.queues.find((q) => q.id === queueId) ?? null;
  }

  /**
   * 创建并启动一份修改计划队列（后台串行执行，前端通过 SSE/轮询读取）。
   * 队列执行逐条调用现有 sections/revise：每条改前自动快照，只改目标章节。
   * autoResolve=true 时，done 且正文有变化的条目会把关联 review_comment 置为 resolved。
   */
  startRevisionQueue(id: string, inputs: RevisionQueueInput[], options: { autoResolve?: boolean } = {}) {
    const doc = this.get(id);
    if (!Array.isArray(inputs) || inputs.length === 0) throw new BadRequestException('修改计划不能为空');
    const titles = extractSections(doc.content ?? '').map((s) => s.title).filter(Boolean);
    if (!titles.length) throw new BadRequestException('文档还没有可修改的章节标题（先用 ## 标题组织正文）');
    const store = this.readRevisionQueueStore(doc);
    const existing = store.queues.find((q) => q.status === 'queued' || q.status === 'running');
    if (existing) {
      throw new BadRequestException('该文档已有正在执行的修改队列，请等待完成或先停止');
    }
    const now = Date.now();
    const items: RevisionQueueItem[] = inputs.map((input) => {
      const sectionTitle = inferSectionTitle(input, titles);
      const reviewPoints = (input.reviewPoints || '').trim()
        || [input.excerpt, input.suggestedAction].filter(Boolean).join('\n').trim();
      let status: RevisionQueueItem['status'] = 'pending';
      let error = '';
      if (!reviewPoints) {
        status = 'skipped';
        error = '没有可执行的修改要求';
      } else if (!sectionTitle) {
        status = 'skipped';
        error = input.sectionTitle?.trim()
          ? `正文中没有找到章节「${input.sectionTitle.trim()}」`
          : '计划条目没有点名任何现有章节';
      }
      return {
        id: randomUUID(),
        planItemId: input.planItemId || '',
        sectionTitle,
        reviewPoints,
        status,
        error,
        before: '',
        after: '',
        changed: false,
        reviewCommentId: (input.reviewCommentId || '').trim(),
        commentResolved: false,
        startedAt: null,
        finishedAt: null,
      };
    });
    if (!items.some((i) => i.status === 'pending')) {
      throw new BadRequestException('没有可执行的条目：计划条目未匹配到现有章节');
    }
    const queue = createRevisionQueue(id, randomUUID(), items, now, options.autoResolve !== false);
    store.queues = [queue, ...store.queues].slice(0, MAX_REVISION_QUEUES);
    this.saveRevisionQueueStore(id, store);
    void this.runRevisionQueue(id, queue.id).catch((e) => {
      const current = this.findRevisionQueue(id, queue.id);
      if (!current) return;
      current.status = 'failed';
      current.finishedAt = Date.now();
      current.items.forEach((i) => {
        if (i.status === 'pending' || i.status === 'running') i.status = 'failed';
      });
      const latestStore = this.readRevisionQueueStore(this.get(id));
      const idx = latestStore.queues.findIndex((q) => q.id === queue.id);
      if (idx >= 0) latestStore.queues[idx] = { ...current, updatedAt: Date.now() };
      this.saveRevisionQueueStore(id, latestStore);
      console.error('[revision-queue] 执行失败', e);
    });
    return queue;
  }

  /** 把一条审稿意见置为 resolved；只允许操作同一文档，返回是否实际更新。 */
  private resolveReviewComment(documentId: string, reviewCommentId: string): boolean {
    if (!reviewCommentId.trim()) return false;
    const row = db.select().from(reviewComments).where(eq(reviewComments.id, reviewCommentId)).get();
    if (!row || row.documentId !== documentId) return false;
    if (row.status === 'resolved') return true;
    db.update(reviewComments)
      .set({ status: 'resolved', updatedAt: Date.now() })
      .where(eq(reviewComments.id, reviewCommentId))
      .run();
    return true;
  }

  /** 后台串行执行队列：每完成一条就落盘，前端可实时读取逐条进度。 */
  private async runRevisionQueue(documentId: string, queueId: string) {
    const initial = this.findRevisionQueue(documentId, queueId);
    if (!initial || initial.status === 'stopped') return;
    initial.status = 'running';
    initial.updatedAt = Date.now();
    this.saveQueueById(documentId, initial);
    for (let index = 0; index < initial.items.length; index += 1) {
      const current = this.findRevisionQueue(documentId, queueId);
      if (!current || current.status === 'stopped') return;
      const item = current.items[index];
      if (!item || item.status !== 'pending') continue;
      item.status = 'running';
      item.startedAt = Date.now();
      current.updatedAt = Date.now();
      this.saveQueueById(documentId, current);
      try {
        const before = extractSections(this.get(documentId).content ?? '').find((s) => s.title === item.sectionTitle)?.body ?? '';
        item.before = before;
        const result = await this.reviseSectionFromReview(documentId, item.sectionTitle, item.reviewPoints);
        const after = extractSections(result.content ?? '').find((s) => s.title === item.sectionTitle)?.body ?? '';
        item.status = 'done';
        item.after = after;
        item.changed = result.changed;
        if (result.changed && current.autoResolve && item.reviewCommentId && !item.commentResolved) {
          if (this.resolveReviewComment(documentId, item.reviewCommentId)) {
            item.commentResolved = true;
            if (!current.resolvedCommentIds.includes(item.reviewCommentId)) {
              current.resolvedCommentIds.push(item.reviewCommentId);
            }
          }
        }
      } catch (e: any) {
        item.status = 'failed';
        item.error = e?.message || String(e);
      }
      item.finishedAt = Date.now();
      const latest = this.findRevisionQueue(documentId, queueId);
      if (!latest) return;
      latest.items[index] = item;
      // item 是在 current 上更新的，resolvedCommentIds 必须同步到刚读出的 latest，
      // 否则单条旁路只留下 commentResolved=true、审计列表却看不到已关闭意见。
      if (item.commentResolved && item.reviewCommentId && !latest.resolvedCommentIds.includes(item.reviewCommentId)) {
        latest.resolvedCommentIds.push(item.reviewCommentId);
      }
      latest.updatedAt = Date.now();
      this.saveQueueById(documentId, latest);
    }
    const latest = this.findRevisionQueue(documentId, queueId);
    if (!latest || latest.status === 'stopped') return;
    const runnable = latest.items.filter((i) => i.status !== 'skipped');
    const failed = runnable.filter((i) => i.status === 'failed');
    latest.status = failed.length === 0 ? 'completed' : failed.length === runnable.length ? 'failed' : 'partial';
    latest.finishedAt = Date.now();
    latest.updatedAt = Date.now();
    this.saveQueueById(documentId, latest);
  }

  /** 保存单队（保留其他历史队列），是后台循环唯一写入口。 */
  private saveQueueById(documentId: string, queue: RevisionQueue) {
    const store = this.readRevisionQueueStore(this.get(documentId));
    const idx = store.queues.findIndex((q) => q.id === queue.id);
    if (idx >= 0) store.queues[idx] = queue;
    else store.queues = [queue, ...store.queues].slice(0, MAX_REVISION_QUEUES);
    this.saveRevisionQueueStore(documentId, store);
  }

  /** 读取队列（按 queueId 在历史队列中查找，避免只能读最近一队）。 */
  getRevisionQueue(id: string, queueId: string) {
    const queue = this.findRevisionQueue(id, queueId);
    if (!queue) throw new NotFoundException('修改队列不存在');
    return queue;
  }

  /** 历史队列审计：按新到旧返回摘要，不含 before/after 大字段。 */
  listRevisionQueues(id: string) {
    const store = this.readRevisionQueueStore(this.get(id));
    return { queues: store.queues.map(summarizeRevisionQueue) };
  }

  /** 停止队列：当前正在跑的条目会跑完，未开始的条目标记 skipped。 */
  stopRevisionQueue(id: string, queueId: string) {
    const queue = this.getRevisionQueue(id, queueId);
    if (queue.status !== 'queued' && queue.status !== 'running') return queue;
    const now = Date.now();
    queue.status = 'stopped';
    queue.finishedAt = now;
    queue.updatedAt = now;
    for (const item of queue.items) {
      if (item.status === 'pending') {
        item.status = 'skipped';
        item.error = '队列已停止';
        item.finishedAt = now;
      }
    }
    this.saveQueueById(id, queue);
    return queue;
  }

  /**
   * 未匹配/失败条目二次指定章节重试：不改写旧队历史，新建一队只跑这一条，
   * 让「重试」也留下可审计的记录。
   */
  retryRevisionQueueItem(id: string, queueId: string, itemId: string, sectionTitle: string) {
    const source = this.getRevisionQueue(id, queueId);
    const item = source.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('队列条目不存在');
    if (item.status !== 'skipped' && item.status !== 'failed') {
      throw new BadRequestException('只有跳过或失败的条目可以重试');
    }
    const title = (sectionTitle || '').trim();
    if (!title) throw new BadRequestException('请指定要重试的目标章节');
    const titles = extractSections(this.get(id).content ?? '').map((s) => s.title).filter(Boolean);
    if (!titles.includes(title)) throw new BadRequestException(`正文中没有找到章节「${title}」`);
    return this.startRevisionQueue(id, [{
      planItemId: item.planItemId,
      sectionTitle: title,
      reviewPoints: item.reviewPoints,
      reviewCommentId: item.reviewCommentId,
    }], { autoResolve: source.autoResolve });
  }

  /** 段落级 diff：当前正文 vs 指定历史版本（缺 version 时对比最新一版） */
  sectionDiff(id: string, version?: number) {
    const doc = this.get(id);
    const versions = this.parseVersions(doc);
    if (!versions.length) return { version: null as number | null, sections: [] as SectionDiffEntry[] };
    const target = typeof version === 'number'
      ? versions.find((v) => v.version === version)
      : versions[versions.length - 1];
    if (!target) throw new BadRequestException(`未找到版本 v${version}`);
    return { version: target.version, sections: sectionDiff(doc.content ?? '', target.content) };
  }

  /**
   * 段落级恢复（路线图 #2）：只把指定标题那一节回滚到历史版本，其余章节保持当前内容。
   * 恢复前自动快照当前全文——防止「恢复一节把整篇改坏」后无路可退。
   */
  restoreSection(id: string, version: number, title: string) {
    const doc = this.get(id);
    const target = this.parseVersions(doc).find((v) => v.version === version);
    if (!target) throw new BadRequestException(`未找到版本 v${version}`);
    if (!title) throw new BadRequestException('请指定要恢复的章节标题');
    const current = doc.content ?? '';
    const next = restoreSectionText(current, target.content, title);
    if (next === current) return { content: current, changed: false };
    this.createSnapshot(id, `恢复「${title}」到 v${version} 前的自动快照`);
    db.update(documents).set({ content: next, updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return { content: next, changed: true };
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
  /**
   * 手动创建版本快照（对标 git commit）。
   *
   * 返回值语义（前端契约）：
   *  - created=true：真正写入了一条快照，version 是新快照号，total 是写入后的版本总数；
   *  - created=false：内容与最新快照一致，幂等跳过，version 是最新快照号（可能为 null），total 不变。
   */
  createSnapshot(id: string, commitMessage?: string) {
    const existing = this.get(id);
    const versions = parseJson<{ version: number; content: string; updatedAt: number; name?: string; commitMessage?: string }[]>(existing.versions, []);
    // 与最新快照内容对比：相同则跳过（幂等）
    const latest = versions[versions.length - 1];
    if (latest && latest.content === existing.content) {
      return { created: false, version: latest.version, total: versions.length, versions };
    }
    const msg = commitMessage?.trim() || `手动快照 · ${new Date().toLocaleString('zh-CN')}`;
    // 快照号取「历史最大版本号 + 1」：直接复用 baseVersion 会与 update 自动快照产生同号重复（历史缺陷）
    const nextVersion = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
    const entry: { version: number; content: string; updatedAt: number; name?: string; commitMessage?: string } = { version: nextVersion, content: existing.content ?? '', updatedAt: Date.now(), commitMessage: msg };
    versions.push(entry);
    const trimmed = versions.slice(-MAX_VERSIONS);
    db.update(documents).set({ versions: JSON.stringify(trimmed), updatedAt: Date.now() }).where(eq(documents.id, id)).run();
    return { created: true, version: nextVersion, total: trimmed.length, versions: trimmed };
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
      const surname = arr.length ? cslSurname(arr[0]) : '佚名';
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
    const doc = this.get(id);
    /**
     * 输入兜底（v1.9.3 修复）：此前直接 `original: text` 落库，未传 text 时
     * `polish_record.original` 触发 NOT NULL 约束 → **HTTP 500**（未捕获的 SqliteError）。
     * 前端虽然总会传 text，但 API 契约不能依赖调用方自觉：空文本应给 400 可读提示，
     * 未传时应回落到文档正文（用户直觉：翻译这篇文档），两者都比 500 合理。
     */
    const source = String(text ?? '').trim() || String(doc.content ?? '').trim();
    if (!source) {
      throw new BadRequestException('没有可翻译的文本：请提供 text，或先为文档写入正文');
    }
    const translated = await this.ai.translate(source, targetLang);
    db.insert(polishRecords)
      .values({
        id: randomUUID(),
        documentId: id,
        type: 'translate',
        original: source,
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
        // authors 在库里是 JSON 数组字符串：必须 parseAuthors 后再拼，
        // 否则导出成 `— ["Sitao Luan","Chenqing Hua"]` 这种数组字面量（实测缺陷；docx 导出已在下方处理正确）
        const authors = parseAuthorArr(r.authors).join(', ');
        lines.push(`${i + 1}. ${r.title}${authors ? ` — ${authors}` : ''}${r.year ? ` (${r.year})` : ''}${r.venue ? `, ${r.venue}` : ''}${r.doi ? `, DOI: ${r.doi}` : ''}`);
      });
    }
    return { markdown: lines.join('\n'), filename: `${doc.title.replace(/[\\/:*?"<>|]/g, '_')}.md` };
  }

  /** 导出 Word(.docx) 全文——交稿/投稿刚需（标题 + 大纲 + 正文 + 参考文献） */
  /**
   * B-4.3 引用体检：正文锚点 × citation 落库记录交叉审计。
   *
   * v1.9 起判定逻辑下沉到 `packages/core/src/citation-audit.ts`（纯函数，可单测、CLI/前端可复用），
   * 本方法只负责取数并补齐五项历史缺口：
   *  - **N+1 消除**：原实现每条 citation 各查一次 reference（200 条引用 = 200 次查询），
   *    现改为一次 `inArray` 批量取回后交给纯函数比对
   *  - 新增「未引用条目 / 锚点断号 / 重复 DOI / 同 DOI 元数据冲突」四类判定
   *  - 尾部块识别复用 `splitBodyForAudit`，与 pipeline tail-blocks 同口径
   */
  citationAudit(documentId: string) {
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    const rows = db.select().from(citations).where(eq(citations.documentId, documentId)).all();
    const refIds = [...new Set(rows.map((r) => r.referenceId).filter(Boolean))];
    const refRows = refIds.length
      ? db
          .select({ id: references.id, title: references.title, doi: references.doi, year: references.year, authors: references.authors })
          .from(references)
          .where(inArray(references.id, refIds))
          .all()
      : [];
    return auditCitations({
      content: doc.content || '',
      citations: rows.map((r) => ({
        id: r.id,
        referenceId: r.referenceId,
        location: r.location ?? '',
        context: r.context ?? '',
        verified: r.verified ?? 0,
      })),
      references: refRows.map((r) => ({
        id: r.id,
        title: r.title ?? '',
        doi: r.doi ?? '',
        year: r.year ?? null,
        authors: r.authors ?? '[]',
      })),
    });
  }

  async exportDocx(id: string) {
    const doc = this.get(id);
    const outline = parseJson<{ title: string; sections: { title: string; subsections: string[] }[] }>(doc.outline, EMPTY_OUTLINE);
    // 按 citation 插入序（= 正文 [n] 编号）取文献；直接 inArray 的返回顺序不可依赖，会导致导出编号错位
    const refList = this.listCitations(id).map((r) => r.reference);

    const built = await buildManuscriptDocx({
      title: doc.title || '',
      outline,
      content: doc.content || '',
      refs: refList.map((r) => ({
        title: r.title,
        authors: r.authors,
        year: r.year,
        venue: r.venue,
        doi: r.doi,
      })),
    });
    return {
      base64: built.buffer.toString('base64'),
      filename: built.filename,
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
  /**
   * 客观质量检查：确定性规则引擎（packages/core/quality-audit）。
   * 与 LLM 7 维评审互补——LLM 评「好不好」，这里评「合不合格」，后者可复现、可对比。
   */
  objectiveAudit(id: string) {
    const doc = db.select().from(documents).where(eq(documents.id, id)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    const content = String(doc.content || '');
    // 仓库引用契约：正文只有 [n] 锚点，列表由前端/导出渲染；所以把 citation 表条数传给检查器，
    // 否则会把「没有内嵌参考文献块」误判成硬伤（实测踩到）。
    const citationCount = (db.select().from(citations).where(eq(citations.documentId, id)).all() || []).length;
    const report = checkPaperQuality(content, { citationCount, standard: readProjectQualityStandard(doc.projectId) });
    // 附带历史 LLM 评分，便于对照「机械分」与「模型分」的漂移。
    // 新行 total_score 已是客观分：必须读 llm_score/llm_scores，老行回落到 total_score/scores。
    const history = db.select().from(qualityReports).where(eq(qualityReports.documentId, id)).all()
      .map((r) => ({ totalScore: r.llmScore ?? r.totalScore, createdAt: r.createdAt, scores: r.llmScores && r.llmScores !== '{}' ? r.llmScores : r.scores }));
    return { documentId: id, title: doc.title, report, llmHistory: history.slice(-5) };
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

/**
 * 格式别名归一：外部调用方常把 GB/T 7714 写成 `gb7714`、`gb-t-7714`、`gbt7714`。
 * 内部正式 key 是 `gbt`；不归一会静默回落 APA（实测导出结果与预期不符）。
 */
export function normalizeCiteFormat(format: string): string {
  const raw = String(format || '').trim().toLowerCase().replace(/[\s_/]+/g, '-');
  if (/^(gb-?t?-?7714|gbt-?7714|gb7714)(-\d{4})?$/.test(raw)) return 'gbt';
  if (raw === 'bib' || raw === 'bibtex') return 'bibtex';
  if (raw === 'ris') return 'ris';
  return raw;
}

/**
 * 用 citation-js CSL 引擎渲染参考文献列表（替代手写的 formatCitation + formatRefEntry8）。
 * BibTeX 直接用 citation-js bibtex 输出。
 */
export function renderCitationsAsBibliography(
  rows: { reference: { id: string; title: string; authors: string | null; year: number | null; venue: string | null; doi: string | null } }[],
  format: string,
): string[] {
  const normalized = normalizeCiteFormat(format);
  const entries = rows.map((row) => buildCslEntry(row.reference));
  const cite = new Cite(entries);

  // bibtex 走 citation-js 原生输出（标准 LaTeX 合规）
  if (normalized === 'bibtex') {
    return [cite.format('bibtex')];
  }

  const template = CSL_TEMPLATE_MAP[normalized] || 'apa';
  const formatted = cite.format('bibliography', { format: 'text', template, lang: 'zh-CN' });
  return formatted.split('\n').filter((l) => l.trim());
}

/** 兼容 export 名（老接口 exportCitations）：单条渲染 + 序号样式补全局编号 */
export function formatCitation(
  ref: { title: string; authors: string; year: number | null; venue: string; doi: string },
  format: string,
  index: number,
): string {
  const normalized = normalizeCiteFormat(format);
  const result = renderCitationsAsBibliography([{ reference: { ...ref, id: 'entry', authors: ref.authors || null, venue: ref.venue || null, doi: ref.doi || null } }], normalized);
  let line = result[0] || '';
  // 顺序编码制官方样式（IEEE/GB-T/Nature/Vancouver/ACS）单条渲染会自带从 1 起的编号，
  // 这里剥离后重写为调用方指定的全局序号；著者-年样式（apa/chicago/springer）不编号。
  const NUMERIC_STYLES = ['ieee', 'vancouver', 'gbt', 'nature', 'acs'];
  if (NUMERIC_STYLES.includes(normalized)) {
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
