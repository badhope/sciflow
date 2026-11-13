import { START, END, StateGraph, interrupt } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { createHash } from 'node:crypto';
import { sqlite } from '../db/database';
import { ResearchCycleAnnotation } from './research-cycle-state';
import type { LiteratureRef } from './research-cycle-state';
import type { PiPlan } from './agents/pi.agent';
import type { ExperimentDesign } from './agents/experimenter.agent';
import type { CriticVerdict } from './agents/critic.agent';

/**
 * 自主研究循环图（LangGraph）：
 *
 *   plan(PI) → gate(L2 审批) → execute(实验者) → evaluate(Critic) → decide
 *                                                                  ├─ supported → synthesize → END
 *                                                                  ├─ 预算/轮次/停滞 → END
 *                                                                  └─ 否则 ──回边──→ plan
 *
 * 为什么要有回边：
 *  现有 pipeline.graph.ts 是单次 DAG（产出稿件），结构上无法「再来一轮」；
 *  自主科研的本质是「证据不足 → 改方案 → 再验证」，所以循环必须有回边 + 终止条件，
 *  否则就是烧 token 的死循环。终止条件在此集中定义（轮次上限 / token 预算 / 停滞判定）。
 *
 * 与既有对象的关系：图只做编排，真源始终在 research_* 表里
 * （Program→Cycle→Question→Hypothesis→Protocol→Run→Claim→Evidence）。
 */

/** 图依赖（服务层注入；测试可注入桩实现） */
export interface ResearchCycleGraphDeps {
  /** 研究对象读写（programs/records 服务） */
  programs: {
    getProgram(programId: string): { id: string; projectId: string; goal?: string | null; autonomyLevel?: string | null; title?: string | null };
    listProtocols(hypothesisId: string): { id: string; status?: string | null; version?: number | null }[];
    createHypothesis(questionId: string, input: { statement?: string; rationale?: string; predictions?: unknown }): { id: string };
    createProtocol(hypothesisId: string, input: { design?: unknown; status?: string }): { id: string; status?: string | null };
    approveProtocol(protocolId: string, actor: string): { id: string; status?: string | null };
    updateCycle(cycleId: string, patch: { state?: string; summary?: string }): void;
  };
  records: {
    createRun(programId: string, input: { cycleId?: string; protocolId?: string; status?: string; summary?: string }): { id: string };
    updateRun(runId: string, patch: { status?: string; manifest?: unknown; summary?: string; experimentId?: string }): void;
    createClaim(programId: string, input: { statement?: string; cycleId?: string; protocolId?: string; confidence?: number; status?: string }): { id: string };
    updateClaim(claimId: string, patch: { status?: string; confidence?: number }): void;
    addEvidence(claimId: string, input: { sourceType?: string; sourceId?: string; quote?: string; stance?: string; strength?: number; verified?: boolean }): { id: string };
  };
  /** 三个角色智能体（LLM；测试可注入桩） */
  agents: {
    plan(input: { question: string; priorFeedback?: string; priorVerdict?: string; iteration: number; cycleId: string; literature?: LiteratureRef[] }): Promise<PiPlan>;
    design(input: {
      hypothesisStatement: string;
      predictions: string[];
      design: Record<string, unknown>;
      cycleId: string;
      previousError?: string;
    }): Promise<ExperimentDesign>;
    evaluate(input: {
      hypothesisStatement: string;
      predictions: string[];
      runOutput: string;
      designSummary?: string;
      previousVerdict?: string;
      originalQuestion?: string;
      cycleId: string;
      literature?: LiteratureRef[];
    }): Promise<CriticVerdict>;
    /** 全自动模式下的独立 AI 专家审批（approvalMode='ai' 时调用） */
    expertReview(input: {
      question: string;
      hypothesisStatement: string;
      predictions: string[];
      design: Record<string, unknown>;
      cycleId: string;
    }): Promise<{ approved: boolean; confidence: number; rationale: string; concerns: string[]; requiredChanges: string[] }>;
  };
  /** 在 Python 沙箱执行实验 */
  runExperiment(input: { projectId: string; goal: string; code: string }): Promise<{
    id: string;
    stdout: string;
    stderr: string;
    status: string;
    runtimeMs?: number;
  }>;
  /** 文献检索（OpenAlex/Crossref/arXiv）；失败由调用方降级为空列表，不得阻塞循环 */
  literatureSearch(input: { query: string; limit?: number }): Promise<LiteratureRef[]>;
  /** 程序自主等级（L0-L5）；L3+ 自动批准协议 */
  autonomyLevel(programId: string): string;
  /** 当前循环已消耗 token（按循环维度归集：caller 前缀 research-cycle:<cycleId>:） */
  tokensSpent(cycleId: string): number;
  /** 事件通知（写轨迹/事件流） */
  notify(event: string, payload: Record<string, unknown>): void;
  logger: { log(m: string): void; warn(m: string): void; error(m: string): void };
}

