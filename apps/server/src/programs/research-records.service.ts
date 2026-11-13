import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import {
  researchPrograms,
  researchCycles,
  researchProtocols,
  researchClaims,
  researchEvidence,
  researchRuns,
  experiments,
} from '../db/schema';
import { parseJson } from '../common/json-guard';

const CLAIM_STATUS = new Set(['draft', 'supported', 'refuted', 'inconclusive', 'accepted', 'rejected']);
const EVIDENCE_SOURCE = new Set(['literature', 'experiment', 'dataset', 'external', 'ai']);
const EVIDENCE_STANCE = new Set(['supports', 'refutes', 'uncertain']);
const RUN_STATUS = new Set(['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled']);
const TERMINAL_RUN_STATUS = new Set(['completed', 'failed', 'timeout', 'cancelled']);

function assertEnum(value: unknown, allowed: Set<string>, field: string, fallback?: string): string {
  const v = String(value ?? fallback ?? '').trim();
  if (!allowed.has(v)) throw new BadRequestException(`${field} 取值不合法`);
  return v;
}

function intInRange(value: unknown, min: number, max: number, field: string, fallback?: number): number {
  const n = value === undefined ? fallback : Math.floor(Number(value));
  if (n === undefined || !Number.isFinite(n) || n < min || n > max) {
    throw new BadRequestException(`${field} 需为 ${min}-${max} 的整数`);
  }
  return n;
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
 * 研究记录服务（阶段 2B）：Claim / Evidence / Run。
 *
 * 关系：Protocol → Run（一次执行）→ Claim（结论）→ Evidence（支持/反驳/不确定）。
 * 证据的 source_type 可指向文献、实验、数据集、外部来源或 AI 输出；
 * verified 表示是否经过人工/独立复核，不表示自动为真。
 */
@Injectable()
export class ResearchRecordsService {
  // ---------- Claim ----------

  listClaims(programId: string) {
    return db
      .select()
      .from(researchClaims)
      .where(eq(researchClaims.programId, programId))
      .orderBy(desc(researchClaims.createdAt))
      .all();
  }

  getClaim(claimId: string) {
    const row = db.select().from(researchClaims).where(eq(researchClaims.id, claimId)).get();
    if (!row) throw new NotFoundException('研究结论不存在');
    return { ...row, evidence: this.listEvidence(claimId) };
  }

  createClaim(programId: string, input: { statement?: string; cycleId?: string; protocolId?: string; confidence?: number; status?: string; scope?: string }, actor = '') {
    const program = db.select({ id: researchPrograms.id }).from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!program) throw new NotFoundException('研究项目不存在');
    const statement = String(input?.statement || '').trim();
    if (!statement) throw new BadRequestException('结论陈述不能为空');
    if (input.cycleId) this.assertCycleInProgram(input.cycleId, programId);
    if (input.protocolId) this.assertProtocolInProgram(input.protocolId, programId);
    const now = Date.now();
    const row = {
      id: randomUUID(),
      programId,
      cycleId: input.cycleId || null,
      protocolId: input.protocolId || null,
      statement: statement.slice(0, 20_000),
      confidence: intInRange(input.confidence, 0, 100, 'confidence', 50),
      status: assertEnum(input.status, CLAIM_STATUS, 'status', 'draft'),
      scope: String(input.scope || '').slice(0, 20_000),
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchClaims).values(row).run();
    return row;
  }

  updateClaim(claimId: string, patch: { statement?: string; confidence?: number; status?: string; scope?: string }) {
    const existing = db.select().from(researchClaims).where(eq(researchClaims.id, claimId)).get();
    if (!existing) throw new NotFoundException('研究结论不存在');
    const set: Partial<typeof researchClaims.$inferInsert> = { updatedAt: Date.now() };
    if (patch.statement !== undefined) {
      const statement = String(patch.statement).trim();
      if (!statement) throw new BadRequestException('结论陈述不能为空');
      set.statement = statement.slice(0, 20_000);
    }
    if (patch.confidence !== undefined) set.confidence = intInRange(patch.confidence, 0, 100, 'confidence');
    if (patch.status !== undefined) set.status = assertEnum(patch.status, CLAIM_STATUS, 'status');
    if (patch.scope !== undefined) set.scope = String(patch.scope).slice(0, 20_000);
    db.update(researchClaims).set(set).where(eq(researchClaims.id, claimId)).run();
    return this.getClaim(claimId);
  }

  // ---------- Evidence ----------

  listEvidence(claimId: string) {
    return db
      .select()
      .from(researchEvidence)
      .where(eq(researchEvidence.claimId, claimId))
      .orderBy(desc(researchEvidence.createdAt))
      .all();
  }

  addEvidence(claimId: string, input: { sourceType?: string; sourceId?: string; quote?: string; stance?: string; strength?: number; verified?: boolean }, actor = '') {
    const claim = db.select().from(researchClaims).where(eq(researchClaims.id, claimId)).get();
    if (!claim) throw new NotFoundException('研究结论不存在');
    const sourceType = assertEnum(input.sourceType, EVIDENCE_SOURCE, 'sourceType');
    const row = {
      id: randomUUID(),
      programId: claim.programId,
      claimId,
      sourceType,
      sourceId: String(input.sourceId || '').slice(0, 500),
      quote: String(input.quote || '').slice(0, 20_000),
      stance: assertEnum(input.stance, EVIDENCE_STANCE, 'stance', 'supports'),
      strength: intInRange(input.strength, 1, 5, 'strength', 3),
      verified: input.verified === true ? 1 : 0,
      createdBy: actor,
      createdAt: Date.now(),
    };
    db.insert(researchEvidence).values(row).run();
    return row;
  }

  verifyEvidence(evidenceId: string, verified: boolean) {
    const existing = db.select().from(researchEvidence).where(eq(researchEvidence.id, evidenceId)).get();
    if (!existing) throw new NotFoundException('研究证据不存在');
    db.update(researchEvidence).set({ verified: verified ? 1 : 0 }).where(eq(researchEvidence.id, evidenceId)).run();
    return db.select().from(researchEvidence).where(eq(researchEvidence.id, evidenceId)).get()!;
  }

  // ---------- Run ----------

  listRuns(programId: string) {
    return db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.programId, programId))
      .orderBy(desc(researchRuns.createdAt))
      .all()
      .map((r) => this.runDto(r));
  }

  getRun(runId: string) {
    const row = db.select().from(researchRuns).where(eq(researchRuns.id, runId)).get();
    if (!row) throw new NotFoundException('研究运行不存在');
    return this.runDto(row);
  }

  createRun(programId: string, input: { cycleId?: string; protocolId?: string; experimentId?: string; status?: string; manifest?: unknown; summary?: string; startedAt?: number; endedAt?: number }) {
    const program = db.select({ id: researchPrograms.id, projectId: researchPrograms.projectId }).from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!program) throw new NotFoundException('研究项目不存在');
    if (input.cycleId) this.assertCycleInProgram(input.cycleId, programId);
    if (input.protocolId) {
      const protocol = this.assertProtocolInProgram(input.protocolId, programId);
      // L2 门禁：未审批协议不得执行，避免 AI 绕开方案审查直接跑实验
      if (protocol.status !== 'approved') throw new BadRequestException('研究协议未审批，不能创建运行');
    }
    if (input.experimentId) {
      const exp = db.select().from(experiments).where(eq(experiments.id, input.experimentId)).get();
      if (!exp || exp.projectId !== program.projectId) throw new BadRequestException('experimentId 不属于当前项目');
    }
    const now = Date.now();
    const status = assertEnum(input.status, RUN_STATUS, 'status', 'pending');
    const startedAt = input.startedAt === undefined ? (status === 'running' ? now : null) : Math.floor(Number(input.startedAt));
    const endedAt = input.endedAt === undefined ? (TERMINAL_RUN_STATUS.has(status) ? now : null) : Math.floor(Number(input.endedAt));
    if (startedAt !== null && (!Number.isFinite(startedAt) || startedAt <= 0)) throw new BadRequestException('startedAt 不合法');
    if (endedAt !== null && (!Number.isFinite(endedAt) || endedAt <= 0)) throw new BadRequestException('endedAt 不合法');
    const row = {
      id: randomUUID(),
      programId,
      cycleId: input.cycleId || null,
      protocolId: input.protocolId || null,
      experimentId: String(input.experimentId || '').slice(0, 200),
      status,
      manifest: niceJson(input.manifest, '{}'),
      summary: String(input.summary || '').slice(0, 20_000),
      startedAt,
      endedAt,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(researchRuns).values(row).run();
    return this.runDto(row);
  }

  updateRun(runId: string, patch: { status?: string; manifest?: unknown; summary?: string; experimentId?: string; startedAt?: number; endedAt?: number }) {
    const existing = db.select().from(researchRuns).where(eq(researchRuns.id, runId)).get();
    if (!existing) throw new NotFoundException('研究运行不存在');
    const now = Date.now();
    const set: Partial<typeof researchRuns.$inferInsert> = { updatedAt: now };
    if (patch.status !== undefined) {
      const status = assertEnum(patch.status, RUN_STATUS, 'status');
      set.status = status;
      if (status === 'running' && !existing.startedAt) set.startedAt = now;
      if (TERMINAL_RUN_STATUS.has(status)) set.endedAt = now;
    }
    if (patch.manifest !== undefined) set.manifest = niceJson(patch.manifest, '{}');
    if (patch.summary !== undefined) set.summary = String(patch.summary).slice(0, 20_000);
    if (patch.experimentId !== undefined) set.experimentId = String(patch.experimentId).slice(0, 200);
    if (patch.startedAt !== undefined) set.startedAt = Math.floor(Number(patch.startedAt));
    if (patch.endedAt !== undefined) set.endedAt = Math.floor(Number(patch.endedAt));
    db.update(researchRuns).set(set).where(eq(researchRuns.id, runId)).run();
    return this.getRun(runId);
  }

  // ---------- helpers ----------

  private assertCycleInProgram(cycleId: string, programId: string) {
    const cycle = db.select({ id: researchCycles.id, programId: researchCycles.programId }).from(researchCycles).where(eq(researchCycles.id, cycleId)).get();
    if (!cycle || cycle.programId !== programId) throw new BadRequestException('cycleId 不属于当前研究项目');
  }

  private assertProtocolInProgram(protocolId: string, programId: string) {
    const protocol = db.select().from(researchProtocols).where(eq(researchProtocols.id, protocolId)).get();
    if (!protocol || protocol.programId !== programId) throw new BadRequestException('protocolId 不属于当前研究项目');
    return protocol;
  }

  private runDto(r: typeof researchRuns.$inferSelect) {
    return { ...r, manifest: parseJson<Record<string, unknown>>(r.manifest, {}) };
  }
}
