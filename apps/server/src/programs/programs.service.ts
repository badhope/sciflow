import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import {
  researchPrograms,
  researchCycles,
  researchQuestions,
  researchHypotheses,
  researchProtocols,
} from '../db/schema';
import { parseJson } from '../common/json-guard';

const AUTONOMY_LEVELS = new Set(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
const PROGRAM_STATUS = new Set(['draft', 'active', 'paused', 'completed', 'archived']);
const CYCLE_STATES = new Set([
  'intake', 'question', 'landscape', 'gap', 'hypotheses', 'protocol',
  'feasibility', 'execute', 'analyze', 'red_team', 'revise', 'synthesize',
  'reproduce', 'report', 'retrospective',
  // awaiting_approval：自主研究循环在协议审批门禁处挂起，等人工批准后继续
  'awaiting_approval', 'stopped', 'blocked',
]);
const QUESTION_STATUS = new Set(['open', 'active', 'answered', 'abandoned']);
const HYPOTHESIS_STATUS = new Set(['proposed', 'testing', 'supported', 'refuted', 'inconclusive', 'abandoned']);
const PROTOCOL_STATUS = new Set(['draft', 'approved', 'running', 'completed', 'abandoned']);

function assertEnum(value: unknown, allowed: Set<string>, field: string, fallback?: string): string {
  const v = String(value ?? fallback ?? '').trim();
  if (!allowed.has(v)) throw new BadRequestException(`${field} 取值不合法`);
  return v;
}

function niceJson(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    throw new BadRequestException('参数必须是可序列化的 JSON');
  }
}

/**
 * 自主科研对象服务（阶段 2 最小纵切）。
 *
 * 关系：Program（课题/研究计划）→ Cycle（一轮研究循环）→ Question（问题）
 *      → Hypothesis（可证伪假设）→ Protocol（可执行方案版本）。
 * 设计原则：
 *  - 所有实体都冗余 programId，便于授权与按项目聚合查询；
 *  - 状态机取值集中在服务层校验，避免脏状态写库；
 *  - 版本/审批只追加，不覆盖历史（Protocol 新版本 = 新行）。
 */
@Injectable()
export class ProgramsService {
  // ---------- Program ----------

  listPrograms(projectId: string) {
    return db
      .select()
      .from(researchPrograms)
      .where(eq(researchPrograms.projectId, projectId))
      .orderBy(desc(researchPrograms.createdAt))
      .all()
      .map((r) => this.programDto(r));
  }

