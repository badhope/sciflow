import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects } from '../db/schema';
import { ProgramsService } from './programs.service';

/**
 * 科研对象最小纵切：Program → Cycle → Question → Hypothesis → Protocol。
 * 锁定默认 L2、状态校验、版本递增与审批语义，防止后续 UI/Agent 接入时回退。
 */
describe('ProgramsService 科研对象纵切', () => {
  let projectId: string;
  let svc: ProgramsService;

  beforeEach(() => {
    projectId = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: projectId, name: '科研对象测试项目', description: '', ownerId: '', createdAt: now, updatedAt: now }).run();
    svc = new ProgramsService();
  });

  it('创建 Program：默认 L2、draft、JSON 约束可回读', () => {
    const p = svc.createProgram(projectId, {
      title: '图神经网络复现',
      goal: '复现主指标',
      constraints: { budgetUsd: 50 },
      successCriteria: ['主指标误差 ≤ 5%'],
    });
    expect(p.autonomyLevel).toBe('L2');
    expect(p.status).toBe('draft');
    expect(p.constraints).toEqual({ budgetUsd: 50 });
    expect(p.successCriteria).toEqual(['主指标误差 ≤ 5%']);
  });

  it('拒绝非法自主等级与空标题', () => {
    expect(() => svc.createProgram(projectId, { title: 'x', autonomyLevel: 'L9' })).toThrow(BadRequestException);
    expect(() => svc.createProgram(projectId, { title: '   ' })).toThrow(BadRequestException);
  });

  it('Cycle 序号递增，非法状态拒绝', () => {
    const p = svc.createProgram(projectId, { title: '循环测试' });
    const c1 = svc.createCycle(p.id, { objective: '第一轮' });
    const c2 = svc.createCycle(p.id, { objective: '第二轮' });
    expect(c1.seq).toBe(1);
    expect(c2.seq).toBe(2);
    expect(() => svc.createCycle(p.id, { state: 'not-a-state' })).toThrow(BadRequestException);
    expect(svc.updateCycle(c1.id, { state: 'execute' }).state).toBe('execute');
  });

  it('Question → Hypothesis → Protocol：版本递增并可审批', () => {
    const p = svc.createProgram(projectId, { title: '链路测试' });
    const q = svc.createQuestion(p.id, { question: '方法 A 是否优于 B？' });
    const h = svc.createHypothesis(q.id, {
      statement: 'A 在相同数据上优于 B',
      predictions: ['A 的 F1 高于 B'],
    });
    expect(h.programId).toBe(p.id);
    expect(h.predictions).toEqual(['A 的 F1 高于 B']);

    const pr1 = svc.createProtocol(h.id, { design: { variables: ['method'], metric: 'F1' } });
    const pr2 = svc.createProtocol(h.id, { design: { variables: ['method'], metric: 'F1', seed: 42 } });
    expect(pr1.version).toBe(1);
    expect(pr2.version).toBe(2);
    expect(pr1.design).toEqual({ variables: ['method'], metric: 'F1' });

    const approved = svc.approveProtocol(pr2.id, 'alice');
    expect(approved.status).toBe('approved');
    expect(approved.approvedBy).toBe('alice');
    expect(svc.listProtocols(h.id)).toHaveLength(2);
  });

  it('cycleId 必须属于当前 Program', () => {
    const p1 = svc.createProgram(projectId, { title: 'P1' });
    const p2 = svc.createProgram(projectId, { title: 'P2' });
    const c2 = svc.createCycle(p2.id, {});
    expect(() => svc.createQuestion(p1.id, { question: 'q', cycleId: c2.id })).toThrow(BadRequestException);
  });

  it('getProgram 返回 cycles/questions 聚合', () => {
    const p = svc.createProgram(projectId, { title: '聚合测试' });
    svc.createCycle(p.id, {});
    svc.createQuestion(p.id, { question: 'q1' });
    const full = svc.getProgram(p.id);
    expect(full.cycles).toHaveLength(1);
    expect(full.questions).toHaveLength(1);
  });
});
