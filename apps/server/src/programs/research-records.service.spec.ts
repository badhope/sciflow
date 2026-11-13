import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects, experiments } from '../db/schema';
import { ProgramsService } from './programs.service';
import { ResearchRecordsService } from './research-records.service';

/**
 * Claim / Evidence / Run 最小纵切。
 * 锁定置信度/证据强度校验、证据立场、运行状态与 manifest 持久化，
 * 以及 Protocol/Cycle 必须属于同一 Program。
 */
describe('ResearchRecordsService 研究记录', () => {
  let projectId: string;
  let programId: string;
  let cycleId: string;
  let protocolId: string;
  let programs: ProgramsService;
  let svc: ResearchRecordsService;

  beforeEach(() => {
    projectId = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: projectId, name: '研究记录测试项目', description: '', ownerId: '', createdAt: now, updatedAt: now }).run();
    programs = new ProgramsService();
    svc = new ResearchRecordsService();
    const p = programs.createProgram(projectId, { title: '记录测试' });
    programId = p.id;
    cycleId = programs.createCycle(programId, {}).id;
    const q = programs.createQuestion(programId, { question: 'q' });
    const h = programs.createHypothesis(q.id, { statement: 'h' });
    protocolId = programs.createProtocol(h.id, { design: { metric: 'F1' } }).id;
    programs.approveProtocol(protocolId, 'test');
  });

  it('创建 Claim：默认 confidence=50、status=draft；非法值拒绝', () => {
    const c = svc.createClaim(programId, { statement: '方法 A 优于 B', cycleId, protocolId });
    expect(c.confidence).toBe(50);
    expect(c.status).toBe('draft');
    expect(() => svc.createClaim(programId, { statement: 'x', confidence: 101 })).toThrow(BadRequestException);
    expect(() => svc.createClaim(programId, { statement: 'x', status: 'nope' })).toThrow(BadRequestException);
  });

  it('Evidence：支持/反驳/不确定，强度 1-5，可独立复核', () => {
    const c = svc.createClaim(programId, { statement: 'A 优于 B' });
    const e1 = svc.addEvidence(c.id, { sourceType: 'experiment', sourceId: 'run-1', stance: 'supports', strength: 5, quote: 'F1 0.91 vs 0.82' });
    const e2 = svc.addEvidence(c.id, { sourceType: 'literature', stance: 'refutes', strength: 2, verified: true });
    expect(e1.stance).toBe('supports');
    expect(e2.verified).toBe(1);
    expect(() => svc.addEvidence(c.id, { sourceType: 'experiment', strength: 6 })).toThrow(BadRequestException);
    expect(svc.listEvidence(c.id)).toHaveLength(2);
    expect(svc.verifyEvidence(e1.id, true).verified).toBe(1);
    expect(svc.getClaim(c.id).evidence).toHaveLength(2);
  });

  it('Run：manifest 持久化，running 写 startedAt，终态写 endedAt', () => {
    const run = svc.createRun(programId, {
      cycleId,
      protocolId,
      manifest: { python: '3.11', seed: 42, dataset: 'demo' },
    });
    expect(run.status).toBe('pending');
    expect(run.manifest).toEqual({ python: '3.11', seed: 42, dataset: 'demo' });

    const running = svc.updateRun(run.id, { status: 'running' });
    expect(running.startedAt).toBeTruthy();
    const done = svc.updateRun(run.id, { status: 'completed', summary: '复现完成' });
    expect(done.endedAt).toBeTruthy();
    expect(done.summary).toBe('复现完成');
    expect(() => svc.updateRun(run.id, { status: 'nope' })).toThrow(BadRequestException);
  });

  it('Run：可写入外部 manifest 的起止时间', () => {
    const run = svc.createRun(programId, { status: 'completed', startedAt: 1_700_000_000_000, endedAt: 1_700_000_060_000 });
    expect(run.startedAt).toBe(1_700_000_000_000);
    expect(run.endedAt).toBe(1_700_000_060_000);
    expect(() => svc.createRun(programId, { status: 'completed', startedAt: -1 })).toThrow(BadRequestException);
  });

  it('L2 门禁：未审批协议不能创建 Run，批准后可以', () => {
    const q = programs.createQuestion(programId, { question: '门禁问题' });
    const h = programs.createHypothesis(q.id, { statement: '门禁假设' });
    const draft = programs.createProtocol(h.id, { design: { metric: 'accuracy' } }).id;
    expect(() => svc.createRun(programId, { protocolId: draft })).toThrow(BadRequestException);
    programs.approveProtocol(draft, 'test');
    expect(svc.createRun(programId, { protocolId: draft }).status).toBe('pending');
  });

  it('experimentId 必须属于同一项目', () => {
    const otherPid = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: otherPid, name: '另一个项目容器', description: '', ownerId: '', createdAt: now, updatedAt: now }).run();
    const sameExp = randomUUID();
    const otherExp = randomUUID();
    db.insert(experiments).values({ id: sameExp, projectId, code: 'print(1)', createdAt: now, updatedAt: now }).run();
    db.insert(experiments).values({ id: otherExp, projectId: otherPid, code: 'print(2)', createdAt: now, updatedAt: now }).run();
    expect(() => svc.createRun(programId, { experimentId: otherExp })).toThrow(BadRequestException);
    expect(svc.createRun(programId, { experimentId: sameExp }).experimentId).toBe(sameExp);
  });

  it('Cycle/Protocol 必须属于当前 Program', () => {
    const other = programs.createProgram(projectId, { title: '另一个项目' });
    const otherCycle = programs.createCycle(other.id, {});
    expect(() => svc.createClaim(programId, { statement: 'x', cycleId: otherCycle.id })).toThrow(BadRequestException);
    expect(() => svc.createRun(programId, { cycleId: otherCycle.id })).toThrow(BadRequestException);
    expect(() => svc.createRun(programId, { protocolId: 'ghost' })).toThrow(BadRequestException);
  });
});
