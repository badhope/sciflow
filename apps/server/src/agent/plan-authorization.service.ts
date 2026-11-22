/**
 * 研究计划级授权（Plan-level authorization）。
 *
 * 为什么需要：
 *  - 逐次审批在长任务里会变成点击地狱；`alwaysAllow` 又等于一刀切放行。
 *  - 科研任务是「一份计划内的一组动作」：用户批准计划（问题/假设/协议/预算/工具白名单），
 *    计划内工具自动放行；计划外/高风险仍逐次审批。
 *
 * 安全边界：
 *  - 只有显式列入 allowedTools 的 canonical 工具名才会被自动放行；不支持 `*`。
 *  - 计划有 TTL（默认 12h）、步数上限、token 预算记账；超限即 exhausted，回到逐次审批。
 *  - 计划只对「本来就需要审批」的工具生效；只读工具不受计划约束。
 */

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db } from '../db/database';
import { agentPlans } from '../db/schema';
import { envInt } from '../common/env';
import { parseJson } from '../common/json-guard';

export type AgentPlanStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'exhausted';

export interface AgentPlanInput {
  projectId?: string | null;
  runId?: string | null;
  title: string;
  summary?: string;
  plan?: unknown;
  allowedTools?: string[];
  maxSteps?: number;
  budgetTokens?: number;
}

export interface AgentPlanView {
  id: string;
  projectId: string | null;
  runId: string | null;
  title: string;
  summary: string;
  plan: unknown;
  allowedTools: string[];
  status: AgentPlanStatus;
  maxSteps: number;
  usedSteps: number;
  budgetTokens: number;
  usedTokens: number;
  createdAt: number;
  approvedAt: number | null;
  expiresAt: number | null;
}

const DEFAULT_TTL_MS = envInt('AGENT_PLAN_TTL_MS', 12 * 60 * 60 * 1000, { min: 60_000, max: 7 * 24 * 60 * 60 * 1000 });
const MAX_STEPS_LIMIT = envInt('AGENT_PLAN_MAX_STEPS', 50, { min: 1, max: 200 });
const DEFAULT_MAX_STEPS = envInt('AGENT_PLAN_DEFAULT_STEPS', 12, { min: 1, max: 200 });

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((v) => String(v || '').trim())
        .filter((v) => v && !v.includes('*') && v.length <= 120),
    ),
  ).slice(0, 40);
}

@Injectable()
export class PlanAuthorizationService {
  /** decide() 后唤醒等待中的工具调用；只在进程内，不跨实例。 */
  private readonly decisions = new EventEmitter();

  private toView(row: typeof agentPlans.$inferSelect): AgentPlanView {
    return {
      id: row.id,
      projectId: row.projectId ?? null,
      runId: row.runId ?? null,
      title: row.title,
      summary: row.summary ?? '',
      plan: parseJson<unknown>(row.plan, {}),
      allowedTools: parseJson<string[]>(row.allowedTools, []),
      status: (row.status ?? 'pending') as AgentPlanStatus,
      maxSteps: row.maxSteps ?? DEFAULT_MAX_STEPS,
      usedSteps: row.usedSteps ?? 0,
      budgetTokens: row.budgetTokens ?? 0,
      usedTokens: row.usedTokens ?? 0,
      createdAt: row.createdAt,
      approvedAt: row.approvedAt ?? null,
      expiresAt: row.expiresAt ?? null,
    };
  }

