import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects } from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';
import { ProgramsService } from '../programs/programs.service';
import { ResearchRecordsService } from '../programs/research-records.service';
import { ResearchCycleController } from './research-cycle.controller';
import { ResearchCycleService } from './research-cycle.service';

/**
 * 自主研究循环 API 的项目授权（企业模式）。
 * 循环比普通对象多一个风险：start 会触发 LLM + 沙箱执行，必须锁项目归属，
 * 否则就是「拿别人的项目跑实验」。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;
const alice = { sub: 'cycle-alice', email: 'alice@test.local', role: 'user' };
const bob = { sub: 'cycle-bob', email: 'bob@test.local', role: 'user' };

/** AI 未配置时 start 会被服务层拒绝，这里只需验证授权在 AI 校验之前生效。 */
class FakeAi {
  configured = true;
  config = { model: 'test-model' };
}

describe('ResearchCycleController 项目授权（企业模式）', () => {
  let pidA: string;
  let pidB: string;
  let programA: string;
  let programB: string;
  let cycleB: string;
  let controller: ResearchCycleController;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const now = Date.now();
    pidA = randomUUID();
    pidB = randomUUID();
    db.insert(projects).values({ id: pidA, name: 'Cycle Alice', description: '', ownerId: alice.sub, createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'Cycle Bob', description: '', ownerId: bob.sub, createdAt: now, updatedAt: now }).run();
    const programs = new ProgramsService();
    programA = programs.createProgram(pidA, { title: 'Alice 计划' }).id;
    programB = programs.createProgram(pidB, { title: 'Bob 计划' }).id;
    cycleB = programs.createCycle(programB, { objective: 'Bob 循环' }).id;
    const service = new ResearchCycleService(
      programs,
      new ResearchRecordsService(),
      {} as never,
      new FakeAi() as never,
      {} as never,
      {} as never,
    );
    controller = new ResearchCycleController(service, new ProjectAccessService());
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('start：跨项目 404', () => {
    expect(() => controller.start({ programId: programB }, { user: alice })).toThrow(NotFoundException);
  });

  it('status / resume：跨项目 404', () => {
    expect(() => controller.status(cycleB, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.resume(cycleB, { approved: true }, { user: alice })).toThrow(NotFoundException);
  });

  it('list：跨项目 404', () => {
    expect(() => controller.list(programB, { user: alice })).toThrow(NotFoundException);
  });

  it('owner 可访问自己的计划', () => {
    expect(controller.list(programA, { user: alice })).toBeTruthy();
  });
});
