import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Command } from '@langchain/langgraph';
import { like, sql } from 'drizzle-orm';
import { db, sqlite } from '../db/database';
import { llmCallLogs } from '../db/schema';
import { ProgramsService } from '../programs/programs.service';
import { ResearchRecordsService } from '../programs/research-records.service';
import { ExperimentsService } from '../experiments/experiments.service';
import { AgentTraceService } from '../agent/agent-trace.service';
import { AiService } from '../ai/ai.service';
import { ScholarSearchService } from '../research/scholar-search.service';
import { buildResearchCycleGraph } from './research-cycle.graph';
import { planWithPi } from './agents/pi.agent';
import { designExperiment } from './agents/experimenter.agent';
import { evaluateWithCritic } from './agents/critic.agent';
import { reviewWithExpert } from './agents/expert.agent';
import { envInt } from '../common/env';

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
@Injectable()
export class ResearchCycleService {
  private readonly logger = new Logger(ResearchCycleService.name);
  private graph!: ReturnType<typeof buildResearchCycleGraph>;
  /** 正在运行的循环（防止同项目并发跑两个循环互相烧 token） */
  private readonly running = new Set<string>();

  constructor(
    private readonly programs: ProgramsService,
    private readonly records: ResearchRecordsService,
    private readonly experiments: ExperimentsService,
    private readonly ai: AiService,
    private readonly trace: AgentTraceService,
    private readonly scholar: ScholarSearchService,
  ) {
    this.graph = buildResearchCycleGraph({
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
        plan: (input) =>
          planWithPi(this.ai, { ...input, context: `research-cycle:${input.cycleId}:pi` }),
        design: (input) =>
          designExperiment(this.ai, { ...input, context: `research-cycle:${input.cycleId}:experimenter` }),
        evaluate: (input) =>
          evaluateWithCritic(this.ai, { ...input, context: `research-cycle:${input.cycleId}:critic` }),
        expertReview: (input) =>
          reviewWithExpert(this.ai, { ...input, context: `research-cycle:${input.cycleId}:expert` }),
      },
      runExperiment: (input) => this.experiments.run(input),
      // 文献检索：失败由 graph 降级为空列表；这里只做「服务结果 → 紧凑引用」映射，
      // 摘要不进提示词/checkpoint，避免 token 与状态膨胀。
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
      logger: this.logger,
    });
  }

  /** 当前调用上下文所属的循环（仅用于日志；token 归集用 graph 传入的 cycleId，不用共享字段） */
  private currentCycle = '';

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
  resume(cycleId: string, decision: { approved?: boolean } = {}) {
    const cycle = this.programs.getCycle(cycleId);
    const program = this.programs.getProgram(cycle.programId);
    if (this.running.has(cycle.programId)) {
      throw new BadRequestException('该研究项目已有循环在运行');
    }
    this.running.add(cycle.programId);
    void this.invoke(cycle.id, program.projectId, new Command({ resume: { approved: decision.approved !== false } }));
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

  // ─── 图调用 ─────────────────────────────────────────────────────────

  private async invoke(
    cycleId: string,
    projectId: string,
    input: ResearchCycleStartInput | Command,
  ) {
    this.currentCycle = cycleId;
    const cfg = { configurable: { thread_id: cycleId } };
    let runId: string | undefined;
    try {
      runId = this.trace.startRun({
        projectId,
        source: 'research-cycle',
        input: `自主研究循环 ${cycleId.slice(0, 8)}`,
        model: this.ai.config.model,
      });
      const result = await this.graph.invoke(input as never, cfg as never);
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
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      this.logger.error(`研究循环 ${cycleId} 执行失败: ${msg}`);
      try {
        this.programs.updateCycle(cycleId, { state: 'blocked', summary: `执行失败：${msg}` });
      } catch {
        /* 状态投影失败不影响日志 */
      }
      if (runId) this.trace.finishRun(runId, { status: 'error', error: msg });
    } finally {
      const cycle = this.programs.getCycle(cycleId);
      this.running.delete(cycle.programId);
      this.currentCycle = '';
    }
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