  create(input: AgentPlanInput): AgentPlanView {
    const title = String(input.title || '').trim();
    if (!title) throw new BadRequestException('计划标题不能为空');
    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId: input.projectId || null,
      runId: input.runId || null,
      title: title.slice(0, 200),
      summary: String(input.summary || '').slice(0, 4000),
      plan: JSON.stringify(input.plan ?? {}),
      allowedTools: JSON.stringify(normalizeTools(input.allowedTools)),
      status: 'pending' as const,
      maxSteps: clampInt(input.maxSteps, DEFAULT_MAX_STEPS, 1, MAX_STEPS_LIMIT),
      usedSteps: 0,
      budgetTokens: clampInt(input.budgetTokens, 0, 0, 100_000_000),
      usedTokens: 0,
      createdAt: now,
      approvedAt: null as number | null,
      expiresAt: null as number | null,
    };
    db.insert(agentPlans).values(row).run();
    return this.toView(row as typeof agentPlans.$inferSelect);
  }

  list(projectId?: string | null): AgentPlanView[] {
    this.expireStale();
    const rows = projectId
      ? db.select().from(agentPlans).where(eq(agentPlans.projectId, projectId)).orderBy(desc(agentPlans.createdAt)).all()
      : db.select().from(agentPlans).orderBy(desc(agentPlans.createdAt)).all();
    return rows.map((r) => this.toView(r));
  }

  get(id: string): AgentPlanView {
    const row = db.select().from(agentPlans).where(eq(agentPlans.id, id)).get();
    if (!row) throw new NotFoundException('研究计划不存在');
    return this.toView(row);
  }

  decide(id: string, approved: boolean): AgentPlanView {
    const row = db.select().from(agentPlans).where(eq(agentPlans.id, id)).get();
    if (!row) throw new NotFoundException('研究计划不存在');
    if (row.status !== 'pending') return this.toView(row);
    const now = Date.now();
    db.update(agentPlans)
      .set(
        approved
          ? { status: 'approved', approvedAt: now, expiresAt: now + DEFAULT_TTL_MS }
          : { status: 'rejected', approvedAt: null, expiresAt: null },
      )
      .where(eq(agentPlans.id, id))
      .run();
    const view = this.get(id);
    this.decisions.emit('decided', view);
    return view;
  }

  /**
   * 等待用户批准/拒绝某份计划；用于 request_research_plan 把「批准」变成同一条流程里的暂停点。
   * 超时返回当前状态（仍为 pending），调用方应结束本轮并提示用户稍后继续。
   */
  waitForDecision(id: string, timeoutMs: number): Promise<AgentPlanView> {
    const current = this.get(id);
    if (current.status !== 'pending') return Promise.resolve(current);
    return new Promise((resolve) => {
      let settled = false;
      const timerRef: { id?: ReturnType<typeof setTimeout> } = {};
      const finish = (view: AgentPlanView) => {
        if (settled) return;
        settled = true;
        if (timerRef.id) clearTimeout(timerRef.id);
        this.decisions.off('decided', onChange);
        resolve(view);
      };
      const onChange = (view: AgentPlanView) => {
        if (view.id === id) finish(view);
      };
      timerRef.id = setTimeout(() => finish(this.get(id)), Math.max(1, timeoutMs));
      this.decisions.on('decided', onChange);
      // 注册监听后再读一次，覆盖“刚好在 get 与 on 之间被批准”的竞态。
      const latest = this.get(id);
      if (latest.status !== 'pending') finish(latest);
    });
  }

  /**
   * 计划是否允许本次工具调用；允许则消费 1 步并返回计划。
   * 返回 null 表示「计划不放行」，调用方应回落到逐次审批。
   */
  authorize(toolName: string, projectId?: string | null, _runId?: string | null): AgentPlanView | null {
    this.expireStale();
    const row = this.findActivePlan(projectId);
    if (!row) return null;
    const tools = parseJson<string[]>(row.allowedTools, []);
    if (!tools.includes(toolName)) return null;
    const used = row.usedSteps ?? 0;
    const max = row.maxSteps ?? DEFAULT_MAX_STEPS;
    if (used >= max) {
      db.update(agentPlans).set({ status: 'exhausted' }).where(eq(agentPlans.id, row.id)).run();
      return null;
    }
    db.update(agentPlans).set({ usedSteps: used + 1 }).where(eq(agentPlans.id, row.id)).run();
    return this.get(row.id);
  }

  /** 按项目找当前生效的计划（已批准、未过期、未耗尽）；供工具授权与 token 记账共用。 */
  private findActivePlan(projectId?: string | null) {
    return db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.status, 'approved'))
      .orderBy(desc(agentPlans.approvedAt))
      .all()
      .find((r) => (r.projectId ?? null) === (projectId ?? null) && (r.expiresAt ?? 0) > Date.now());
  }

  /**
   * 按项目记一轮真实 token：chat 流式收尾拿到 usage 后调用。
   * 无生效计划则静默跳过；预算耗尽由 recordTokens 统一标记 exhausted。
   */
  recordProjectTokens(projectId: string, tokens: number): void {
    this.expireStale();
    const row = this.findActivePlan(projectId);
    if (row) this.recordTokens(row.id, tokens);
  }

  /** token 记账：仅在已知 usage 时调用；预算耗尽则计划失效，回落到逐次审批。 */
  recordTokens(id: string, tokens: number): void {
    const n = clampInt(tokens, 0, 0, 100_000_000);
    if (!n) return;
    const row = db.select().from(agentPlans).where(eq(agentPlans.id, id)).get();
    if (!row) return;
    const used = (row.usedTokens ?? 0) + n;
    const budget = row.budgetTokens ?? 0;
    const exhausted = budget > 0 && used >= budget;
    db.update(agentPlans)
      .set({ usedTokens: used, ...(exhausted ? { status: 'exhausted' as const } : {}) })
      .where(eq(agentPlans.id, id))
      .run();
  }

  /** 超时/步数耗尽的计划标记失效，避免界面长期挂着旧计划。 */
  private expireStale(): void {
    const now = Date.now();
    const rows = db.select().from(agentPlans).where(eq(agentPlans.status, 'approved')).all();
    for (const r of rows) {
      const expired = (r.expiresAt ?? 0) > 0 && (r.expiresAt ?? 0) <= now;
      const exhausted = (r.usedSteps ?? 0) >= (r.maxSteps ?? DEFAULT_MAX_STEPS);
      if (expired || exhausted) {
        db.update(agentPlans).set({ status: expired ? 'expired' : 'exhausted' }).where(eq(agentPlans.id, r.id)).run();
      }
    }
  }
}
