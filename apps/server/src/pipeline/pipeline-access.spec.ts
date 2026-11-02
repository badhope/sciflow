import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { eq } from 'drizzle-orm';
import { projects, pipelineTasks } from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';
import { PipelineController } from './pipeline.controller';
import type { PipelineService } from './pipeline.service';

/**
 * 流水线端点归属校验（v1.7 IDOR 防线）。
 *
 * 背景：pipeline.controller 此前完全没有 ProjectAccessService 校验，而 documents /
 * references / knowledge 全部都有。企业模式（AUTH_MODE=jwt）下任意账号知道 taskId
 * 即可读他人流水线（主题 / 产物文档 id / 执行轨迹），也能替他人项目起流水线烧 token。
 *
 * 本测试直接驱动控制器（不启动 HTTP 栈）：用最小假 PipelineService 提供 get()，
 * 断言「任务 → 项目 → 归属」的拒绝与放行语义。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;

const alice = { sub: 'user-alice', email: 'alice@test.local', role: 'user' as const };
const bob = { sub: 'user-bob', email: 'bob@test.local', role: 'user' as const };

describe('PipelineController 企业模式归属校验', () => {
  let pidA: string;
  let pidB: string;
  let taskA: string;
  let createdWith: { projectId: string; topic: string } | null;
  let controller: PipelineController;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    pidA = randomUUID();
    pidB = randomUUID();
    taskA = randomUUID();
    createdWith = null;
    const now = Date.now();
    db.insert(projects).values({ id: pidA, name: 'Alice 项目', description: '', ownerId: 'user-alice', createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'Bob 项目', description: '', ownerId: 'user-bob', createdAt: now, updatedAt: now }).run();
    db.insert(pipelineTasks).values({
      id: taskA, projectId: pidA, topic: 'Alice 的选题', currentStep: 'topic-verify',
      status: 'completed', steps: '[]', retryCount: 0, createdAt: now, updatedAt: now,
    }).run();

    const fake = {
      get: (id: string) => {
        const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
        if (!row) throw new NotFoundException('流水线任务不存在');
        return { ...row, steps: [] };
      },
      listByProject: (projectId: string) => [{ id: taskA, projectId }],
      listAll: () => [{ id: taskA, projectId: pidA }],
      create: (projectId: string, topic: string) => {
        createdWith = { projectId, topic };
        return { id: randomUUID(), projectId };
      },
      confirmOutline: () => ({ ok: true }),
      stop: () => ({ ok: true }),
      rerun: () => ({ ok: true }),
      remove: () => ({ ok: true }),
    } as unknown as PipelineService;

    controller = new PipelineController(fake, new ProjectAccessService());
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('非 owner 读他人流水线 → 404（不泄露任务存在性）', () => {
    expect(() => controller.get(taskA, { user: bob })).toThrow(NotFoundException);
  });

  it('owner 读自己的流水线 → 放行', () => {
    const row = controller.get(taskA, { user: alice });
    expect(row.id).toBe(taskA);
  });

  it('非 owner 对他人流水线 stop/rerun/confirm/delete → 全部 404', () => {
    const user = { user: bob };
    expect(() => controller.stop(taskA, user)).toThrow(NotFoundException);
    expect(() => controller.rerun(taskA, user)).toThrow(NotFoundException);
    expect(() => controller.confirmOutline(taskA, {}, user)).toThrow(NotFoundException);
    expect(() => controller.remove(taskA, user)).toThrow(NotFoundException);
  });

  it('非 owner 用他人项目起流水线 → 404，且不会真正创建', () => {
    expect(() => controller.create({ projectId: pidB, topic: '越权' }, { user: alice })).toThrow(NotFoundException);
    expect(createdWith).toBeNull();
  });

  it('owner 用自己项目起流水线 → 放行并透传参数', () => {
    controller.create({ projectId: pidA, topic: '合法选题' }, { user: alice });
    expect(createdWith).toEqual({ projectId: pidA, topic: '合法选题' });
  });

  it('不存在的 taskId → 404（而不是 500）', () => {
    expect(() => controller.get(randomUUID(), { user: alice })).toThrow(NotFoundException);
  });

  it('本地模式（AUTH_MODE=none）：零登录放行', () => {
    process.env.AUTH_MODE = 'none';
    expect(controller.get(taskA, {}).id).toBe(taskA);
  });

  it('列表：企业模式无 projectId → 拒绝；有 projectId 仅返回本项目的', () => {
    expect(() => controller.listByProject('', { user: alice })).toThrow(NotFoundException);
    expect(controller.listByProject(pidA, { user: alice })).toEqual([{ id: taskA, projectId: pidA }]);
    expect(() => controller.listByProject(pidB, { user: alice })).toThrow(NotFoundException);
  });

  it('列表：本地模式无 projectId 返回全量（CLI/回归依赖）', () => {
    process.env.AUTH_MODE = 'none';
    expect(controller.listByProject('', {})).toEqual([{ id: taskA, projectId: pidA }]);
  });
});
