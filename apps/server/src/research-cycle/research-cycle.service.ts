import { Injectable, Logger, BadRequestException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Command } from '@langchain/langgraph';
import { and, inArray, like, lt, sql } from 'drizzle-orm';
import { db, sqlite } from '../db/database';
import { llmCallLogs, researchCycles } from '../db/schema';
import { ProgramsService } from '../programs/programs.service';
import { ResearchRecordsService } from '../programs/research-records.service';
import { ExperimentsService } from '../experiments/experiments.service';
import { AgentTraceService } from '../agent/agent-trace.service';
import { AiService } from '../ai/ai.service';
import { ScholarSearchService } from '../research/scholar-search.service';
import { ResearchBriefService } from '../research-brief/research-brief.service';
import { MemoryService } from '../memory/memory.service';
import { envInt } from '../common/env';
import { errorMessage } from '../common/error-message';

/**
 * 自主研究循环服务：驱动 LangGraph 研究循环，处理人工审批挂起与恢复。
 *
 * 设计要点：
 *  - **编排只在图里**：服务层只做「建对象 → invoke 图 → 投影状态」，不内联任何闭环逻辑
 *    （仓库契约 §7：编排必须经 LangGraph，禁止 service 里内联闭包编排）。
 *  - **真源在库**：图状态只是运行时数据，所有科研对象都落 research_* 表，驾驶舱随时可查。
 *  - **L2 默认受控**：协议未审批不执行（图内 interrupt 挂起，驾驶舱批准后 resume）。
 *    L3+ 才自动批准——自主等级写在 research_program.autonomy_level 上，不藏在代码里。
 */
/** 服务重启后仍可能处于执行中的循环状态。awaiting_approval 不自动续跑，等人审批。 */
const RECOVERABLE_STATES = ['question', 'protocol', 'execute', 'analyze', 'revise'] as const;
function isRecoverableState(state: string): boolean {
  return (RECOVERABLE_STATES as readonly string[]).includes(state);
}