/** 协议方案指纹：判断「方案是否真的改了」（停滞判定用） */
export function designFingerprint(design: unknown): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, stable(val)]),
      );
    }
    return v;
  };
  return createHash('sha1').update(JSON.stringify(stable(design ?? {}))).digest('hex').slice(0, 16);
}

/**
 * 话题重合度（0-1）：用来检测「PI 把问题换成了另一个主题」。
 *
 * 实测教训：小模型（agnes-3.0-flash）做 PI 时会跑题——问题问「离群点稳健性」，
 * 它给出「机器学习特征工程」的实验方案，且看起来完全自洽，肉眼很难发现。
 *
 * 算法：用**二元组（bigram）**而不是单字。单字重合会把「n=200 下的 5% 场景」误判为高重合
 * （字面相同、语义不同）；bigram 更接近词级重合，能抓住主题漂移。
 */
export function topicOverlap(a: string, b: string): number {
  const normalize = (s: string) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length < 2 || nb.length < 2) return na && nb ? (na === nb ? 1 : 0) : 0;
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= na.length; i++) grams.add(na.slice(i, i + 2));
  if (grams.size === 0) return 0;
  let hit = 0;
  for (const g of grams) if (nb.includes(g)) hit += 1;
  return hit / grams.size;
}

/** 停滞阈值：连续这么多轮「结论相同且方案没变」即判定空转并终止 */
export const STAGNATION_LIMIT = 2;

/** 自动批准协议的最低自主等级（L3 起；L2 默认每轮协议都要人工审批） */
export const AUTO_APPROVE_LEVEL = 'L3';

