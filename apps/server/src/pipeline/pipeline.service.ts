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
import { WebSearchService } from '../websearch/websearch.service';
import { ConfigCenterService } from '../config/config-center.service';
import { ScholarSearchService } from '../research/scholar-search.service';
import { buildWebHits, isWebSearchEnabled } from './pipeline-websearch';
import { normalizeKnScore, noveltyOverlap } from './pipeline-metrics';
import { envInt } from '../common/env';

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
  if (status === 'done' || status === 'failed' || status === 'skipped' || status === 'cancelled') {
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
  /** taskId → 用户主动停止标记（区分「用户停止」与「执行失败」，避免 catch 把 cancelled 覆盖成 failed） */
  private readonly stoppedTasks = new Set<string>();

  constructor(
    private readonly ai: AiService,
    private readonly references: ReferencesService,
    private readonly knowledge: KnowledgeService,
    private readonly trace: AgentTraceService,
    private readonly websearch: WebSearchService,
    private readonly config: ConfigCenterService,
    private readonly scholar: ScholarSearchService,
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
        this.runDrafting(taskId, title, outline, refsPrompt, styleHint, reflexion, onProgress),
      buildRefsPrompt: (projectId, topic, keywords) => this.referencesForPrompt(projectId, undefined, topic, keywords),
      renderCitations: (projectId, docId, content, meta, topic, keywords) => {
        // 必须与起草时的池输入完全一致（projectId/topic/keywords），[Ref:N] 编号才不会错位
        const refPool = this.refsForDraft(projectId, topic, keywords);
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
        // 内置学术检索（免 Key）：本地库为空/不足时用 OpenAlex + Crossref + arXiv 补真实文献元数据，
        // 否则全新项目的起草阶段完全没有参考文献，引用闭环必然为空（客观质量分被引用维度拖死）。
        if (this.scholar.isEnabled((k) => this.readSetting(k))) {
          try {
            const existingTitles = new Set([...seen.values()].map((h) => String(h.title || '').toLowerCase().trim()));
            // 英文检索词优先（OpenAlex/Crossref 对中文长句检索噪声大），主题串殿后兜底
            const kws = [...(plan.searchStrategy?.keywords || []).filter(Boolean), topic].filter(Boolean).slice(0, 4);
            const scholarHits = await this.scholar.search(kws.map(String), 8);
            let added = 0;
            for (const h of scholarHits) {
              const key = h.doi ? `doi:${h.doi.toLowerCase()}` : `t:${String(h.title).toLowerCase().trim()}`;
              if (seen.has(key) || existingTitles.has(String(h.title).toLowerCase().trim())) continue;
              seen.set(key, {
                title: h.title, authors: h.authors, year: h.year, venue: h.venue, doi: h.doi, url: h.url,
                abstract: h.abstract, source: 'scholar', citationCount: h.citationCount,
              });
              existingTitles.add(String(h.title).toLowerCase().trim());
              added += 1;
            }
            if (added) this.logger.log(`[scholar] 学术检索补充 ${added} 条真实文献（openalex/crossref/arxiv）`);
          } catch (e: any) {
            this.logger.warn(`学术检索失败（已忽略，不影响流程）：${e?.message || e}`);
          }
        }
        const enriched = await this.crossEnrichResearch(projectId, topic, plan, [...seen.values()]);
        if (enriched.libraryHits.length > 0) this.references.importPipelineHits(projectId, enriched.libraryHits);
        const refs = this.references.list(projectId);
        const summary = refs.length
          ? await this.ai.summarizeLiterature(topic, refs.slice(0, 10).map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}）`).join('\n'))
          : '（未检索到文献，将按通用学术结构起草）';
        // 联网检索（默认关闭，WEBSEARCH_IN_PIPELINE=on 或设置页开启）：
        // 本地库/知识库 0 命中时提供真实外部线索，避免完全依赖模型内部知识。
        let webHits: PaperHit[] = [];
        if (isWebSearchEnabled((k) => this.readSetting(k))) {
          try {
            const results = await this.websearch.search(`${topic} ${(plan.searchStrategy?.keywords || []).slice(0, 2).join(' ')}`.trim());
            webHits = buildWebHits(results);
          } catch (e: any) {
            this.logger.warn(`流水线联网检索失败（已忽略，不影响流程）: ${e?.message || e}`);
          }
        }
        const totalFound = enriched.libraryHits.length + enriched.knowledgeHits.length;
        // 线索只对「本次运行」有效：每轮覆盖写入，并限制 Map 规模（项目数无上限，避免长跑内存滞留）
        this.webHintForProject.delete(projectId);
        if (webHits.length) {
          this.webHintForProject.set(projectId, webHits);
          while (this.webHintForProject.size > 50) {
            const oldest = this.webHintForProject.keys().next().value;
            if (oldest === undefined) break;
            this.webHintForProject.delete(oldest);
          }
        }
        const webNote = webHits.length ? `\n联网检索补充 ${webHits.length} 条公开网页线索（仅作背景参考，未入库，引用前请自行核验）。` : '';
        return {
          libraryHits: enriched.libraryHits,
          knowledgeHits: enriched.knowledgeHits,
          webHits,
          notice: enriched.notice,
          meta: enriched.meta,
          summary: `检索到 ${totalFound} 条（文献 ${enriched.libraryHits.length} / 知识 ${enriched.knowledgeHits.length}）${webNote}\n${summary.slice(0, 500)}`,
        };
      },
      notify: (taskId, key, status, output, retryCount, extra) => this.notify(taskId, key, status, output, retryCount, extra),
      trackBudget: (taskId, caller) => this.trackBudget(taskId, caller),
      stepEnabled: (key) => this.stepEnabled(key),
      researchDepth: () => this.researchDepth(),
      noveltyCheck: (topic) => this.noveltyCheck(topic),
      logger: this.logger,
    };
    this.graph = buildPipelineGraph(deps);
  }

  // ─── 公开 API（controller 调用） ──────────────────────────────
  /** H2：任务级 token 预算器（task → 累计 tokens）。默认 300k，app_setting pipeline_token_budget 可调，0=关闭 */
  private budget = new Map<string, number>();
  private trackBudget(taskId: string, caller: string): void {
    // 按 caller 读取（不是全局 lastTotalTokens）：并行起草时全局值会被最后一个完成者覆盖 → 预算漏计
    const spent = (this.budget.get(taskId) || 0) + this.ai.lastTokensFor(caller);
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

  async create(projectId: string, topic: string) {
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
    // pipeline:before 钩子：block 在此拦截（返回 400 可读原因），webhook 异步执行
    const before = await this.config.runEventHooks('pipeline:before', { topic: topic.trim(), projectId }, 'pipeline');
    if (before.blocked) throw new BadRequestException(before.blocked);
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

  /**
   * 重跑一个已结束（failed / interrupted / completed）的任务：用同一主题、同一项目起一条新任务。
   *
   * 为什么需要：失败任务的唯一出路原来是「删除 + 重新输入主题启动」，主题还得多打一遍；
   * 用户实测被卡住的 5.5h 任务连重跑按钮都没有。这里复用 create() 的全部前置校验
   * （项目存在、AI 已配置、同项目 running 互斥、pipeline:before 钩子），只把 topic 带过来，
   * 并记录 retryOf 便于追踪来源。
   */
  async rerun(id: string) {
    const src = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    if (!src) throw new NotFoundException('流水线任务不存在');
    if (src.status === 'running' || src.status === 'awaiting_confirmation') {
      throw new BadRequestException('该任务仍在运行中，请先停止后再重跑');
    }
    const created = await this.create(src.projectId, src.topic);
    this.logger.log(`[流水线] 任务 ${id.slice(0, 8)} 重跑 → 新任务 ${created.id.slice(0, 8)}（主题：${src.topic.slice(0, 40)}）`);
    return created;
  }

  get(id: string) {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    if (!row) throw new NotFoundException('流水线任务不存在');
    return { ...row, steps: parseJson<PipelineStepState[]>(row.steps, []) };
  }

  listByProject(projectId: string) {
    return db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, projectId)).orderBy(pipelineTasks.createdAt);
  }

  /** 全量任务（仅本地单用户模式使用；企业模式由 controller 拒绝） */
  listAll() {
    return db.select().from(pipelineTasks).orderBy(pipelineTasks.createdAt);
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

  /**
   * 停止运行中的流水线（用户主动中止）。
   *
   * 背景：此前没有停止入口，上游网关挂起时任务永久 running，DELETE 又要求「先停止」，
   * 用户唯一出路是重启服务（真实事故：quality-gate 卡死 17.5 分钟）。
   *
   * 语义：
   *  - 只允许 running / awaiting_confirmation → cancelled；其他状态 400。
   *  - 内存标记 stoppedTasks 让 invokeGraph 的 catch 不再把它改写成 failed。
   *  - 运行中的步骤标 cancelled（保留 startedAt/endedAt 供时间线展示），未开始的标 skipped。
   *  - 实际的上游 LLM 请求由请求级超时（AI_REQUEST_TIMEOUT_MS）兜底结束，不阻塞接口返回。
   */
  stop(id: string) {
    const task = this.get(id);
    if (task.status !== 'running' && task.status !== 'awaiting_confirmation') {
      throw new BadRequestException(`流水线不在运行中（当前状态：${task.status}），无需停止`);
    }
    // 只有图确实在跑时才需要「阻止在途节点回写」的标记（该标记由 invokeGraph 的 finally 清理）。
    // 若只是库里残留 running（服务重启后未续跑），无条件写入会永久残留并阻断该任务后续 notify。
    const inFlight = this.traceRuns.has(id);
    if (inFlight) this.stoppedTasks.add(id);
    const steps = task.steps as PipelineStepState[];
    for (const s of steps) {
      if (s.status === 'running' || s.status === 'awaiting_confirmation' || s.status === 'retry') {
        applyStepWire(s, 'cancelled', '用户已停止', undefined, undefined, Date.now());
      } else if (s.status === 'pending') {
        s.status = 'skipped';
      }
    }
    db.update(pipelineTasks)
      .set({ steps: JSON.stringify(steps), status: 'cancelled', currentStep: '', lastError: '用户停止：任务已中止（可删除后重新运行）', updatedAt: Date.now() })
      .where(eq(pipelineTasks.id, id))
      .run();
    const runId = this.traceRuns.get(id);
    if (runId) this.trace.finishRun(runId, { status: 'done', outputSummary: '用户停止' });
    this.budget.delete(id);
    this.logger.warn(`流水线 ${id} 已被用户停止`);
    return this.get(id);
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
      // 用户在本次图执行期间点了停止：图可能正常返回（例如恰好走到 interrupt），
      // 此时绝不能把终态改回 awaiting_confirmation/completed —— 用户意图优先。
      if (this.stoppedTasks.has(taskId)) {
        this.logger.warn(`流水线 ${taskId} 已按用户停止处理（图正常返回，终态保持 cancelled）`);
        if (runId) this.trace.finishRun(runId, { status: 'done', outputSummary: '用户停止', totalTokens: this.tokensSince(this.runStartedAt.get(runId) || Date.now()) });
        return;
      }
      const interrupts = (result as { __interrupt__?: unknown[] } | undefined)?.__interrupt__;
      const tokens = this.tokensSince(this.runStartedAt.get(runId) || Date.now());
      if (interrupts && interrupts.length > 0) {
        this.setStatus(taskId, 'awaiting_confirmation', 'outline');
        this.trace.finishRun(runId, { status: 'done', outputSummary: '大纲待人工确认（interrupt 挂起）', totalTokens: tokens });
      } else {
        this.setStatus(taskId, 'completed', 'complete');
        this.trace.finishRun(runId, { status: 'done', outputSummary: '流水线完成', totalTokens: tokens });
        try {
          const t = this.getTaskRow(taskId);
          void this.config.runEventHooks('pipeline:after', { taskId, projectId: t.projectId, topic: t.topic, documentId: t.documentId, tokens }, 'pipeline');
        } catch { /* 结束钩子失败不影响终态 */ }
      }
    } catch (e: any) {
      if (this.stoppedTasks.has(taskId)) {
        // 用户主动停止：abort 会让图抛错，这里不得把 cancelled 改写成 failed
        this.logger.warn(`流水线 ${taskId} 因用户停止而中止（${String(e?.message || e).slice(0, 120)}）`);
        if (runId) this.trace.finishRun(runId, { status: 'done', outputSummary: '用户停止', totalTokens: this.tokensSince(this.runStartedAt.get(runId) || Date.now()) });
        return;
      }
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
      this.stoppedTasks.delete(taskId);
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

  /** 读取 app_setting（表未建/键不存在返回空串；供联网开关等运行参数使用） */
  private readSetting(key: string): string {
    try {
      return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? '';
    } catch {
      return '';
    }
  }

  /**
   * 新颖性预检（v1.7，对标 Elicit / Undermind 的「这个题目是不是已经有人做了」）。
   *
   * 设计取舍：
   *  - 不调 LLM：只看学术库返回的真实标题/年份，用 token 重叠度算客观指标，零 token 成本、
   *    结论可复现（LLM 判断"新颖性"会随机漂移，且对未见过的文献会编）。
   *  - 不写库：预检结果只进步骤输出与（高重叠时）产物研究说明，避免污染参考文献池。
   *  - 只取近 8 年：科研选题撞车主要发生在近期工作，老论文不影响新颖性判断。
   */
  private async noveltyCheck(topic: string): Promise<{
    skipped?: boolean;
    overlap: number;
    similar: { title: string; year: number | null; venue: string; doi: string }[];
    advice: string;
  }> {
    if (!this.scholar.isEnabled((k) => this.readSetting(k))) {
      return { skipped: true, overlap: 0, similar: [], advice: '学术检索关闭' };
    }
    const hits = await this.scholar.search([topic], 8);
    if (!hits.length) {
      return { skipped: false, overlap: 0, similar: [], advice: '学术库未找到相近工作，选题可能较新；建议再用 1-2 组同义词复核' };
    }
    const recent = hits.filter((h) => !h.year || h.year >= new Date().getFullYear() - 8);
    const pool = recent.length ? recent : hits;
    // 重叠度口径收敛到纯函数（pipeline-metrics.noveltyOverlap，含单测）：以选题 token 为分母，
    // 取最相近一篇标题的覆盖率，避免长标题把同题论文摊薄成"较新颖"的假绿灯。
    const best = noveltyOverlap(topic, pool.map((h) => h.title));
    const similar = pool
      .slice(0, 5)
      .map((h) => ({ title: h.title, year: h.year, venue: h.venue, doi: h.doi }));
    const advice =
      best >= 70
        ? '重叠度高：建议把研究问题收窄到具体子问题/新数据集/新评估协议，或在大纲里显式对比这几篇并说明增量'
        : best >= 40
          ? '重叠度中等：选题方向已有人做，需在引言明确差异化定位（方法/数据/场景/评价维度至少一项不同）'
          : '重叠度低：相近工作较少，注意确认是"真空白"还是"检索词未覆盖"';
    return { overlap: best, similar, advice };
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
    // 用户已停止：图里在途节点仍可能推状态，忽略之，避免把 cancelled 改回 running
    if (this.stoppedTasks.has(taskId)) return;
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
    return normalizeKnScore(score);
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
  /**
   * 分章起草后处理（实测发现的两类污染）：
   *  1. 模型自己又输出一遍 `## 章节标题` → 与 runDrafting 前缀重复，出现同名章节两次；
   *  2. 模型在每章末尾自造「## 参考文献」列表 → 文档变成 N 份参考文献、并把正文截断成首章。
   * 这里剥掉模型复述的标题与自造参考文献块；真正的参考文献由 citation renderer 统一渲染。
   */
  static sanitizeSectionDraft(raw: string, sectionTitle: string): string {
    let text = String(raw || '').trim();
    if (!text) return '';
    const NL = String.fromCharCode(10);
    // 去掉开头的代码围栏
    text = text.replace(new RegExp('^```(?:markdown|md)?\\s*' + NL, 'i'), '').replace(new RegExp(NL + '```\\s*$'), '');
    const esc = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 剥掉开头复述的标题（允许带序号，如 "## 3 问题定义…"）
    text = text.replace(new RegExp(`^#{1,4}\\s*(?:\\d+[.、]?\\s*)?${esc}\\s*${NL}+`, 'i'), '');
    // 截断模型自造的参考文献/引用列表块（从其标题起到文末）
    const cut = text.search(new RegExp(NL + '#{2,4}\\s*(参考文献|References|引用文献)\\s*' + NL, 'i'));
    if (cut >= 0) text = text.slice(0, cut);
    // 末尾孤立的 "参考文献：" 行
    text = text.replace(new RegExp(NL + '+参考文献[:：]?\\s*$', 'i'), '');
    return text.trim();
  }

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
          const draftRaw = await this.ai.draftSection(sectionTitle, outlineJson, ctx);
          const content = PipelineService.sanitizeSectionDraft(String(draftRaw || ''), String(sectionTitle));
          this.trackBudget(taskIdRef, 'draftSection'); // H2：起草成本打点（起草占全流程 token 大头）
          done += 1;
          onProgress?.(done, sections.length);
          return { i, text: `## ${sectionTitle}\n\n${content}` };
        }),
      ),
    );
    return parts.sort((a, b) => a.i - b.i).map((p) => p.text).join('\n\n');
  }

  /**
   * 起草用参考文献池：**按与主题的相关性排序**，而不是按引用数。
   *
   * 历史事故（本轮实测）：原实现按 citationCount 降序，导致池子里前几条是
   * DeepLab / Bagging 这类高被引通用论文，模型只能引用它们 → 论文引用与主题无关。
   * 现在：标题/摘要与主题词+检索词的重合度优先（token 级匹配，中英文各自有效），
   * 引用数只作为同分时的次要排序。
   *
   * 关键约束：起草 prompt 的 [Ref:N] 编号与本池顺序一一对应，渲染引用时必须用
   * 完全相同的输入（projectId, topic, keywords）重算同一池，否则锚点错位。
   * 相关条目 ≥8 时直接丢弃零相关条目（旧库遗留的离题文献不再混入起草提示词）。
   */
  private refsForDraft(projectId: string, topic?: string, keywords?: string[]) {
    const all = this.references.list(projectId);
    const meta = all.filter((r) => { const a = parseStringList(r.authors); return a.length > 0 && !!r.year; });
    const termSet = new Set(PipelineService.tokenize([topic || '', ...(keywords || [])].filter(Boolean).join(' ')));
    const relevance = (r: { title?: string | null; abstract?: string | null; venue?: string | null }): number => {
      if (!termSet.size) return 0;
      const hay = new Set(PipelineService.tokenize(`${r.title || ''} ${r.abstract || ''} ${r.venue || ''}`));
      let hit = 0;
      for (const t of termSet) if (hay.has(t)) hit += 1;
      return hit / termSet.size;
    };
    const scored = meta.map((r) => ({ r, rel: relevance(r) }));
    const relevant = scored.filter((x) => x.rel > 0);
    const pool = topic && termSet.size && relevant.length >= 8 ? relevant : scored;
    return pool
      .sort((a, b) => b.rel - a.rel || (b.r.citationCount || 0) - (a.r.citationCount || 0))
      .slice(0, 20)
      .map((x) => x.r);
  }

  /** 项目 → 最近一次联网检索线索（只用于起草 prompt 的背景参考，不落文献库） */
  private readonly webHintForProject = new Map<string, PaperHit[]>();

  private referencesForPrompt(projectId: string, refs?: ReturnType<PipelineService['refsForDraft']>, topic?: string, keywords?: string[]): string {
    const pool = refs ?? this.refsForDraft(projectId, topic, keywords);
    const lines = pool.map((r, i) => `[Ref:${i + 1}] ${r.title}（${r.authors}，${r.year || 'n.d.'}，${r.venue}${r.doi ? `，DOI:${r.doi}` : ''}）`);
    // 联网检索线索（未入库）单列，明确标注「不可直接引用」：避免模型把网页摘要当同行评议文献
    if (this.webHintForProject.size) {
      const hints = this.webHintForProject.get(projectId) || [];
      if (hints.length) {
        lines.push('', '以下为联网检索线索（公开网页，未入文献库，仅作背景参考，不得作为 [Ref:N] 引用）：');
        hints.forEach((h, i) => lines.push(`[Web:${i + 1}] ${h.title} —— ${h.url}`));
      }
    }
    return lines.join('\n');
  }

  /** Fetch typed PipelineTaskRow (without parsed steps array) */
  private getTaskRow(id: string): PipelineTaskRow {
    const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
    if (!row) throw new NotFoundException('流水线任务不存在');
    return row;
  }
}
