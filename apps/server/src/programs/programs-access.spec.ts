import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects } from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';
import { ProgramsService } from './programs.service';
import { ProgramsController } from './programs.controller';

/**
 * 科研对象 API 的项目授权（企业模式）。
 * 锁定 Program/Cycle/Question/Hypothesis/Protocol 全链路的 owner 校验，
 * 防止后续前端/Agent 接入时绕过 ProjectAccessService。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;
const alice = { sub: 'program-alice', email: 'alice@test.local', role: 'user' };
const bob = { sub: 'program-bob', email: 'bob@test.local', role: 'user' };

describe('ProgramsController 项目授权（企业模式）', () => {
  let pidA: string;
  let pidB: string;
  let programA: string;
  let programB: string;
  let questionA: string;
  let questionB: string;
  let hypothesisA: string;
  let hypothesisB: string;
  let protocolB: string;
  let controller: ProgramsController;
  let svc: ProgramsService;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const now = Date.now();
    pidA = randomUUID();
    pidB = randomUUID();
    db.insert(projects).values({ id: pidA, name: 'Program Alice', description: '', ownerId: alice.sub, createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'Program Bob', description: '', ownerId: bob.sub, createdAt: now, updatedAt: now }).run();
    svc = new ProgramsService();
    programA = svc.createProgram(pidA, { title: 'Alice 项目' }).id;
    programB = svc.createProgram(pidB, { title: 'Bob 项目' }).id;
    questionA = svc.createQuestion(programA, { question: 'Alice 问题' }).id;
    questionB = svc.createQuestion(programB, { question: 'Bob 问题' }).id;
    hypothesisA = svc.createHypothesis(questionA, { statement: 'Alice 假设' }).id;
    hypothesisB = svc.createHypothesis(questionB, { statement: 'Bob 假设' }).id;
    protocolB = svc.createProtocol(hypothesisB, { design: { metric: 'F1' } }).id;
    controller = new ProgramsController(svc, new ProjectAccessService());
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('Program 列表/详情：跨项目 404，owner 放行', () => {
    expect(() => controller.list(pidB, { user: alice })).toThrow(NotFoundException);
    const listA = controller.list(pidA, { user: alice });
    expect(listA.some((p) => p.id === programA)).toBe(true);
    expect(() => controller.get(programB, { user: alice })).toThrow(NotFoundException);
    expect(controller.get(programA, { user: alice }).id).toBe(programA);
  });

  it('Cycle/Question/Hypothesis/Protocol：跨项目 404', () => {
    expect(() => controller.createQuestion(programB, { question: 'x' }, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.createHypothesis(questionB, { statement: 'x' }, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.createProtocol(hypothesisB, { design: {} }, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.approveProtocol(protocolB, { user: alice })).toThrow(NotFoundException);
    expect(controller.createHypothesis(questionA, { statement: 'x' }, { user: alice }).programId).toBe(programA);
    expect(controller.approveProtocol(svc.createProtocol(hypothesisA, { design: {} }).id, { user: alice }).status).toBe('approved');
  });
});