  createProgram(projectId: string, input: { title?: string; goal?: string; domain?: string; autonomyLevel?: string; constraints?: unknown; successCriteria?: unknown }, actor = '') {
    const title = String(input?.title || '').trim();
    if (!title) throw new BadRequestException('研究项目标题不能为空');
    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId,
      title: title.slice(0, 300),
      goal: String(input.goal || '').slice(0, 20_000),
      domain: String(input.domain || '').slice(0, 100),
      autonomyLevel: assertEnum(input.autonomyLevel, AUTONOMY_LEVELS, 'autonomyLevel', 'L2'),
      status: 'draft',
      constraints: niceJson(input.constraints, '{}'),
      successCriteria: niceJson(input.successCriteria, '[]'),
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchPrograms).values(row).run();
    return this.programDto(row);
  }

  getProgram(programId: string) {
    const row = db.select().from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!row) throw new NotFoundException('研究项目不存在');
    return {
      ...this.programDto(row),
      cycles: this.listCycles(programId),
      questions: this.listQuestions(programId),
    };
  }

  updateProgram(programId: string, patch: { title?: string; goal?: string; domain?: string; autonomyLevel?: string; status?: string; constraints?: unknown; successCriteria?: unknown }) {
    const existing = db.select().from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!existing) throw new NotFoundException('研究项目不存在');
    const set: Partial<typeof researchPrograms.$inferInsert> = { updatedAt: Date.now() };
    if (patch.title !== undefined) {
      const title = String(patch.title).trim();
      if (!title) throw new BadRequestException('研究项目标题不能为空');
      set.title = title.slice(0, 300);
    }
    if (patch.goal !== undefined) set.goal = String(patch.goal).slice(0, 20_000);
    if (patch.domain !== undefined) set.domain = String(patch.domain).slice(0, 100);
    if (patch.autonomyLevel !== undefined) set.autonomyLevel = assertEnum(patch.autonomyLevel, AUTONOMY_LEVELS, 'autonomyLevel');
    if (patch.status !== undefined) set.status = assertEnum(patch.status, PROGRAM_STATUS, 'status');
    if (patch.constraints !== undefined) set.constraints = niceJson(patch.constraints, '{}');
    if (patch.successCriteria !== undefined) set.successCriteria = niceJson(patch.successCriteria, '[]');
    db.update(researchPrograms).set(set).where(eq(researchPrograms.id, programId)).run();
    return this.getProgram(programId);
  }

  // ---------- Cycle ----------

  listCycles(programId: string) {
    return db
      .select()
      .from(researchCycles)
      .where(eq(researchCycles.programId, programId))
      .orderBy(asc(researchCycles.seq))
      .all()
      .map((r) => this.cycleDto(r));
  }

  getCycle(cycleId: string) {
    const row = db.select().from(researchCycles).where(eq(researchCycles.id, cycleId)).get();
    if (!row) throw new NotFoundException('研究循环不存在');
    return this.cycleDto(row);
  }

  createCycle(programId: string, input: { objective?: string; budget?: unknown; state?: string }) {
    const program = db.select({ id: researchPrograms.id }).from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!program) throw new NotFoundException('研究项目不存在');
    const last = db
      .select({ seq: researchCycles.seq })
      .from(researchCycles)
      .where(eq(researchCycles.programId, programId))
      .orderBy(desc(researchCycles.seq))
      .get();
    const now = Date.now();
    const row = {
      id: randomUUID(),
      programId,
      seq: (last?.seq ?? 0) + 1,
      state: assertEnum(input.state, CYCLE_STATES, 'state', 'intake'),
      objective: String(input.objective || '').slice(0, 20_000),
      summary: '',
      budget: niceJson(input.budget, '{}'),
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchCycles).values(row).run();
    return this.cycleDto(row);
  }

  updateCycle(cycleId: string, patch: { state?: string; objective?: string; summary?: string; budget?: unknown }) {
    const existing = db.select().from(researchCycles).where(eq(researchCycles.id, cycleId)).get();
    if (!existing) throw new NotFoundException('研究循环不存在');
    const set: Partial<typeof researchCycles.$inferInsert> = { updatedAt: Date.now() };
    if (patch.state !== undefined) {
      set.state = assertEnum(patch.state, CYCLE_STATES, 'state');
      if (['report', 'retrospective', 'stopped'].includes(set.state as string)) set.endedAt = Date.now();
    }
    if (patch.objective !== undefined) set.objective = String(patch.objective).slice(0, 20_000);
    if (patch.summary !== undefined) set.summary = String(patch.summary).slice(0, 20_000);
    if (patch.budget !== undefined) set.budget = niceJson(patch.budget, '{}');
    db.update(researchCycles).set(set).where(eq(researchCycles.id, cycleId)).run();
    return this.cycleDto(db.select().from(researchCycles).where(eq(researchCycles.id, cycleId)).get()!);
  }

  // ---------- Question ----------

  listQuestions(programId: string) {
    return db
      .select()
      .from(researchQuestions)
      .where(eq(researchQuestions.programId, programId))
      .orderBy(desc(researchQuestions.createdAt))
      .all();
  }

  createQuestion(programId: string, input: { question?: string; scope?: string; cycleId?: string; status?: string }) {
    const program = db.select({ id: researchPrograms.id }).from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!program) throw new NotFoundException('研究项目不存在');
    const question = String(input?.question || '').trim();
    if (!question) throw new BadRequestException('研究问题不能为空');
    if (input.cycleId) {
      const cycle = db.select({ id: researchCycles.id, programId: researchCycles.programId }).from(researchCycles).where(eq(researchCycles.id, input.cycleId)).get();
      if (!cycle || cycle.programId !== programId) throw new BadRequestException('cycleId 不属于当前研究项目');
    }
    const now = Date.now();
    const row = {
      id: randomUUID(),
      programId,
      cycleId: input.cycleId || null,
      question: question.slice(0, 20_000),
      scope: String(input.scope || '').slice(0, 20_000),
      status: assertEnum(input.status, QUESTION_STATUS, 'status', 'open'),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchQuestions).values(row).run();
    return row;
  }

  // ---------- Hypothesis ----------

  listHypotheses(questionId: string) {
    return db
      .select()
      .from(researchHypotheses)
      .where(eq(researchHypotheses.questionId, questionId))
      .orderBy(desc(researchHypotheses.createdAt))
      .all()
      .map((r) => this.hypothesisDto(r));
  }

  createHypothesis(questionId: string, input: { statement?: string; rationale?: string; predictions?: unknown; status?: string }) {
    const question = db.select().from(researchQuestions).where(eq(researchQuestions.id, questionId)).get();
    if (!question) throw new NotFoundException('研究问题不存在');
    const statement = String(input?.statement || '').trim();
    if (!statement) throw new BadRequestException('假设陈述不能为空');
    const now = Date.now();
    const row = {
      id: randomUUID(),
      programId: question.programId,
      questionId,
      statement: statement.slice(0, 20_000),
      rationale: String(input.rationale || '').slice(0, 20_000),
      predictions: niceJson(input.predictions, '[]'),
      status: assertEnum(input.status, HYPOTHESIS_STATUS, 'status', 'proposed'),
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchHypotheses).values(row).run();
    return this.hypothesisDto(row);
  }

  // ---------- Protocol ----------

  listProtocols(hypothesisId: string) {
    return db
      .select()
      .from(researchProtocols)
      .where(eq(researchProtocols.hypothesisId, hypothesisId))
      .orderBy(desc(researchProtocols.version))
      .all()
      .map((r) => this.protocolDto(r));
  }

  /** 项目下全部协议（Run 创建时选择已审批方案用） */
  listProgramProtocols(programId: string) {
    return db
      .select()
      .from(researchProtocols)
      .where(eq(researchProtocols.programId, programId))
      .orderBy(desc(researchProtocols.createdAt))
      .all()
      .map((r) => this.protocolDto(r));
  }

  createProtocol(hypothesisId: string, input: { design?: unknown; status?: string }) {
    const hypothesis = db.select().from(researchHypotheses).where(eq(researchHypotheses.id, hypothesisId)).get();
    if (!hypothesis) throw new NotFoundException('研究假设不存在');
    const last = db
      .select({ version: researchProtocols.version })
      .from(researchProtocols)
      .where(eq(researchProtocols.hypothesisId, hypothesisId))
      .orderBy(desc(researchProtocols.version))
      .get();
    const now = Date.now();
    const row = {
      id: randomUUID(),
      programId: hypothesis.programId,
      hypothesisId,
      version: (last?.version ?? 0) + 1,
      design: niceJson(input.design, '{}'),
      status: assertEnum(input.status, PROTOCOL_STATUS, 'status', 'draft'),
      approvedBy: '',
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchProtocols).values(row).run();
    return this.protocolDto(row);
  }

  approveProtocol(protocolId: string, actor: string) {
    const existing = db.select().from(researchProtocols).where(eq(researchProtocols.id, protocolId)).get();
    if (!existing) throw new NotFoundException('研究协议不存在');
    if (existing.status === 'abandoned') throw new BadRequestException('已废弃的协议不能审批');
    const now = Date.now();
    db.update(researchProtocols)
      .set({ status: 'approved', approvedBy: actor, approvedAt: now, updatedAt: now })
      .where(eq(researchProtocols.id, protocolId))
      .run();
    return this.protocolDto(db.select().from(researchProtocols).where(eq(researchProtocols.id, protocolId)).get()!);
  }

  // ---------- DTO ----------

  private programDto(r: typeof researchPrograms.$inferSelect) {
    return {
      ...r,
      constraints: parseJson<Record<string, unknown>>(r.constraints, {}),
      successCriteria: parseJson<unknown[]>(r.successCriteria, []),
    };
  }

  private cycleDto(r: typeof researchCycles.$inferSelect) {
    return { ...r, budget: parseJson<Record<string, unknown>>(r.budget, {}) };
  }

  private hypothesisDto(r: typeof researchHypotheses.$inferSelect) {
    return { ...r, predictions: parseJson<unknown[]>(r.predictions, []) };
  }

  private protocolDto(r: typeof researchProtocols.$inferSelect) {
    return { ...r, design: parseJson<Record<string, unknown>>(r.design, {}) };
  }
}
