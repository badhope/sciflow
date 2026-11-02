import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import {
  projects,
  documents,
  knowledgeDocs,
  memoryLogs,
  submissions,
  researchDesigns,
  reviewComments,
  agentExecutions,
  qualityReports,
} from '../db/schema';
import { ProjectAccessService } from '../common/project-access.service';

/**
 * 企业模式子资源归属校验（v1.8 扩展）。
 *
 * 背景：v1.7 只补了 pipeline 控制器。本轮静态扫描发现仍有 8 个控制器零校验
 * （knowledge / memory / research / quality / submission / agent-trace /
 * dashboard / chat），另有 objectiveAudit 单个端点漏在 citation-audit 之外。
 * 本测试直接驱动 ProjectAccessService 的新增断言，锁定「非 owner → 404、
 * owner → 放行、本地模式 → 全放行」三条语义。
 */
const OLD_AUTH_MODE = process.env.AUTH_MODE;
const alice = { sub: 'user-alice', email: 'alice@test.local', role: 'user' as const };
const bob = { sub: 'user-bob', email: 'bob@test.local', role: 'user' as const };
const boss = { sub: 'user-boss', email: 'boss@test.local', role: 'admin' as const };

describe('ProjectAccessService 子资源归属（v1.8）', () => {
  let pidA: string;
  let pidB: string;
  let docA: string;
  let knA: string;
  let memA: string;
  let memGlobal: string;
  let subA: string;
  let designA: string;
  let commentA: string;
  let runA: string;
  let reportA: string;

  beforeEach(() => {
    process.env.AUTH_MODE = 'jwt';
    const now = Date.now();
    pidA = randomUUID();
    pidB = randomUUID();
    docA = randomUUID();
    knA = randomUUID();
    memA = randomUUID();
    memGlobal = randomUUID();
    subA = randomUUID();
    designA = randomUUID();
    commentA = randomUUID();
    runA = randomUUID();
    reportA = randomUUID();

    db.insert(projects).values({ id: pidA, name: 'Alice 项目', description: '', ownerId: 'user-alice', createdAt: now, updatedAt: now }).run();
    db.insert(projects).values({ id: pidB, name: 'Bob 项目', description: '', ownerId: 'user-bob', createdAt: now, updatedAt: now }).run();
    db.insert(documents).values({ id: docA, projectId: pidA, title: 'Alice 的稿', content: '正文', outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now }).run();
    db.insert(knowledgeDocs).values({ id: knA, projectId: pidA, name: '资料.md', type: 'markdown', chunkCount: 1, createdAt: now }).run();
    db.insert(memoryLogs).values({ id: memA, type: 'episodic', projectId: pidA, content: 'Alice 的研究结论', keywords: '[]', createdAt: now }).run();
    db.insert(memoryLogs).values({ id: memGlobal, type: 'procedural', projectId: null, content: '全局写作风格', keywords: '[]', createdAt: now }).run();
    db.insert(submissions).values({ id: subA, projectId: pidA, journalName: '计算机学报', currentStatus: 'submitted', createdAt: now, updatedAt: now }).run();
    db.insert(researchDesigns).values({ id: designA, projectId: pidA, question: '设计问题', design: '{}', createdAt: now }).run();
    db.insert(reviewComments).values({ id: commentA, documentId: docA, reviewer: 'R1', commentText: '意见', status: 'open', createdAt: now, updatedAt: now }).run();
    db.insert(agentExecutions).values({ id: runA, projectId: pidA, source: 'pipeline', input: '主题', status: 'done', createdAt: now }).run();
    db.insert(qualityReports).values({ id: reportA, documentId: docA, totalScore: 80, scores: '{}', feedback: 'ok', createdAt: now }).run();
  });

  afterEach(() => {
    if (OLD_AUTH_MODE === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = OLD_AUTH_MODE;
  });

  it('知识库资料：非 owner 404，owner 放行', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertKnowledgeDoc(knA, bob)).toThrow(NotFoundException);
    expect(svc.assertKnowledgeDoc(knA, alice).id).toBe(knA);
  });

  it('记忆：项目记忆非 owner 404；全局程序记忆企业模式需登录', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertMemory(memA, bob)).toThrow(NotFoundException);
    expect(svc.assertMemory(memA, alice).id).toBe(memA);
    expect(() => svc.assertMemory(memGlobal, undefined)).toThrow(NotFoundException);
    expect(svc.assertMemory(memGlobal, bob).id).toBe(memGlobal);
  });

  it('投稿记录：非 owner 404，owner 放行', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertSubmission(subA, bob)).toThrow(NotFoundException);
    expect(svc.assertSubmission(subA, alice).id).toBe(subA);
  });

  it('研究设计稿：非 owner 404，owner 放行', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertResearchDesign(designA, bob)).toThrow(NotFoundException);
    expect(svc.assertResearchDesign(designA, alice).id).toBe(designA);
  });

  it('审稿意见：经 document → project 断言（非 owner 404）', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertReviewComment(commentA, bob)).toThrow(NotFoundException);
    expect(svc.assertReviewComment(commentA, alice).id).toBe(commentA);
  });

  it('执行轨迹：非 owner 404，owner 放行', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertAgentExecution(runA, bob)).toThrow(NotFoundException);
    expect(svc.assertAgentExecution(runA, alice).id).toBe(runA);
  });

  it('评分报告：经 document → project 断言（非 owner 404）', () => {
    const svc = new ProjectAccessService();
    expect(() => svc.assertQualityReport(reportA, bob)).toThrow(NotFoundException);
    expect(svc.assertQualityReport(reportA, alice).id).toBe(reportA);
  });

  it('不存在的 id 一律 404（不泄露存在性）', () => {
    const svc = new ProjectAccessService();
    const ghost = randomUUID();
    expect(() => svc.assertKnowledgeDoc(ghost, alice)).toThrow(NotFoundException);
    expect(() => svc.assertSubmission(ghost, alice)).toThrow(NotFoundException);
    expect(() => svc.assertAgentExecution(ghost, alice)).toThrow(NotFoundException);
    expect(() => svc.assertQualityReport(ghost, alice)).toThrow(NotFoundException);
  });

  it('assertAdmin：本地模式放行任何身份；企业模式仅 admin', () => {
    const svc = new ProjectAccessService();
    process.env.AUTH_MODE = 'none';
    expect(svc.assertAdmin(undefined)).toBeUndefined();
    expect(svc.assertAdmin(alice)).toBeUndefined();
    process.env.AUTH_MODE = 'jwt';
    expect(svc.assertAdmin(boss)).toBeUndefined();
    expect(() => svc.assertAdmin(alice)).toThrow(/仅管理员/);
    expect(() => svc.assertAdmin(undefined)).toThrow(/仅管理员/);
  });

  it('本地模式（AUTH_MODE=none）：子资源全部放行，零登录体验不变', () => {
    process.env.AUTH_MODE = 'none';
    const svc = new ProjectAccessService();
    expect(svc.enforced).toBe(false);
    expect(svc.assertKnowledgeDoc(knA, undefined).id).toBe(knA);
    expect(svc.assertSubmission(subA, undefined).id).toBe(subA);
    expect(svc.assertAgentExecution(runA, undefined).id).toBe(runA);
    expect(svc.assertQualityReport(reportA, undefined).id).toBe(reportA);
    expect(svc.assertMemory(memA, undefined).id).toBe(memA);
  });
});
