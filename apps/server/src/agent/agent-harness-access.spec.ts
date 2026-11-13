import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects, agentTasks, toolApprovals } from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';
import { TaskListService } from './task-list.service';
import { ApprovalService } from './approval.service';
import { AgentHarnessController } from './agent-harness.controller';

/**
 * AgentHarnessController 项目授权（企业模式）。
 *
 * 此前任务/审批端点只依赖全局登录，任何登录用户可传他人 projectId 读取/清空清单、
 * 批准他人审批。本测试直接驱动 controller，锁定：
 *  - 带 projectId 时必须 owner；
 *  - 企业模式不带 projectId 直接 400；
 *  - 按 task/approval id 操作时校验其项目归属。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;
const alice = { sub: 'harness-alice', email: 'alice@test.local', role: 'user' };
const bob = { sub: 'harness-bob', email: 'bob@test.local', role: 'user' };

describe('AgentHarnessController 项目授权（企业模式）', () => {
  let pidA: string;
  let pidB: string;
  let taskA: string;
  let taskB: string;
  let approvalA: string;
  let approvalB: string;
  let controller: AgentHarnessController;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const now = Date.now();
    pidA = randomUUID();
    pidB = randomUUID();
    taskA = randomUUID();
    taskB = randomUUID();
    approvalA = randomUUID();
    approvalB = randomUUID();
    db.insert(projects).values({ id: pidA, name: 'Harness Alice', description: '', ownerId: alice.sub, createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'Harness Bob', description: '', ownerId: bob.sub, createdAt: now, updatedAt: now }).run();
    db.insert(agentTasks).values({ id: taskA, projectId: pidA, content: 'Alice 任务', status: 'pending', priority: 'medium', seq: 0, createdAt: now, updatedAt: now }).run();
    db.insert(agentTasks).values({ id: taskB, projectId: pidB, content: 'Bob 任务', status: 'pending', priority: 'medium', seq: 0, createdAt: now, updatedAt: now }).run();
    db.insert(toolApprovals).values({ id: approvalA, projectId: pidA, toolName: 'experiment.run', args: '{}', reason: '测试', status: 'pending', createdAt: now }).run();
    db.insert(toolApprovals).values({ id: approvalB, projectId: pidB, toolName: 'experiment.run', args: '{}', reason: '测试', status: 'pending', createdAt: now }).run();

    controller = new AgentHarnessController(
      new TaskListService(),
      new ApprovalService(),
      new ProjectAccessService(),
    );
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('listTasks：跨项目 404；企业模式缺 projectId 400；owner 放行', () => {
    expect(() => controller.listTasks(pidB, undefined, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.listTasks(undefined, undefined, { user: alice })).toThrow(BadRequestException);
    const r = controller.listTasks(pidA, undefined, { user: alice });
    expect(r.tasks.some((t) => t.id === taskA)).toBe(true);
  });

  it('replaceTasks / clearTasks：跨项目 404；缺 projectId 400', () => {
    expect(() => controller.replaceTasks({ projectId: pidB, tasks: [] }, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.clearTasks(pidB, undefined, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.clearTasks(undefined, undefined, { user: alice })).toThrow(BadRequestException);
  });

  it('setTaskStatus：按任务归属校验', () => {
    expect(() => controller.setTaskStatus(taskB, { status: 'completed' }, { user: alice })).toThrow(NotFoundException);
    expect(controller.setTaskStatus(taskA, { status: 'completed' }, { user: alice }).task?.id).toBe(taskA);
  });

  it('pendingApprovals / decideApproval：按审批归属校验', () => {
    expect(() => controller.pendingApprovals(pidB, { user: alice })).toThrow(NotFoundException);
    expect(() => controller.decideApproval(approvalB, { approved: true }, { user: alice })).toThrow(NotFoundException);
    expect(controller.decideApproval(approvalA, { approved: true }, { user: alice }).approval?.id).toBe(approvalA);
  });
});
