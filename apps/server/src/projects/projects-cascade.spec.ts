import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import {
  projects,
  documents,
  agentExecutions,
  agentSteps,
  chatSessions,
  memoryLogs,
  pipelineTasks,
  reflexionLogs,
  researchBriefs,
} from '../db/schema';
import { ProjectsService } from './projects.service';

/**
 * 项目删除级联完整性（真实 SQLite）
 *
 * 背景（2026-10-20 全模块审计）：数据库无外键（零 FK），级联删除全靠 service 手写。
 * 旧实现漏了 agent_execution / agent_step / chat_session 三张表 —— 删项目后
 * 执行轨迹与对话摘要成为孤儿行，用量看板/轨迹页仍能读到已删项目的数据。
 * 本 spec 用真实库验证「删项目后所有 project 维度表归零」，任何新增表漏挂都会红。
 */

const PID = 'test-cascade-proj';

function seed() {
  const now = Date.now();
  db.insert(projects).values({ id: PID, name: '级联测试项目', description: '', status: 'active', createdAt: now, updatedAt: now }).run();
  db.insert(documents).values({ id: 'doc-1', projectId: PID, title: '文档', content: '', status: 'draft', createdAt: now, updatedAt: now }).run();
  db.insert(pipelineTasks).values({ id: 'task-1', projectId: PID, topic: 't', status: 'completed', createdAt: now, updatedAt: now }).run();
  db.insert(reflexionLogs).values({ id: 'rf-1', taskId: 'task-1', round: 1, note: '总分 78/100', instructions: '[]', createdAt: now }).run();
  db.insert(agentExecutions).values({ id: 'run-1', projectId: PID, source: 'pipeline', input: 't', status: 'done', createdAt: now }).run();
  db.insert(agentSteps).values({ id: 'step-1', runId: 'run-1', seq: 1, kind: 'tool', title: 'literature', status: 'ok', createdAt: now }).run();
  db.insert(chatSessions).values({ id: 'cs-1', projectId: PID, summary: '摘要', messageCount: 4, totalTokens: 100, createdAt: now, updatedAt: now }).run();
  db.insert(memoryLogs).values({ id: 'mem-1', projectId: PID, type: 'episodic', content: '记忆', createdAt: now }).run();
  db.insert(researchBriefs).values({ projectId: PID, question: '级联测试问题', updatedAt: now }).run();
}

function counts() {
  return {
    projects: db.select().from(projects).where(eq(projects.id, PID)).all().length,
    documents: db.select().from(documents).where(eq(documents.projectId, PID)).all().length,
    pipelineTasks: db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, PID)).all().length,
    reflexionLogs: db.select().from(reflexionLogs).where(eq(reflexionLogs.taskId, 'task-1')).all().length,
    agentExecutions: db.select().from(agentExecutions).where(eq(agentExecutions.projectId, PID)).all().length,
    agentSteps: db.select().from(agentSteps).where(eq(agentSteps.runId, 'run-1')).all().length,
    chatSessions: db.select().from(chatSessions).where(eq(chatSessions.projectId, PID)).all().length,
    memoryLogs: db.select().from(memoryLogs).where(eq(memoryLogs.projectId, PID)).all().length,
    researchBriefs: db.select().from(researchBriefs).where(eq(researchBriefs.projectId, PID)).all().length,
  };
}

describe('ProjectsService.remove 级联删除完整性', () => {
  const svc = new ProjectsService();

  beforeEach(() => {
    // 清掉上次残留（按依赖顺序）
    db.delete(agentSteps).where(eq(agentSteps.runId, 'run-1')).run();
    db.delete(agentExecutions).where(eq(agentExecutions.projectId, PID)).run();
    db.delete(chatSessions).where(eq(chatSessions.projectId, PID)).run();
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
    db.delete(researchBriefs).where(eq(researchBriefs.projectId, PID)).run();
    db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, 'task-1')).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, PID)).run();
    db.delete(documents).where(eq(documents.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
    seed();
  });

  afterEach(() => {
    db.delete(agentSteps).where(eq(agentSteps.runId, 'run-1')).run();
    db.delete(agentExecutions).where(eq(agentExecutions.projectId, PID)).run();
    db.delete(chatSessions).where(eq(chatSessions.projectId, PID)).run();
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
    db.delete(researchBriefs).where(eq(researchBriefs.projectId, PID)).run();
    db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, 'task-1')).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, PID)).run();
    db.delete(documents).where(eq(documents.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('删除前种子数据齐全（防止测试空跑）', () => {
    const c = counts();
    expect(c).toEqual({
      projects: 1,
      documents: 1,
      pipelineTasks: 1,
      reflexionLogs: 1,
      agentExecutions: 1,
      agentSteps: 1,
      chatSessions: 1,
      memoryLogs: 1,
      researchBriefs: 1,
    });
  });

  it('删除项目后所有 project 维度表都归零（含 agent 轨迹与对话会话）', () => {
    svc.remove(PID);
    expect(counts()).toEqual({
      projects: 0,
      documents: 0,
      pipelineTasks: 0,
      reflexionLogs: 0,
      agentExecutions: 0,
      agentSteps: 0,
      chatSessions: 0,
      memoryLogs: 0,
      researchBriefs: 0,
    });
  });
});