export function buildResearchCycleGraph(
  deps: ResearchCycleGraphDeps,
  options: { checkpointer?: unknown } = {},
) {
  const graph = new StateGraph(ResearchCycleAnnotation)
    .addNode('plan', async (s) => {
      deps.programs.updateCycle(s.cycleId, { state: 'protocol', summary: `第 ${s.iteration + 1} 轮：正在生成假设与实验协议` });
      const program = deps.programs.getProgram(s.programId);
      const question = s.questionText || program.goal || program.title || '';
      /**
       * 文献线索只在第一轮检索一次（修订轮复用）：
       * 外部学术 API 有速率限制，每轮回边都打三个源既慢又容易触发限流；
       * 检索失败一律降级为空，绝不让外部依赖阻断自主循环。
       */
      let literature: LiteratureRef[] = s.literature ?? [];
      if (!literature.length && s.iteration === 0) {
        try {
          literature = await deps.literatureSearch({ query: question, limit: 6 });
          deps.notify('literature', { count: literature.length });
        } catch (e: any) {
          deps.logger.warn(`[研究循环] 文献检索失败，按无背景继续：${String(e?.message || e).slice(0, 160)}`);
          literature = [];
        }
      }
      // PI 失败不能把整轮循环炸掉：先带「压缩输出」提示重试一次；仍失败则体面终止，
      // 保留前几轮已落库的 claim/run（契约 #4：智能体失败要降级，不能崩循环）。
      let plan: PiPlan | null = null;
      let lastError = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          plan = await deps.agents.plan({
            question,
            literature,
            priorFeedback:
              [
                s.lastFeedback,
                attempt > 0
                  ? `上一次输出无法解析（${lastError.slice(0, 160)}）：请压缩每个字段、减少数组条目，确保输出是合法 JSON。`
                  : '',
              ]
                .filter(Boolean)
                .join('\n') || undefined,
            priorVerdict: s.lastVerdict || undefined,
            iteration: s.iteration,
            cycleId: s.cycleId,
          });
          break;
        } catch (e: any) {
          lastError = String(e?.message || e).slice(0, 600);
          deps.notify('plan', { iteration: s.iteration, agentError: lastError, willRetry: attempt === 0 });
        }
      }
      if (!plan) {
        deps.logger.error(`[研究循环] PI 智能体连续失败，循环终止：${lastError.slice(0, 200)}`);
        return {
          stopReason: 'agent_error',
          feedback: `PI 智能体连续失败，本轮循环终止（已保留此前结论）：${lastError.slice(0, 300)}`,
        };
      }
      const hypothesis = deps.programs.createHypothesis(s.questionId, {
        statement: plan.hypothesis.statement,
        rationale: plan.hypothesis.rationale,
        predictions: plan.hypothesis.predictions,
      });
      const designForStore = literature.length
        ? { ...plan.protocol.design, literature }
        : (plan.protocol.design as Record<string, unknown>);
      const protocol = deps.programs.createProtocol(hypothesis.id, {
        // 文献线索随协议落库：驾驶舱可核对「PI 当时参考了什么」，而不是只看到一句 rationale。
        design: designForStore,
        status: 'draft',
      });
      // 跑题检测：把**方案本身**（目标 + 假设）与原问题比重合度。
      // 只比对 PI 的复述是不够的——实测模型能逐字复述问题，却按自己的理解设计另一套方案。
      const designText = `${plan.protocol.design.objective || ''} ${plan.hypothesis.statement || ''}`;
      const overlap = topicOverlap(question, designText);
      if (overlap < 0.3) {
        deps.logger.warn(`[研究循环] PI 方案与原问题重合度仅 ${overlap.toFixed(2)}，疑似跑题：${designText.slice(0, 120)}`);
      }
      deps.notify('plan', {
        iteration: s.iteration,
        hypothesisId: hypothesis.id,
        protocolId: protocol.id,
        statement: plan.hypothesis.statement,
        topicOverlap: Number(overlap.toFixed(2)),
      });
      return {
        hypothesisId: hypothesis.id,
        protocolId: protocol.id,
        // 指纹只算 PI 的设计本体：文献线索变化不应让停滞判定误认为「方案改了」
        designHash: designFingerprint(plan.protocol.design),
        design: designForStore,
        hypothesisStatement: plan.hypothesis.statement,
        predictions: plan.hypothesis.predictions ?? [],
        literature,
      };
    })
    .addNode('gate', async (s) => {
      // plan 失败已给出终止原因：不再进入审批/执行
      if (s.stopReason) return {};
      const protocols = deps.programs.listProtocols(s.hypothesisId);
      const current = protocols.find((p) => p.id === s.protocolId);
      if (current?.status === 'approved') return {};

      // 全自动模式：不挂起人工，改由独立 AI 专家审批。
      // 专家失败时 fail-closed（agent_error），绝不因为「没人审」就默认放行。
      if (s.approvalMode === 'ai') {
        let review: Awaited<ReturnType<ResearchCycleGraphDeps['agents']['expertReview']>>;
        try {
          review = await deps.agents.expertReview({
            question: s.questionText,
            hypothesisStatement: s.hypothesisStatement,
            predictions: s.predictions ?? [],
            design: s.design as Record<string, unknown>,
            cycleId: s.cycleId,
          });
        } catch (e: any) {
          const msg = String(e?.message || e).slice(0, 400);
          deps.logger.error(`[研究循环] AI 专家审批失败，按 blocked 终止：${msg}`);
          deps.notify('gate', { protocolId: s.protocolId, approved: false, by: 'expert', error: msg });
          return { stopReason: 'agent_error', feedback: `AI 专家审批不可用：${msg}` };
        }
        if (review.approved) {
          deps.programs.approveProtocol(s.protocolId, `agent:expert(${review.confidence})`);
          deps.notify('gate', {
            protocolId: s.protocolId,
            approved: true,
            by: 'expert',
            confidence: review.confidence,
            rationale: review.rationale,
          });
          return {};
        }
        deps.notify('gate', {
          protocolId: s.protocolId,
          approved: false,
          by: 'expert',
          confidence: review.confidence,
          rationale: review.rationale,
          requiredChanges: review.requiredChanges,
        });
        return {
          stopReason: 'approval_rejected',
          feedback: `AI 专家驳回（置信度 ${review.confidence}）：${review.rationale}${
            review.requiredChanges.length ? `；需修改：${review.requiredChanges.join('；')}` : ''
          }`,
        };
      }

      const level = deps.autonomyLevel(s.programId);
      if (level >= AUTO_APPROVE_LEVEL) {
        deps.programs.approveProtocol(s.protocolId, `agent:auto(${level})`);
        deps.notify('gate', { protocolId: s.protocolId, approved: true, by: `auto:${level}` });
        return {};
      }
      // 人工审批：interrupt 挂起（checkpoint 持久化），驾驶舱批准后用 Command({resume}) 续跑。
      // 节点体在 interrupt 之前不得有副作用——恢复时本节点会从头重放。
      const decision = interrupt({
        kind: 'protocol-approval',
        programId: s.programId,
        cycleId: s.cycleId,
        hypothesisId: s.hypothesisId,
        protocolId: s.protocolId,
        statement: s.hypothesisStatement,
      }) as { approved?: boolean } | undefined;
      if (decision?.approved) {
        deps.programs.approveProtocol(s.protocolId, 'human');
        deps.notify('gate', { protocolId: s.protocolId, approved: true, by: 'human' });
        return {};
      }
      deps.notify('gate', { protocolId: s.protocolId, approved: false });
      return { stopReason: 'approval_rejected' };
    })
    .addNode('execute', async (s) => {
      deps.programs.updateCycle(s.cycleId, { state: 'execute', summary: '正在执行实验（沙箱）' });
      const design = s.design as Record<string, unknown>;
      const run = deps.records.createRun(s.programId, {
        cycleId: s.cycleId,
        protocolId: s.protocolId,
        status: 'running',
        summary: '',
      });
      deps.notify('execute', { runId: run.id });

      // 最多两次尝试：第一次若因语法/导入错误失败，把报错回灌给实验者做**修复**（不是重写思路）。
      let code = '';
      let goal = '';
      let out: { id: string; stdout: string; stderr: string; status: string; runtimeMs?: number } | null = null;
      let repairNote = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        let experimentDesign: { goal: string; code: string; expectedOutput?: string };
        try {
          experimentDesign = await deps.agents.design({
            hypothesisStatement: s.hypothesisStatement,
            predictions: s.predictions ?? [],
            design,
            cycleId: s.cycleId,
            previousError: attempt === 0 ? undefined : repairNote,
          });
        } catch (e: any) {
          // 智能体本身失败（模型不可用/结构化输出被截断/不合规）不该让整轮循环崩掉。
          // 实测最常见的是「模型输出被 max_tokens 截断 → JSON 解析失败」，
          // 这种可以带着错误再试一次（要求更短的脚本），两次都不行才记为失败运行。
          const msg = String(e?.message || e).slice(0, 800);
          if (attempt === 0) {
            repairNote = `上一次生成实验脚本失败：${msg}`;
            deps.notify('execute', { runId: run.id, agentError: msg, willRetry: true });
            continue;
          }
          deps.notify('execute', { runId: run.id, agentError: msg });
          deps.records.updateRun(run.id, { status: 'failed', summary: `实验设计生成失败：${msg.slice(0, 200)}` });
          return {
            runId: run.id,
            runOutput: `实验设计生成失败（智能体不可用）：${msg}`,
            runFailed: true,
          };
        }
        code = experimentDesign.code;
        goal = experimentDesign.goal;
        // 质量闸：一行 import 也能「运行成功但零输出」，评审拿不到任何证据。
        // 这类脚本视为失败并回灌给实验者修复，而不是当成成功运行（实测 agnes 会返回只有 import 的脚本）。
        if (code.trim().length < 40 || !/\bprint\s*\(/.test(code)) {
          out = {
            id: '',
            stdout: '',
            stderr: '脚本内容过短或没有 print()：必须写完整实验并打印关键统计量（数值）',
            status: 'error',
          };
        } else {
          try {
            out = await deps.runExperiment({ projectId: s.projectId, goal: experimentDesign.goal, code: experimentDesign.code });
          } catch (e: any) {
            out = { id: '', stdout: '', stderr: String(e?.message || e).slice(0, 2000), status: 'error' };
          }
          if (out.status === 'ok' && !(out.stdout || '').trim()) {
            out = { ...out, status: 'error', stderr: '脚本运行成功但 stdout 为空：必须 print 出关键统计量，否则评审无法核验' };
          }
        }
        const failed = !out || out.status !== 'ok';
        if (!failed) break;
        repairNote = (out?.stderr || out?.stdout || '执行失败').slice(0, 1500);
        deps.notify('execute', { runId: run.id, attempt: attempt + 1, ok: false });
        if (attempt === 0) {
          // 失败也先落库（保留现场），然后用修复轮覆盖成最终结果
          deps.records.updateRun(run.id, {
            status: 'failed',
            manifest: { code, stdout: (out?.stdout || '').slice(0, 20_000), stderr: repairNote, runtimeMs: out?.runtimeMs ?? null },
            summary: `实验未成功：${repairNote.slice(0, 200)}`,
          });
        }
      }
      if (!out) {
        return { runId: run.id, runOutput: '实验未执行', runFailed: true };
      }
      const ok = out.status === 'ok';
      deps.records.updateRun(run.id, {
        status: ok ? 'completed' : 'failed',
        experimentId: out.id,
        manifest: {
          code,
          stdout: (out.stdout || '').slice(0, 20_000),
          stderr: (out.stderr || '').slice(0, 4000),
          runtimeMs: out.runtimeMs ?? null,
        },
        summary: ok ? goal : `实验未成功：${(out.stderr || '').slice(0, 200)}`,
      });
      deps.notify('execute', { runId: run.id, ok, runtimeMs: out.runtimeMs ?? null });
      return {
        runId: run.id,
        runOutput: [out.stdout, out.stderr ? `[stderr]\n${out.stderr}` : ''].filter(Boolean).join('\n').slice(0, 20_000),
        runFailed: !ok,
      };
    })
    .addNode('evaluate', async (s) => {
      deps.programs.updateCycle(s.cycleId, { state: 'analyze', summary: '正在评审实验输出' });
      const designSummary = JSON.stringify(s.design ?? {}, null, 2).slice(0, 4000);
      let verdict: CriticVerdict;
      try {
        verdict = await deps.agents.evaluate({
          hypothesisStatement: s.hypothesisStatement,
          predictions: s.predictions ?? [],
          runOutput: s.runOutput,
          designSummary,
          previousVerdict: s.lastVerdict || undefined,
          originalQuestion: s.questionText || undefined,
          cycleId: s.cycleId,
          literature: s.literature ?? [],
        });
      } catch (e: any) {
        // 评审不可用时按 inconclusive 落库：证据不足就诚实说不足，不要伪造结论
        const msg = String(e?.message || e).slice(0, 400);
        deps.logger.warn(`[研究循环] 评审不可用（${msg}），本轮按 inconclusive 落库`);
        verdict = {
          verdict: 'inconclusive',
          confidence: 0,
          topicAligned: true,
          evidence: [],
          feedback: `评审不可用：${msg}`,
          revisionHint: '评审器不可用，下一轮请换更简单、更易验证的方案',
        };
      }
      const claim = deps.records.createClaim(s.programId, {
        statement: s.hypothesisStatement,
        cycleId: s.cycleId,
        protocolId: s.protocolId,
        confidence: verdict.confidence,
        status: verdict.verdict,
      });
      for (const ev of verdict.evidence ?? []) {
        deps.records.addEvidence(claim.id, {
          sourceType: 'experiment',
          sourceId: s.runId,
          quote: (ev.quote || '').slice(0, 4000),
          stance: ev.stance,
          strength: ev.strength,
          // 实验输出由服务端沙箱产生，属可核验来源，直接标记已核验
          verified: true,
        });
      }
      deps.records.updateClaim(claim.id, { status: verdict.verdict, confidence: verdict.confidence });
      deps.notify('evaluate', { claimId: claim.id, verdict: verdict.verdict, confidence: verdict.confidence, topicAligned: verdict.topicAligned });
      // 跑题时把「回到原问题」写进给下一轮 PI 的反馈——这是循环自纠偏的关键信号
      const driftNote = verdict.topicAligned === false ? '【严重偏离原问题】本轮工作已偏离原始研究问题，下一轮必须回到原问题重做方案。' : '';
      return {
        claimId: claim.id,
        verdict: verdict.verdict,
        feedback: [driftNote, verdict.feedback, verdict.revisionHint].filter(Boolean).join('\n'),
      };
    })
    .addNode('decide', async (s) => {
      const spent = deps.tokensSpent(s.cycleId);
      const nextIteration = s.iteration + 1;
      const stagnant =
        !!s.verdict && s.verdict === s.lastVerdict && !!s.designHash && s.designHash === s.lastDesignHash;
      const stagnationCount = stagnant ? s.stagnationCount + 1 : 0;

      let stopReason = '';
      let nextRoute: 'plan' | 'synthesize' | 'end' = 'plan';
      if (s.verdict === 'supported') {
        nextRoute = 'synthesize';
      } else if (s.maxTokens > 0 && spent >= s.maxTokens) {
        stopReason = 'budget_exceeded';
        nextRoute = 'end';
      } else if (nextIteration >= s.maxIterations) {
        stopReason = 'max_iterations';
        nextRoute = 'end';
      } else if (stagnationCount >= STAGNATION_LIMIT) {
        stopReason = 'stagnation';
        nextRoute = 'end';
      }

      if (nextRoute === 'plan') {
        deps.programs.updateCycle(s.cycleId, { state: 'revise', summary: `第 ${nextIteration} 轮修订：根据评审反馈重新设计方案` });
        deps.notify('revise', { nextIteration, stagnationCount });
      }
      return {
        iteration: nextIteration,
        lastVerdict: s.verdict,
        lastDesignHash: s.designHash,
        lastFeedback: s.feedback,
        stagnationCount,
        spentTokens: spent,
        stopReason: stopReason || s.stopReason,
        nextRoute,
      };
    })
    .addNode('synthesize', async (s) => {
      deps.programs.updateCycle(s.cycleId, { state: 'synthesize' });
      deps.notify('synthesize', { claimId: s.claimId, verdict: s.verdict });
      return { stopReason: 'completed' };
    })
    .addEdge(START, 'plan')
    .addEdge('plan', 'gate')
    .addConditionalEdges('gate', (s) => (s.stopReason ? 'end' : 'execute'), {
      execute: 'execute',
      end: END,
    })
    .addEdge('execute', 'evaluate')
    .addEdge('evaluate', 'decide')
    .addConditionalEdges('decide', (s) => s.nextRoute || 'end', {
      plan: 'plan',
      synthesize: 'synthesize',
      end: END,
    })
    .addEdge('synthesize', END);

  // checkpoint 落同一 SQLite：审批挂起后服务重启仍能 resume（与主流水线同一套断点机制）
  const checkpointer = options.checkpointer ?? new SqliteSaver(sqlite as never);
  return graph.compile({ checkpointer: checkpointer as never });
}
