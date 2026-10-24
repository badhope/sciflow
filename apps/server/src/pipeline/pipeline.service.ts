import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { eq, and, sql, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import { Command } from '@langchain/langgraph';
import { db } from '../db/database';
import { pipelineTasks, documents, pipelineConfigs, appSettings, projects, llmCallLogs } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { ReferencesService, PaperHit } from '../references/references.service';
import { parseJson, parseStringList } from '../common/json-guard';
import { PIPELINE_UI_STEPS, PIPELINE_STEP_KEYS } from '../common/pipeline-steps';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { CitationRenderer } from './citation-renderer';
import { AgentTraceService } from '../agent/agent-trace.service';
import { reflexionLogs } from '../db/schema';
import { buildPipelineGraph, type PipelineGraphDeps, type StepStatusWire } from './pipeline.graph';
import type { Outline, PipelineTaskRow, ResearchPlan } from './pipeline-state';
import { envInt } from '../../../../packages/core/src/env';

/** UI 步骤条（单一来源：packages/core/pipeline-steps） */
const STEPS: { key: string; label: string }[] = PIPELINE_UI_STEPS.map((s) => ({ key: s.key, label: s.label }));

const ZERO_HIT_NOTICE = '研究阶段未在本地文献库/知识库检索到相关条目，已依赖模型知识完成起草；建议到「文献调研」页添加相关文献（粘贴 DOI/导入 BibTeX）、检查关键词拼写，或在知识库上传资料后重新运行。';

export interface PipelineStepState {
  key: string; label: string;
  status: StepStatusWire;
  output?: string; retryCount: number;
  /** F2 反共识大纲变体（仅 outline 步骤、awaiting_confirmation 时有值）：Outline JSON 串数组 */
  variants?: string[];
  /** F-2.7 时间线：步骤起止毫秒时间戳（running 首次写入 startedAt，终态写 endedAt） */
  startedAt?: number;
  endedAt?: number;
}

interface ResearchMeta { lib: { title: string; score: number }[]; kn: PaperHit[]; }

/**
 * 流水线服务（LangGraph 编排门面）：
 * - 编排/断点续跑/人工确认全部由 `pipeline.graph.ts` 的图承担（checkpointer = SQLite）。
 * - 本类保留：公开 API（controller/cli 契约不变）、状态投影（pipeline_task.steps JSON 契约不变）、
 *   领域辅助（跨库检索增强、引用池构建、并行分章起草）。
 */
/** 步骤状态投影纯函数：notify 与测试共用同一语义（时间戳只增不改，终态补 endedAt） */
export function applyStepWire(
  s: PipelineStepState,
  status: StepStatusWire,
  output: string | undefined,
  retryCount: number | undefined,
  extra: { variants?: string[] } | undefined,
  now: number,
): void {
  s.status = status;
  if (output !== undefined) s.output = output;
  if (retryCount !== undefined) s.retryCount = retryCount;
  if (extra?.variants?.length) s.variants = extra.variants;
  if (status === 'running' && s.startedAt === undefined) s.startedAt = now;
  if (status === 'done' || status === 'failed' || status === 'skipped') {
    s.endedAt = now;
    if (s.startedAt === undefined) s.startedAt = now;
  }
}

@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);
  private readonly citationRenderer = new CitationRenderer(db);
  private graph!: ReturnType<typeof buildPipelineGraph>;
  private readonly draftingLimit = pLimit(envInt('AI_DRAFT_CONCURRENCY', 3, { min: 1, max: 20 }));

  /** taskId → agent_execution runId（每次图调用一次执行记录，断点续跑开新记录） */
  private readonly traceRuns = new Map<string, string>();
  /** runId → 本轮图调用开始时间（按时间窗聚合 LLM token，避免 total_tokens 恒 0） */
  private readonly runStartedAt = new Map<string, number>();

  constructor(
    private readonly ai: AiService,
    private readonly references: ReferencesService,
    private readonly knowledge: KnowledgeService,
    private readonly trace: AgentTraceService,
  ) {}

  onModuleInit() {
    const deps: PipelineGraphDeps = {
      ai: {
        summarizeLiterature: (t, p) => this.ai.summarizeLiterature(t, p),
        writeOutline: (t, s) => this.ai.writeOutline(t, s),
        writeOutlineVariants: (t, s) => this.ai.writeOutlineVariants(t, s),
        planResearch: (t) =>
          this.ai.writeSearchPlan(t).catch((e: any) => {
            this.logger.warn(`检索规划失败（回退主题词）: ${e?.message || e}`);
            return { keywords: [t] };
          }),
        reviewPaper: (t, c) => this.ai.reviewPaper(t, c),
        polish: (t) => this.ai.polish(t),
        extractEpisodic: (p, t, o, s) => this.ai.extractEpisodic(p, t, o, s),
        generateFigures: (t, o, c) => this.ai.generateFigures(t, o, c),
      },
      runDrafting: (taskId, title, outline, refsPrompt, styleHint, reflexion, onProgress) =>
        this.runDrafting(taskId, title, outline, refsPrompt, styleHint, reflexion, onProgress),      buildRefsPrompt: (projectId) => this.referencesForPrompt(projectId),
      renderCitations: (projectId, docId, content, meta) => {
        const refPool = this.refsForDraft(projectId);
        return this.citationRenderer.render(docId, content, refPool, [], [], meta.kn);
      },
      crossEnrich: async (projectId, topic, plan) => {
        // 多语关键词逐条检索本地文献库（LIKE），按 id 去重合并后做匹配度打分
        const queries = [topic, ...(plan.searchStrategy?.keywords || [])].filter(Boolean).slice(0, 6);
        const seen = new Map<string, PaperHit>();
        for (const q of queries) {
          try {
            for (const h of this.references.search(String(q), 20, projectId)) {
              const key = h.id || `${h.title}:${h.year ?? ''}`;
              if (!seen.has(key)) seen.set(key, h);
            }
          } catch (e: any) {
            this.logger.warn(`文献库检索失败 [${q}]: ${e?.message || e}`);
          }
        }
        const enriched = await this.crossEnrichResearch(projectId, topic, plan, [...seen.values()]);
        if (enriched.libraryHits.length > 0) this.references.importPipelineHits(projectId, enriched.libraryHits);
        const refs = this.references.list(projectId);
        const summary = refs.length
          ? await this.ai.summarizeLiterature(topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n'))
          : '（未检索到文献，将按通用学术结构起草）';
        const totalFound = enriched.libraryHits.length + enriched.knowledgeHits.length;
        return {
          libraryHits: enriched.libraryHits,
          knowledgeHits: enriched.knowledgeHits,
          notice: enriched.notice,
          meta: enriched.meta,
          summary: `检索到 ${totalFound} 条（文献 ${enriched.libraryHits.length} / 知识 ${enriched.knowledgeHits.length}）\n${summary.slice(0, 500)}`,
        };
      },
      notify: (taskId, key, status, output, retryCount, extra) => this.notify(taskId, key, status, output, retryCount, extra),
      trackBudget: (taskId) => this.trackBudget(taskId),
      stepEnabled: (key) => this.stepEnabled(key),
      researchDepth: () => this.researchDepth(),
      logger: this.logger,
    };
    this.graph = buildPipelineGraph(deps);
  }

  // ─── 公开 API（controller 调用） ──────────────────────────────
  /** H2：任务级 token 预算器（task → 累计 tokens）。默认 300k，app_setting pipeline_token_budget 可调，0=关闭 */
  private budget = new Map<string, number>();
  private trackBudget(taskId: string): void {
    const spent = (this.budget.get(taskId) || 0) + this.ai.lastTotalTokens;
    this.budget.set(taskId, spent);
    let cap = 300_000;
    try {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'pipeline_token_budget')).get();
      if (row) cap = Number(row.value) || 0;
    } catch { /* 表未建时用默认 */ }
    if (cap > 0 && spent > cap) {
      throw new BadRequestException(
        `流水线 token 预算耗尽（累计 ${spent} > 上限 ${cap}）。可在设置中调整 pipeline_token_budget（0=不限）后重跑。`,
      );
    }
  }

  create(projectId: string, topic: string) {
    if (!projectId?.trim()) throw new BadRequestException('projectId 必填');
    if (!topic?.trim()) throw new BadRequestException('请先输入研究主题');
    const project = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId.trim())).get();
    if (!project) throw new BadRequestException('项目不存在');
    if (!this.ai.configured) throw new BadRequestException('AI 服务未配置：请在 apps/server/.env 设置 AI_API_KEY 后再运行流水线');
    // 项目级并发互斥（H5）：同项目同时只允许一条 running 流水线。
    // 背景：起草并行池 p-limit(3) 全局共享，双任务并行=6 路并发 → 429 风暴 + 成本翻倍；
    // SQLite 同步写入无竞态窗口，DB 检查即互斥点。
    const running = db
      .select({ id: pipelineTasks.id })
      .from(pipelineTasks)
      .where(and(eq(pipelineTasks.projectId, projectId), eq(pipelineTasks.status, 'running')))
      .get();
    if (running) {
      throw new BadRequestException(`该项目已有流水线在运行中（${running.id.slice(0, 8)}…）。请等待完成、在流水线页停止后再新建，或查看其他项目的任务。`);
    }
    const now = Date.now();
    const task = {
      id: randomUUID(), projectId, documentId: null as string | null, topic: topic.trim(),
      currentStep: 'topic-verify', status: 'running',
      steps: JSON.stringify(STEPS.map((s) => ({ key: s.key, label: s.label, status: 'pending' as const, retryCount: 0 }))),
      retryCount: 0, lastError: '', createdAt: now, updatedAt: now,
    };
    db.insert(pipelineTasks).values(task).run();
    this.budget.set(task.id, 0);
    void this.invokeGraph(task.id, { taskId: task.id, task: this.getTaskRow(task.id) });
    return this.get(task.id);
  }

  get(id: string) {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    if (!row) throw new NotFoundException('流水线任务不存在');
    return { ...row, steps: parseJson<PipelineStepState[]>(row.steps, []) };
  }

  listByProject(projectId: string) {
    return db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, projectId)).orderBy(pipelineTasks.createdAt);
  }

  remove(id: string) {
    const task = this.get(id);
    if (task.status === 'running') throw new BadRequestException('流水线正在运行，请等待完成或先停止后再删除');
    db.transaction((tx) => {
      tx.delete(pipelineTasks).where(eq(pipelineTasks.id, id)).run();
      tx.delete(reflexionLogs).where(eq(reflexionLogs.taskId, id)).run();
      // LangGraph checkpoint 表：thread_id = taskId（不清理会在断点续跑时复活已删任务）
      try {
        tx.run(sql`DELETE FROM writes WHERE thread_id = ${id}`);
        tx.run(sql`DELETE FROM checkpoints WHERE thread_id = ${id}`);
      } catch { /* 旧库可能没有 checkpoint 表 */ }
    });
    return { ok: true };
  }

  async confirmOutline(taskId: string, editedOutline?: { title: string; sections: { title: string; subsections: string[] }[] }) {
    const task = this.get(taskId);
    if (task.status !== 'awaiting_confirmation') throw new BadRequestException('当前不在大纲确认节点');
    const outlineStep = task.steps.find((s) => s.key === 'outline');
    const outline = editedOutline || parseJson<Outline>(outlineStep?.output, { title: task.topic, sections: [] });
    await this.notify(taskId, 'outline', 'done', JSON.stringify(outline));
    this.setStatus(taskId, 'running', 'quality-gate');
    void this.invokeGraph(taskId, new Command({ resume: { edited: outline } }));
    return this.get(taskId);
  }

  resumeInterrupted() {
    const rows = db.select().from(pipelineTasks).where(eq(pipelineTasks.status, 'running')).all();
    for (const t of rows) {
      if (t.documentId) {
        const steps = parseJson<PipelineStepState[]>(t.steps, []);
        let resumed = false;
        for (const s of steps) {
          if (s.key === 'quality-gate') { s.status = 'running'; s.output = '服务重启后续跑（checkpoint 恢复）'; resumed = true; }
          else if (resumed) s.status = 'pending';
        }
        // 续跑会整篇重起草并覆盖正文：若文档在任务之后被人工编辑过，绝不自动覆盖，改为等待用户确认
        const doc = db.select().from(documents).where(eq(documents.id, t.documentId)).get();
        if (doc?.updatedAt && t.updatedAt && doc.updatedAt > t.updatedAt) {
          this.setStatus(t.id, 'interrupted', '', '服务重启中断：文档在中断期间被编辑过，为避免覆盖你的修改未自动续跑，请重新发起流水线或在页面确认续跑');
          this.logger.warn(`[checkpoint] 任务 ${t.id} 文档已被人工更新（doc ${new Date(doc.updatedAt).toISOString()} > task ${new Date(t.updatedAt).toISOString()}），跳过自动覆盖式续跑`);
          continue;
        }
        db.update(pipelineTasks).set({ steps: JSON.stringify(steps), status: 'running', currentStep: 'quality-gate', lastError: '', updatedAt: Date.now() }).where(eq(pipelineTasks.id, t.id)).run();
        this.logger.log(`[checkpoint] 任务 ${t.id} 断点续跑（LangGraph checkpoint 恢复）`);
        void this.invokeGraph(t.id, null);
      } else {
        this.logger.warn(`[checkpoint] 任务 ${t.id} 中断于前半段（无产物文档），标记 interrupted`);
        this.setStatus(t.id, 'interrupted', '', '服务重启中断，前半段任务请删除后重新启动');
      }
    }
    return rows.length;
  }

  // ─── 图调用（统一错误处理与终态投影） ──────────────────────────
  private async invokeGraph(taskId: string, input: { taskId: string; task: PipelineTaskRow } | Command | null) {
    const resume = input instanceof Command;
    let runId: string | undefined;
    try {
      const task = this.getTaskRow(taskId);
      runId = this.trace.startRun({ projectId: task.projectId, source: resume ? 'pipeline-resume' : 'pipeline', input: task.topic, model: this.ai.config.model });
      this.traceRuns.set(taskId, runId);
      this.runStartedAt.set(runId, Date.now());
      const cfg = { configurable: { thread_id: taskId } };
      const result = await this.graph.invoke(input as never, cfg as never);
      const interrupts = (result as { __interrupt__?: unknown[] } | undefined)?.__interrupt__;
      const tokens = this.tokensSince(this.runStartedAt.get(runId) || Date.now());
      if (interrupts && interrupts.length > 0) {
        this.setStatus(taskId, 'awaiting_confirmation', 'outline');
        this.trace.finishRun(runId, { status: 'done', outputSummary: '大纲待人工确认（interrupt 挂起）', totalTokens: tokens });
      } else {
        this.setStatus(taskId, 'completed', 'complete');
        this.trace.finishRun(runId, { status: 'done', outputSummary: '流水线完成', totalTokens: tokens });
      }
    } catch (e: any) {
      this.logger.error(`流水线 ${taskId} 执行失败: ${e.message}`);
      const steps = this.loadSteps(taskId);
      const cur = steps.find((s) => s.status === 'running' || s.status === 'awaiting_confirmation');
      if (cur) cur.status = 'failed';
      this.saveSteps(taskId, steps);
      this.setStatus(taskId, 'failed', cur?.key || '', e.message || String(e));
      if (runId) this.trace.finishRun(runId, { status: 'error', error: e.message || String(e), totalTokens: this.tokensSince(this.runStartedAt.get(runId) || Date.now()) });
    } finally {
      this.traceRuns.delete(taskId);
      if (runId) this.runStartedAt.delete(runId);
    }
  }

  // ─── 状态机（pipeline_task.steps JSON 投影，前端契约不变） ──────
  private loadSteps(id: string): PipelineStepState[] {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    return parseJson<PipelineStepState[]>(row?.steps, []);
  }

  private saveSteps(id: string, steps: PipelineStepState[]) {
    db.update(pipelineTasks).set({ steps: JSON.stringify(steps), updatedAt: Date.now() }).where(eq(pipelineTasks.id, id)).run();
  }

  private setStatus(id: string, status: string, currentStep = '', lastError = '') {
    db.update(pipelineTasks).set({ status, currentStep: currentStep || undefined, lastError: lastError || '', updatedAt: Date.now() }).where(eq(pipelineTasks.id, id)).run();
  }

  private stepEnabled(key: string): boolean {
    if (!PIPELINE_STEP_KEYS.has(key)) {
      // 未知 key 说明调用方与清单脱节：显式告警，默认放行（不因配置缺失阻断流水线）
      this.logger.warn(`[pipeline] stepEnabled 收到未注册的步骤 key「${key}」，已按启用处理`);
      return true;
    }
    try {
      const r = db.select().from(pipelineConfigs).where(eq(pipelineConfigs.stepKey, key)).get();
      return !r || (r.enabled ?? 1) === 1;
    } catch {
      return true;
    }
  }

  private async notify(taskId: string, key: string, status: StepStatusWire, output?: string, retryCount?: number, extra?: { variants?: string[] }) {
    const steps = this.loadSteps(taskId);
    const s = steps.find((x) => x.key === key);
    if (!s) return;
    applyStepWire(s, status, output, retryCount, extra, Date.now());
    this.saveSteps(taskId, steps);
    if (status === 'running') this.setStatus(taskId, 'running', key);
    else if (status === 'awaiting_confirmation') this.setStatus(taskId, 'awaiting_confirmation', key);
    // Agent 执行轨迹（agent_execution/agent_step）：每个步骤起止各记一条
    const runId = this.traceRuns.get(taskId);
    if (runId) {
      this.trace.addStep(runId, {
        kind: 'tool',
        title: `${key} · ${status}`,
        output: output || '',
        toolName: key,
        status: status === 'failed' ? 'error' : 'ok',
      });
    }
  }

  /** 研究深度（1-3，默认 1）：app_setting pipeline_research_depth，非法值静默回默认 */
  private researchDepth(): number {
    try {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'pipeline_research_depth')).get();
      const n = Math.floor(Number(row?.value));
      if (!Number.isFinite(n)) return 1;
      return Math.max(1, Math.min(3, n));
    } catch {
      return 1;
    }
  }

  /** 时间窗内 LLM token 合计（用于把 Agent 执行与真实成本对上，历史恒 0） */
  private tokensSince(since: number): number {
    try {
      const row = db.select({ total: sql<number>`COALESCE(SUM(${llmCallLogs.totalTokens}), 0)` })
        .from(llmCallLogs)
        .where(and(gte(llmCallLogs.createdAt, since), eq(llmCallLogs.kind, 'llm')))
        .get();
      return Number(row?.total || 0);
    } catch {
      return 0;
    }
  }

  // ─── 辅助方法：跨库检索增强 ────────────────────────────────────
  private static tokenize(text: string): string[] {
    const t = (text || '').toLowerCase();
    const toks: string[] = [];
    for (const m of t.matchAll(/[a-z][a-z0-9_-]{1,}/g)) toks.push(m[0]);
    const cn = t.replace(/[^一-龥]/g, '');
    for (let i = 0; i < cn.length - 1; i++) toks.push(cn.slice(i, i + 2));
    return toks;
  }

  private static scoreLibraryHit(query: string, hit: PaperHit): number {
    const qt = new Set(PipelineService.tokenize(query));
    if (qt.size === 0) return 0.5;
    const titleT = PipelineService.tokenize(hit.title);
    const abT = PipelineService.tokenize(hit.abstract || '');
    let hitCount = 0, titleHits = 0;
    for (const t of qt) { if (titleT.includes(t)) { hitCount++; titleHits++; } else if (abT.includes(t)) hitCount++; }
    const ratio = hitCount / qt.size;
    return Math.min(1, Math.round((ratio * 0.7 + Math.min(1, titleHits / qt.size) * 0.3) * 100) / 100);
  }

  private static normalizeKnScore(score: number): number {
    return Math.min(1, Math.round(Math.max(0, score) / 8 * 100) / 100);
  }

  private async crossEnrichResearch(projectId: string, topic: string, plan: ResearchPlan, libraryHits: PaperHit[]): Promise<{ libraryHits: PaperHit[]; knowledgeHits: PaperHit[]; notice: string | null; meta: ResearchMeta }> {
    const queryBag = [topic, ...(plan.searchStrategy?.keywords || [])].filter(Boolean).join(' ');
    const lib: PaperHit[] = libraryHits.map((h) => ({ ...h, origin: 'library' as const, matchScore: PipelineService.scoreLibraryHit(queryBag, h) }));
    const knQueries = [topic, ...(plan.searchStrategy?.keywords || [])].filter(Boolean).slice(0, 4);
    const knSeen = new Set<string>();
    const knAll: PaperHit[] = [];
    for (const q of knQueries) {
      try {
        const chunks = await this.knowledge.search(projectId, q, 3);
        for (const c of chunks) {
          const key = `${c.docId || c.id}:${c.id}`;
          if (knSeen.has(key)) continue;
          knSeen.add(key);
          knAll.push({ title: c.docName || '未命名资料', authors: [], year: null, venue: '知识库', doi: '', url: '', abstract: (c.content || '').replace(/\s+/g, ' ').trim().slice(0, 300), source: 'manual', citationCount: 0, origin: 'knowledge' as const, matchScore: PipelineService.normalizeKnScore(c.score) });
        }
      } catch (e: any) { this.logger.warn(`知识库跨库检索失败 [${q}]: ${e?.message || e}`); }
    }
    const knByDoc = new Map<string, PaperHit>();
    for (const h of knAll) { const ex = knByDoc.get(h.title); if (!ex || (h.matchScore || 0) > (ex.matchScore || 0)) knByDoc.set(h.title, h); }
    const kn = [...knByDoc.values()].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0, 5);
    const total = lib.length + kn.length;
    return { libraryHits: lib, knowledgeHits: kn, notice: total === 0 ? ZERO_HIT_NOTICE : null, meta: { lib: lib.map((h) => ({ title: h.title, score: h.matchScore ?? 0 })), kn } };
  }

  // ─── 起草（并行：p-limit，AI_DRAFT_CONCURRENCY 可配，默认 3；onProgress 逐节进度） ────
  private async runDrafting(
    taskId: string,
    title: string,
    outline: Outline,
    referencesPrompt: string,
    styleHint: string,
    reflexion: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<string> {
    void title;
    const taskIdRef = taskId;
    const sections = outline?.sections || [];
    const outlineJson = JSON.stringify(outline);
    const ctx = `${referencesPrompt}\n\n${styleHint}\n\n${reflexion}`.trim();
    let done = 0;
    const parts = await Promise.all(
      sections.map((sec, i) =>
        this.draftingLimit(async () => {
          const sectionTitle = typeof sec === 'string' ? sec : sec.title;
          const content = await this.ai.draftSection(sectionTitle, outlineJson, ctx);
          this.trackBudget(taskIdRef); // H2：起草成本打点（起草占全流程 token 大头）
          done += 1;
          onProgress?.(done, sections.length);
          return { i, text: `## ${sectionTitle}\n\n${content}` };
        }),
      ),
    );
    return parts.sort((a, b) => a.i - b.i).map((p) => p.text).join('\n\n');
  }

  private refsForDraft(projectId: string) {
    const all = this.references.list(projectId);
    const meta = all.filter((r) => { const a = parseStringList(r.authors); return a.length > 0 && !!r.year; });
    return meta.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0)).slice(0, 20);
  }

  private referencesForPrompt(projectId: string, refs?: ReturnType<PipelineService['refsForDraft']>): string {
    const pool = refs ?? this.refsForDraft(projectId);
    return pool.map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）`).join('\n');
  }

  /** Fetch typed PipelineTaskRow (without parsed steps array) */
  private getTaskRow(id: string): PipelineTaskRow {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    if (!row) throw new NotFoundException('流水线任务不存在');
    return row;
  }
}