@Injectable()
export class ResearchCycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResearchCycleService.name);
  private graph: { invoke(input: never, cfg: never): Promise<unknown> } | null = null;
  private graphDeps!: Parameters<typeof import('./research-cycle.graph').buildResearchCycleGraph>[0];
  /** 正在运行的循环（防止同项目并发跑两个循环互相烧 token） */
  private readonly running = new Set<string>();
  /** programId → 当前活动循环；用于看门狗定位 cycle 与启动时间 */
  private readonly active = new Map<string, { cycleId: string; startedAt: number }>();
  /** cycleId → 最近一次节点心跳（毫秒） */
  private readonly heartbeats = new Map<string, number>();
  /** cycleId → 当前 agent_execution runId，看门狗终止时要把轨迹收尾 */
  private readonly activeRunIds = new Map<string, string>();
  /** 已被看门狗判定卡死的循环；迟到的图返回值不得覆盖 blocked 终态 */
  private readonly watchdogStopped = new Set<string>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private readonly watchdogMs = envInt('RESEARCH_CYCLE_WATCHDOG_MINUTES', 60, { min: 10, max: 24 * 60 }) * 60 * 1000;

  constructor(
    private readonly programs: ProgramsService,
    private readonly records: ResearchRecordsService,
    private readonly experiments: ExperimentsService,
    private readonly ai: AiService,
    private readonly trace: AgentTraceService,
    private readonly scholar: ScholarSearchService,
    private readonly brief?: ResearchBriefService,
    private readonly memory?: MemoryService,
  ) {
    this.graphDeps = ({
      programs: {
        getProgram: (programId) => this.programs.getProgram(programId),
        listProtocols: (hypothesisId) => this.programs.listProtocols(hypothesisId),
        createHypothesis: (questionId, input) => this.programs.createHypothesis(questionId, input),
        createProtocol: (hypothesisId, input) => this.programs.createProtocol(hypothesisId, input),
        approveProtocol: (protocolId, actor) => this.programs.approveProtocol(protocolId, actor),
        updateCycle: (cycleId, patch) => {
          this.programs.updateCycle(cycleId, patch);
        },
      },
      records: {
        listRuns: (programId) => this.records.listRuns(programId),
        createRun: (programId, input) => this.records.createRun(programId, input),
        updateRun: (runId, patch) => {
          this.records.updateRun(runId, patch);
        },
        createClaim: (programId, input) => this.records.createClaim(programId, input),
        updateClaim: (claimId, patch) => {
          this.records.updateClaim(claimId, patch);
        },
        addEvidence: (claimId, input) => this.records.addEvidence(claimId, input),
      },
      agents: {
        // 智能体按需加载：langgraph / 角色 prompt 只在真正跑循环时进内存。
        plan: async (input) =>
          (await import('./agents/pi.agent')).planWithPi(this.ai, { ...input, context: `research-cycle:${input.cycleId}:pi` }),
        design: async (input) =>
          (await import('./agents/experimenter.agent')).designExperiment(this.ai, { ...input, context: `research-cycle:${input.cycleId}:experimenter` }),
        evaluate: async (input) =>
          (await import('./agents/critic.agent')).evaluateWithCritic(this.ai, { ...input, context: `research-cycle:${input.cycleId}:critic` }),
        expertReview: async (input) =>
          (await import('./agents/expert.agent')).reviewWithExpert(this.ai, { ...input, context: `research-cycle:${input.cycleId}:expert` }),
      },
      runExperiment: (input) => this.experiments.run(input),
      // 文献检索：失败由 graph 降级为空列表；这里只做「服务结果 → 紧凑引用」映射，
      // 摘要不进提示词/checkpoint，避免 token 与状态膨胀。
      brief: (projectId) => this.brief?.render(projectId) ?? '',
      memory: async (projectId, query) => {
        const hits = await this.memory?.recall(projectId, query, 4);
        return hits?.length ? hits.map((m) => `- ${m.content}`).join('\n') : '';
      },
      literatureSearch: async ({ query, limit }) => {
        const hits = await this.scholar.search([query], limit ?? 6);
        return hits.slice(0, limit ?? 6).map((h) => ({
          title: h.title,
          year: h.year,
          venue: h.venue,
          doi: h.doi,
          source: h.source,
        }));
      },
      autonomyLevel: (programId) => this.programs.getProgram(programId).autonomyLevel || 'L2',
      tokensSpent: (cycleId) => this.tokensSpent(cycleId),
      notify: (event, payload) => this.logger.log(`[研究循环] ${event} ${JSON.stringify(payload).slice(0, 300)}`),
      heartbeat: (cycleId, node) => {
        this.heartbeats.set(cycleId, Date.now());
        this.logger.debug?.(`[研究循环] ${cycleId.slice(0, 8)} 心跳 ${node}`);
      },
      logger: this.logger,
    });
  }

  onModuleInit() {
    // 先把上次进程留下的执行中循环捞起来：有 checkpoint 就续跑，没有就标 blocked。
    this.recoverInterrupted();
    this.watchdogTimer = setInterval(() => this.sweepStaleCycles(), this.watchdogMs);
    this.watchdogTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /** 单循环最大轮次（默认 2：一次执行 + 一次修订） */
  private readonly maxIterations = envInt('RESEARCH_CYCLE_MAX_ITERATIONS', 2, { min: 1, max: 10 });
  /** 单循环 token 预算（0 = 不限；来自 app_setting research_cycle_token_budget） */
  private readonly maxTokens = envInt('RESEARCH_CYCLE_TOKEN_BUDGET', 0, { min: 0, max: 10_000_000 });

  /**
   * 启动一轮自主研究循环。
   *
   * 流程：建 cycle + question → 调图（PI→门禁→实验→评审→决策→修订回边）。
   * 图在后台跑（可能几分钟），接口立即返回，驾驶舱轮询 status。
   */
  start(programId: string, opts: { question?: string; maxIterations?: number; maxTokens?: number; approvalMode?: string } = {}) {
    const program = this.programs.getProgram(programId);
    if (!this.ai.configured) {
      throw new BadRequestException('AI 服务未配置：无法启动自主研究循环');
    }
    if (this.running.has(programId)) {
      throw new BadRequestException('该研究项目已有循环在运行，请等待结束或先终止');
    }
    const question = String(opts.question || program.goal || program.title || '').trim();
    if (!question) throw new BadRequestException('研究问题不能为空');
    const maxIterations = Math.max(1, Math.min(10, opts.maxIterations ?? this.maxIterations));
    const maxTokens = Math.max(0, opts.maxTokens ?? this.maxTokens);
    // 门禁模式：显式选择 ai 才跳过人工；非法值一律回落到 human（保守默认）
    const approvalMode: 'human' | 'ai' = opts.approvalMode === 'ai' ? 'ai' : 'human';

    const cycle = this.programs.createCycle(programId, {
      objective: question,
      state: 'question',
      budget: { maxIterations, maxTokens, approvalMode },
    });
    const q = this.programs.createQuestion(programId, { question, cycleId: cycle.id, status: 'active' });
    this.running.add(programId);
    this.active.set(programId, { cycleId: cycle.id, startedAt: Date.now() });
    this.heartbeats.set(cycle.id, Date.now());
    void this.invoke(cycle.id, program.projectId, {
      projectId: program.projectId,
      programId,
      cycleId: cycle.id,
      questionId: q.id,
      questionText: question,
      iteration: 0,
      maxIterations,
      maxTokens,
      approvalMode,
    });
    return this.status(cycle.id);
  }

  /** 人工审批后恢复循环（协议已批准的走 DB 状态；显式 false 表示驳回并终止本轮） */
  async resume(cycleId: string, decision: { approved?: boolean } = {}) {
    const cycle = this.programs.getCycle(cycleId);
    const program = this.programs.getProgram(cycle.programId);
    if (this.running.has(cycle.programId)) {
      throw new BadRequestException('该研究项目已有循环在运行');
    }
    if (cycle.state !== 'awaiting_approval') {
      throw new BadRequestException('循环不在审批等待状态，无法用审批接口恢复');
    }
    if (!this.hasCheckpoint(cycleId)) {
      throw new BadRequestException('审批断点已丢失，无法恢复；请重新启动一轮循环');
    }
    this.running.add(cycle.programId);
    this.active.set(cycle.programId, { cycleId, startedAt: Date.now() });
    this.heartbeats.set(cycleId, Date.now());
    const { Command } = await import('@langchain/langgraph');
    void this.invoke(cycle.id, program.projectId, new Command({ resume: { approved: decision.approved !== false } }));
    return this.status(cycleId);
  }

  /**
   * 手动重试一个 blocked / 异常退出的循环。
   * 只有 LangGraph checkpoint 还在时才允许续跑；断点已清掉的循环只能重新 start。
   */
  recover(cycleId: string) {
    const cycle = this.programs.getCycle(cycleId);
    const program = this.programs.getProgram(cycle.programId);
    if (this.running.has(cycle.programId)) {
      throw new BadRequestException('该研究项目已有循环在运行');
    }
    if (isRecoverableState(String(cycle.state || ''))) {
      throw new BadRequestException('循环仍处于执行状态，无需手动恢复');
    }
    if (!this.hasCheckpoint(cycleId)) {
      throw new BadRequestException('断点已丢失，无法续跑；请重新启动一轮循环');
    }
    this.watchdogStopped.delete(cycleId);
    this.running.add(cycle.programId);
    this.active.set(cycle.programId, { cycleId, startedAt: Date.now() });
    this.heartbeats.set(cycleId, Date.now());
    this.programs.updateCycle(cycleId, { state: 'execute', summary: '手动恢复：从断点继续执行' });
    void this.invoke(cycleId, program.projectId, null);
    return this.status(cycleId);
  }

  /** 循环状态（驾驶舱轮询用） */
  status(cycleId: string) {
    const cycle = this.programs.getCycle(cycleId);
    const program = this.programs.getProgram(cycle.programId);
    const claims = this.records.listClaims(program.id).filter((c) => c.cycleId === cycle.id);
    const runs = this.records.listRuns(program.id).filter((r) => r.cycleId === cycle.id);
    // 协议必须按「本轮问题 → 假设」收窄：一个 program 可能有多轮循环，
    // 直接返回全 program 的协议会让驾驶舱把上一轮的 draft 协议当成待批方案（误批）。
    const cycleQuestionIds = this.programs
      .listQuestions(program.id)
      .filter((q) => q.cycleId === cycle.id)
      .map((q) => q.id);
    const cycleHypothesisIds = new Set(
      cycleQuestionIds.flatMap((qid) => this.programs.listHypotheses(qid).map((h) => h.id)),
    );
    const protocols = this.programs.listProgramProtocols(program.id).filter((p) => cycleHypothesisIds.has(p.hypothesisId));
    return {
      ...cycle,
      program: { id: program.id, title: program.title, autonomyLevel: program.autonomyLevel },
      claims,
      runs,
      protocols,
      tokensSpent: this.tokensSpent(cycleId),
    };
  }

  /** 某研究项目的全部循环 */
  list(programId: string) {
    return this.programs.listCycles(programId);
  }

  /**
   * 进程启动恢复：扫描非终态循环。
   *  - awaiting_approval：保留断点，等人审批，不自动跑；
   *  - 有 checkpoint：自动 invoke(null) 从最后提交的节点续跑；
   *  - 无 checkpoint：标 blocked，保留已有 claim/run，提示重新启动。
   * 返回恢复统计，便于健康检查与启动日志核对。
   */
  recoverInterrupted(): { resumed: number; blocked: number; waiting: number } {
    let rows: (typeof researchCycles.$inferSelect)[];
    try {
      rows = db
        .select()
        .from(researchCycles)
        .where(inArray(researchCycles.state, [...RECOVERABLE_STATES, 'awaiting_approval']))
        .all();
    } catch (e: unknown) {
      this.logger.warn(`[研究循环] 启动恢复扫描失败：${errorMessage(e, 200)}`);
      return { resumed: 0, blocked: 0, waiting: 0 };
    }

    let resumed = 0;
    let blocked = 0;
    let waiting = 0;
    for (const cycle of rows) {
      if (cycle.state === 'awaiting_approval') {
        waiting += 1;
        continue;
      }
      if (this.running.has(cycle.programId)) continue;
      if (!this.hasCheckpoint(cycle.id)) {
        this.programs.updateCycle(cycle.id, {
          state: 'blocked',
          summary: '服务重启：未找到 LangGraph 断点，本轮已停止；已保留此前结论，可重新启动一轮',
        });
        blocked += 1;
        this.logger.warn(`[研究循环] ${cycle.id.slice(0, 8)} 重启恢复失败：无 checkpoint，已标 blocked`);
        continue;
      }
      if (!this.ai.configured) {
        this.programs.updateCycle(cycle.id, {
          state: 'blocked',
          summary: '服务重启：AI 服务未配置，无法自动续跑；配置后可手动恢复',
        });
        blocked += 1;
        continue;
      }
      let program: ReturnType<ProgramsService['getProgram']>;
      try {
        program = this.programs.getProgram(cycle.programId);
      } catch {
        blocked += 1;
        continue;
      }
      this.running.add(cycle.programId);
      this.active.set(cycle.programId, { cycleId: cycle.id, startedAt: Date.now() });
      this.heartbeats.set(cycle.id, Date.now());
      this.programs.updateCycle(cycle.id, { summary: '服务重启：从 LangGraph 断点继续执行' });
      resumed += 1;
      this.logger.log(`[研究循环] ${cycle.id.slice(0, 8)} 从 checkpoint 自动续跑（${cycle.state}）`);
      void this.invoke(cycle.id, program.projectId, null);
    }
    if (resumed || blocked || waiting) {
      this.logger.log(`[研究循环] 启动恢复完成：续跑 ${resumed}，阻塞 ${blocked}，待审批 ${waiting}`);
    }
    return { resumed, blocked, waiting };
  }

  /**
   * cycle 级看门狗。只处理两类：
   *  1. 本进程 active 但超过阈值无节点心跳 → 标 blocked、释放锁、收尾轨迹；
   *  2. 库里非终态且无进程持有锁、updatedAt 已过期 → 标 blocked（崩溃残留）。
   * awaiting_approval 永不自动终止。
   */
  sweepStaleCycles(now = Date.now()): number {
    let marked = 0;
    for (const info of [...this.active.values()]) {
      const lastBeat = this.heartbeats.get(info.cycleId) || info.startedAt;
      if (now - lastBeat < this.watchdogMs) continue;
      try {
        const cycle = this.programs.getCycle(info.cycleId);
        if (cycle.state === 'awaiting_approval') continue;
        this.programs.updateCycle(info.cycleId, {
          state: 'blocked',
          summary: `看门狗：超过 ${Math.round(this.watchdogMs / 60000)} 分钟无节点心跳，已释放运行锁；可从断点手动恢复`,
        });
        const runId = this.activeRunIds.get(info.cycleId);
        if (runId) this.trace.finishRun(runId, { status: 'error', error: 'watchdog timeout' });
        this.watchdogStopped.add(info.cycleId);
        this.releaseCycle(info.cycleId);
        marked += 1;
        this.logger.error(`[研究循环] 看门狗终止 ${info.cycleId.slice(0, 8)}：长时间无心跳`);
      } catch (e: unknown) {
        this.logger.warn(`[研究循环] 看门狗处理失败：${errorMessage(e, 160)}`);
      }
    }

    try {
      const cutoff = now - this.watchdogMs;
      const orphans = db
        .select()
        .from(researchCycles)
        .where(and(inArray(researchCycles.state, [...RECOVERABLE_STATES]), lt(researchCycles.updatedAt, cutoff)))
        .all();
      for (const cycle of orphans) {
        if (this.active.has(cycle.programId)) continue;
        this.programs.updateCycle(cycle.id, {
          state: 'blocked',
          summary: '看门狗：检测到无进程持有的过期执行状态，已释放并标记 blocked',
        });
        marked += 1;
      }
    } catch {
      /* 旧库没有对应表时忽略 */
    }
    return marked;
  }


  // ─── 图调用 ─────────────────────────────────────────────────────────

  /** 图按需构建：@langchain/langgraph 冷导入约 4s，只有真正跑循环时才加载。 */
  private async getGraph(): Promise<{ invoke(input: never, cfg: never): Promise<unknown> }> {
    if (!this.graph) {
      const { buildResearchCycleGraph } = await import('./research-cycle.graph');
      this.graph = buildResearchCycleGraph(this.graphDeps) as unknown as { invoke(input: never, cfg: never): Promise<unknown> };
    }
    return this.graph;
  }

  private async invoke(
    cycleId: string,
    projectId: string,
    input: ResearchCycleStartInput | Command | null,
  ) {
    this.heartbeats.set(cycleId, Date.now());
    const cfg = { configurable: { thread_id: cycleId } };
    let runId: string | undefined;
    try {
      runId = this.trace.startRun({
        projectId,
        source: 'research-cycle',
        input: `自主研究循环 ${cycleId.slice(0, 8)}`,
        model: this.ai.config.model,
      });
      this.activeRunIds.set(cycleId, runId);
      const graph = await this.getGraph();
      const result = await graph.invoke(input as never, cfg as never);
      if (this.watchdogStopped.has(cycleId)) {
        this.logger.warn(`[研究循环] ${cycleId.slice(0, 8)} 已被看门狗终止，忽略迟到的图返回值`);
        return;
      }
      const interrupts = (result as { __interrupt__?: unknown[] } | undefined)?.__interrupt__;
      if (interrupts && interrupts.length > 0) {
        this.programs.updateCycle(cycleId, { state: 'awaiting_approval', summary: '等待人工审批研究协议' });
        this.trace.finishRun(runId, { status: 'done', outputSummary: '协议待人工审批（interrupt 挂起）' });
      } else {
        const state = (result as { stopReason?: string; verdict?: string; feedback?: string } | undefined) || {};
        const reason = state.stopReason || 'completed';
        // agent_error 属于「智能体不可用」而非「研究被否决」：标 blocked 便于驾驶舱区分与重试。
        const terminalState = reason === 'completed' ? 'synthesize' : reason === 'agent_error' ? 'blocked' : 'stopped';
        this.programs.updateCycle(cycleId, {
          state: terminalState,
          summary: `循环结束：${reason}${state.verdict ? `（结论 ${state.verdict}）` : ''}${
            state.feedback ? `｜${String(state.feedback).slice(0, 200)}` : ''
          }`,
        });
        this.trace.finishRun(runId, { status: 'done', outputSummary: `研究循环结束：${reason}` });
        this.clearCheckpoint(cycleId);
      }
    } catch (e: unknown) {
      if (this.watchdogStopped.has(cycleId)) {
        this.logger.warn(`[研究循环] ${cycleId.slice(0, 8)} 已被看门狗终止，忽略迟到的异常`);
        return;
      }
      const msg = errorMessage(e, 300);
      this.logger.error(`研究循环 ${cycleId} 执行失败: ${msg}`);
      try {
        this.programs.updateCycle(cycleId, { state: 'blocked', summary: `执行失败：${msg}` });
      } catch {
        /* 状态投影失败不影响日志 */
      }
      if (runId) this.trace.finishRun(runId, { status: 'error', error: msg });
    } finally {
      this.releaseCycle(cycleId);
      this.watchdogStopped.delete(cycleId);
    }
  }

  /**
   * 释放一个 cycle 占用的全部进程内状态。
   *
   * `finally` 里读库可能失败，所以不能先 getCycle 再清理；这里先尽力读 programId，
   * 读不到就按 active map 反查，确保锁、心跳、轨迹槽位不会泄漏。
   */
  private releaseCycle(cycleId: string): void {
    let programId: string | undefined;
    try {
      programId = this.programs.getCycle(cycleId).programId;
    } catch {
      /* 数据库不可用时仍要清理内存锁 */
    }
    if (programId) this.running.delete(programId);
    for (const [pid, info] of [...this.active.entries()]) {
      if (info.cycleId === cycleId) {
        this.running.delete(pid);
        this.active.delete(pid);
      }
    }
    this.heartbeats.delete(cycleId);
    this.activeRunIds.delete(cycleId);
  }

  /** 循环已消耗 token（按 caller 前缀 research-cycle:<cycleId>: 归集） */
  private tokensSpent(cycleId: string): number {
    try {
      const row = db
        .select({
          total: sql<number>`coalesce(sum(${llmCallLogs.promptTokens} + ${llmCallLogs.completionTokens}), 0)`,
        })
        .from(llmCallLogs)
        .where(like(llmCallLogs.caller, `research-cycle:${cycleId}:%`))
        .get();
      return Number(row?.total || 0);
    } catch {
      return 0;
    }
  }

  /** 该循环线程是否还有 LangGraph checkpoint（只查存在性，不读业务状态） */
  private hasCheckpoint(cycleId: string): boolean {
    try {
      return !!sqlite.prepare('SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1').get(cycleId);
    } catch {
      return false;
    }
  }

  /** 终态后清理 LangGraph checkpoint（与 pipeline 一致：结束即释放断点） */
  private clearCheckpoint(cycleId: string) {
    try {
      const tx = sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM writes WHERE thread_id = ?').run(cycleId);
        sqlite.prepare('DELETE FROM checkpoints WHERE thread_id = ?').run(cycleId);
      });
      tx();
    } catch {
      /* 表不存在时忽略 */
    }
  }
}

/** 启动循环时的初始图状态 */
interface ResearchCycleStartInput {
  projectId: string;
  programId: string;
  cycleId: string;
  questionId: string;
  questionText: string;
  iteration: number;
  maxIterations: number;
  maxTokens: number;
  approvalMode: 'human' | 'ai';
}
