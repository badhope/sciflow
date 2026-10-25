import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects, references, experiments } from '../db/schema';
import { ProjectAccessService } from './project-access.service';

/**
 * 企业模式归属校验（IDOR 防线）回归
 *
 * 背景（2026-10-25 修复）：此前归属校验只覆盖 documents 的读写核心端点与 projects 的
 * get/list/create；projects PATCH/DELETE、documents 操作类端点、references 全部端点、
 * experiments 全部端点均可跨用户越权（企业模式 AUTH_MODE=jwt 下）。
 *
 * 本测试直接驱动 ProjectAccessService（controller 层统一复用），在 jwt 模式下断言：
 *  - 非 owner 访问他人项目/文档/文献/实验 → 404（不泄露存在性）
 *  - owner 访问自己的资源 → 放行
 *  - 本地模式（AUTH_MODE=none）→ 全部放行（零登录体验不变）
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;

describe('ProjectAccessService 企业模式 IDOR 防线', () => {
  const alice = { sub: 'user-alice', email: 'alice@test.local', role: 'user' as const };
  const bob = { sub: 'user-bob', email: 'bob@test.local', role: 'user' as const };
  let pidA: string;
  let pidB: string;
  let refA: string;
  let expA: string;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const svc = new ProjectAccessService();
    expect(svc.enforced).toBe(true);

    pidA = randomUUID();
    pidB = randomUUID();
    refA = randomUUID();
    expA = randomUUID();
    db.insert(projects).values({ id: pidA, name: 'Alice 的项目', description: '', ownerId: 'user-alice', createdAt: Date.now(), updatedAt: Date.now() }).run();
    db.insert(projects).values({ id: pidB, name: 'Bob 的项目', description: '', ownerId: 'user-bob', createdAt: Date.now(), updatedAt: Date.now() }).run();
    db.insert(references).values({
      id: refA, projectId: pidA, title: 'Alice 的文献', authors: 'A', year: 2024,
      venue: '', doi: '', abstract: '', fingerprint: '', source: 'manual', readingStatus: 'unread', createdAt: Date.now(),
    }).run();
    db.insert(experiments).values({
      id: expA, projectId: pidA, goal: 'Alice 的实验', code: "print('a')",
      status: 'ok', stdout: '', createdAt: Date.now(), updatedAt: Date.now(),
    }).run();
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('jwt 模式：非 owner 访问他人项目返回 404（不泄露存在性）', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertProject(pidA, bob)).toThrow(NotFoundException);
    expect(() => svc.assertProject(pidB, alice)).toThrow(NotFoundException);
  });

  it('jwt 模式：owner 访问自己的项目放行', () => {
    const svc = new ProjectAccessService();
    expect(svc.assertProject(pidA, alice).id).toBe(pidA);
    expect(svc.assertProject(pidB, bob).id).toBe(pidB);
  });

  it('jwt 模式：未登录（无 user）不能访问任何项目', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertProject(pidA, undefined)).toThrow(NotFoundException);
  });

  it('jwt 模式：非 owner 经文献/实验关联项目被 404', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertReference(refA, bob)).toThrow(NotFoundException);
    expect(() => svc.assertExperiment(expA, bob)).toThrow(NotFoundException);
  });

  it('jwt 模式：owner 经文献/实验关联放行', () => {
    const svc = new ProjectAccessService();
    expect(svc.assertReference(refA, alice).id).toBe(refA);
    expect(svc.assertExperiment(expA, alice).id).toBe(expA);
  });

  it('本地模式（AUTH_MODE=none）：全部放行，零登录体验不变', () => {
    process.env.AUTH_MODE = 'none';
    const svc = new ProjectAccessService();
    expect(svc.enforced).toBe(false);
    expect(svc.assertProject(pidA, undefined).id).toBe(pidA);
    expect(svc.assertReference(refA, undefined).id).toBe(refA);
    expect(svc.assertExperiment(expA, undefined).id).toBe(expA);
  });

  it('deny 显式 403', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.deny()).toThrow(ForbiddenException);
  });
});
