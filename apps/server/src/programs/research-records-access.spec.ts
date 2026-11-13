import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects } from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';
import { ProgramsService } from './programs.service';
import { ResearchRecordsService } from './research-records.service';
import { ResearchRecordsController } from './research-records.controller';

/**
 * Claim/Evidence/Run API 的项目授权（企业模式）。
 * 锁定跨项目 404，覆盖 claim、evidence（经 claim）、run 三条路径。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;
const alice = { sub: 'records-alice', email: 'alice@test.local', role: 'user' };
const bob = { sub: 'records-bob', email: 'bob@test.local', role: 'user' };

describe('ResearchRecordsController 项目授权（企业模式）', () => {
  let pidA: string;
  let pidB: string;
  let programA: string;
  let programB: string;
  let claimA: string;
  let claimB: string;
  let evidenceB: string;
  let runA: string;
  let runB: string;
  let controller: ResearchRecordsController;
  let records: ResearchRecordsService;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const now = Date.now();
    pidA = randomUUID();
    pidB = randomUUID();
    db.insert(projects).values({ id: pidA, name: 'Records Alice', description: '', ownerId: alice.sub, createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'Records Bob', description: '', ownerId: bob.sub, createdAt: now, updatedAt: now }).run();
    const programs = new ProgramsService();
    programA = programs.createProgram(pidA, { title: 'Alice 研究' }).id;
    programB = programs.createProgram(pidB, { title: 'Bob 研究' }).id;
    records = new ResearchRecordsService();
    claimA = records.createClaim(programA, { statement: 'Alice 结论' }).id;
    claimB = records.createClaim(programB, { statement: 'Bob 结论' }).id;
    evidenceB = records.addEvidence(claimB, { sourceType: 'experiment', stance: 'supports' }).id;
    runA = records.createRun(programA, { manifest: { seed: 1 } }).id;
    runB = records.createRun(programB, { manifest: { seed: 2 } }).id;
    controller = new ResearchRecordsController(records, new ProjectAccessService());
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('Claim：跨项目 404，owner 放行', () => {
    expect(() => controller.listClaims(programB, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.getClaim(claimB, { user: alice })).toThrow(NotFoundException);
    expect(controller.listClaims(programA, { user: alice }).some((c) => c.id === claimA)).toBe(true);
    expect(controller.getClaim(claimA, { user: alice }).id).toBe(claimA);
  });

  it('Evidence：经 claim 校验归属；verify 也校验', () => {
    expect(() => controller.listEvidence(claimB, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.addEvidence(claimB, { sourceType: 'experiment' }, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.verifyEvidence(evidenceB, { verified: true }, { user: alice })).toThrow(NotFoundException);
    expect(controller.addEvidence(claimA, { sourceType: 'literature', stance: 'uncertain' }, { user: alice }).stance).toBe('uncertain');
  });

  it('Run：跨项目 404，owner 放行', () => {
    expect(() => controller.listRuns(programB, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.getRun(runB, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.updateRun(runB, { status: 'running' }, { user: alice })).toThrow(NotFoundException);
    expect(controller.getRun(runA, { user: alice }).id).toBe(runA);
  });
});
