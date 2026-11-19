import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import {
  projects, documents, references, citations, qualityReports, polishRecords, reviewComments,
  pipelineTasks, reflexionLogs, agentExecutions, agentSteps, agentTasks, toolApprovals,
  agentPlans, llmCallLogs, chatSessions, memoryLogs,
  knowledgeDocs, knowledgeChunks, screeningQueue, extractionFields, extractionValues,
  submissions, submissionStatusEvents, experiments,
} from '../db/schema';
import { ProjectsService } from './projects.service';

/**
 * 项目删除级联完整性 · 全表版
 *
 * 旧版只 seed 8 张表，`references` / `knowledge_*` / `submissions` / `quality_report` /
 * `review_comment` / `polish_record` / `screening_queue` / `extraction_*` 都没覆盖，
 * 因此删掉级联代码后测试仍绿（独立审计突变验证实测未捕获）。
 * 本版把「所有带 project_id 或经文档/任务/字段二级关联」的表全部 seed 并断言归零。
 *
 * 契约：新增 project 维度表时必须在此登记，否则该测试无法发现孤儿行。
 */

const PID = 'test-cascade-full';
const NOW = 1_700_000_000_000;

function seed() {
  db.insert(projects).values({ id: PID, name: '全表级联项目', description: '', status: 'active', createdAt: NOW, updatedAt: NOW }).run();

  db.insert(documents).values({ id: 'doc-full-1', projectId: PID, title: '文档', content: '', status: 'draft', createdAt: NOW, updatedAt: NOW }).run();

  db.insert(references).values({
    id: 'ref-full-1', projectId: PID, title: '文献', authors: '[]', year: 2024, venue: '',
    doi: '', url: '', abstract: '', source: 'manual', tags: '[]', citationCount: 0,
    readingStatus: 'unread', fingerprint: 'fp-full-1', isDuplicateOf: '', notes: '', createdAt: NOW,
  }).run();

  db.insert(citations).values({ id: 'cit-full-1', documentId: 'doc-full-1', referenceId: 'ref-full-1', location: 'L', context: 'C', format: 'pipeline', verified: 0, createdAt: NOW }).run();
  db.insert(qualityReports).values({ id: 'qr-full-1', documentId: 'doc-full-1', totalScore: 77, scores: '{}', feedback: '', createdAt: NOW }).run();
  db.insert(polishRecords).values({ id: 'pr-full-1', documentId: 'doc-full-1', type: 'polish', original: 'o', polished: 'p', reason: '', createdAt: NOW }).run();
  db.insert(reviewComments).values({ id: 'rc-full-1', documentId: 'doc-full-1', reviewer: 'R1', commentText: '意见', category: 'logic', status: 'open', createdAt: NOW, updatedAt: NOW }).run();

  db.insert(pipelineTasks).values({ id: 'task-full-1', projectId: PID, topic: 't', status: 'completed', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(reflexionLogs).values({ id: 'rf-full-1', taskId: 'task-full-1', round: 1, note: '78', instructions: '[]', createdAt: NOW }).run();

  db.insert(agentExecutions).values({ id: 'run-full-1', projectId: PID, source: 'pipeline', input: 't', status: 'done', createdAt: NOW }).run();
  db.insert(agentSteps).values({ id: 'step-full-1', runId: 'run-full-1', seq: 1, kind: 'tool', title: 'lit', status: 'ok', createdAt: NOW }).run();
  db.insert(agentTasks).values({ id: 'at-full-1', projectId: PID, content: '任务', status: 'pending', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(toolApprovals).values({ id: 'ta-full-1', projectId: PID, toolName: 'document.update', status: 'pending', createdAt: NOW }).run();
  db.insert(agentPlans).values({ id: 'ap-full-1', projectId: PID, title: '计划', status: 'pending', createdAt: NOW }).run();
  db.insert(llmCallLogs).values({ id: 'll-full-1', projectId: PID, caller: 'chat', kind: 'llm', totalTokens: 12, createdAt: NOW }).run();

  db.insert(chatSessions).values({ id: 'cs-full-1', projectId: PID, summary: 's', messageCount: 2, totalTokens: 9, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(memoryLogs).values({ id: 'mem-full-1', projectId: PID, type: 'episodic', content: 'm', createdAt: NOW }).run();

  db.insert(knowledgeDocs).values({ id: 'kd-full-1', projectId: PID, name: '资料', type: 'text', chunkCount: 1, referenceId: 'ref-full-1', createdAt: NOW }).run();
  db.insert(knowledgeChunks).values({ id: 'kc-full-1', docId: 'kd-full-1', seq: 0, content: 'chunk', context: '', vector: '[]', createdAt: NOW }).run();

  db.insert(screeningQueue).values({ id: 'sq-full-1', projectId: PID, referenceId: 'ref-full-1', status: 'pending', reason: '', reviewer: 'me', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(extractionFields).values({ id: 'ef-full-1', projectId: PID, key: 'sample_size', label: '样本量', kind: 'text', options: '[]', createdAt: NOW }).run();
  db.insert(extractionValues).values({ id: 'ev-full-1', fieldId: 'ef-full-1', referenceId: 'ref-full-1', value: '100', createdAt: NOW, updatedAt: NOW }).run();

  db.insert(submissions).values({
    id: 'sub-full-1', projectId: PID, journalName: 'J', documentId: 'doc-full-1',
    submittedAt: NOW, currentStatus: 'submitted', createdAt: NOW, updatedAt: NOW,
  }).run();
  db.insert(submissionStatusEvents).values({ id: 'sse-full-1', submissionId: 'sub-full-1', fromStatus: '', toStatus: 'submitted', eventAt: NOW, source: 'manual', confidence: 1, createdAt: NOW }).run();

  db.insert(experiments).values({ id: 'exp-full-1', projectId: PID, goal: 'g', code: 'print(1)', stdout: '', stderr: '', status: 'ok', createdAt: NOW, updatedAt: NOW }).run();
}

function counts() {
  return {
    projects: db.select().from(projects).where(eq(projects.id, PID)).all().length,
    documents: db.select().from(documents).where(eq(documents.projectId, PID)).all().length,
    references: db.select().from(references).where(eq(references.projectId, PID)).all().length,
    citations: db.select().from(citations).where(eq(citations.documentId, 'doc-full-1')).all().length,
    qualityReports: db.select().from(qualityReports).where(eq(qualityReports.documentId, 'doc-full-1')).all().length,
    polishRecords: db.select().from(polishRecords).where(eq(polishRecords.documentId, 'doc-full-1')).all().length,
    reviewComments: db.select().from(reviewComments).where(eq(reviewComments.documentId, 'doc-full-1')).all().length,
    pipelineTasks: db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, PID)).all().length,
    reflexionLogs: db.select().from(reflexionLogs).where(eq(reflexionLogs.taskId, 'task-full-1')).all().length,
    agentExecutions: db.select().from(agentExecutions).where(eq(agentExecutions.projectId, PID)).all().length,
    agentSteps: db.select().from(agentSteps).where(eq(agentSteps.runId, 'run-full-1')).all().length,
    agentTasks: db.select().from(agentTasks).where(eq(agentTasks.projectId, PID)).all().length,
    toolApprovals: db.select().from(toolApprovals).where(eq(toolApprovals.projectId, PID)).all().length,
    agentPlans: db.select().from(agentPlans).where(eq(agentPlans.projectId, PID)).all().length,
    llmCallLogs: db.select().from(llmCallLogs).where(eq(llmCallLogs.projectId, PID)).all().length,
    chatSessions: db.select().from(chatSessions).where(eq(chatSessions.projectId, PID)).all().length,
    memoryLogs: db.select().from(memoryLogs).where(eq(memoryLogs.projectId, PID)).all().length,
    knowledgeDocs: db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, PID)).all().length,
    knowledgeChunks: db.select().from(knowledgeChunks).where(eq(knowledgeChunks.docId, 'kd-full-1')).all().length,
    screeningQueue: db.select().from(screeningQueue).where(eq(screeningQueue.projectId, PID)).all().length,
    extractionFields: db.select().from(extractionFields).where(eq(extractionFields.projectId, PID)).all().length,
    extractionValues: db.select().from(extractionValues).where(eq(extractionValues.fieldId, 'ef-full-1')).all().length,
    submissions: db.select().from(submissions).where(eq(submissions.projectId, PID)).all().length,
    submissionStatusEvents: db.select().from(submissionStatusEvents).where(eq(submissionStatusEvents.submissionId, 'sub-full-1')).all().length,
    experiments: db.select().from(experiments).where(eq(experiments.projectId, PID)).all().length,
  };
}

const ZERO = Object.fromEntries(Object.keys({
  projects: 0, documents: 0, references: 0, citations: 0, qualityReports: 0, polishRecords: 0,
  reviewComments: 0, pipelineTasks: 0, reflexionLogs: 0, agentExecutions: 0, agentSteps: 0,
  agentTasks: 0, toolApprovals: 0, agentPlans: 0, llmCallLogs: 0,
  chatSessions: 0, memoryLogs: 0, knowledgeDocs: 0, knowledgeChunks: 0, screeningQueue: 0,
  extractionFields: 0, extractionValues: 0, submissions: 0, submissionStatusEvents: 0, experiments: 0,
}).map((k) => [k, 0]));

function cleanup() {
  // 按依赖顺序清理（测试自身幂等）
  db.delete(extractionValues).where(eq(extractionValues.fieldId, 'ef-full-1')).run();
  db.delete(extractionFields).where(eq(extractionFields.projectId, PID)).run();
  db.delete(screeningQueue).where(eq(screeningQueue.projectId, PID)).run();
  db.delete(submissionStatusEvents).where(eq(submissionStatusEvents.submissionId, 'sub-full-1')).run();
  db.delete(submissions).where(eq(submissions.projectId, PID)).run();
  db.delete(experiments).where(eq(experiments.projectId, PID)).run();
  db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, 'kd-full-1')).run();
  db.delete(knowledgeDocs).where(eq(knowledgeDocs.projectId, PID)).run();
  db.delete(reviewComments).where(eq(reviewComments.documentId, 'doc-full-1')).run();
  db.delete(polishRecords).where(eq(polishRecords.documentId, 'doc-full-1')).run();
  db.delete(qualityReports).where(eq(qualityReports.documentId, 'doc-full-1')).run();
  db.delete(citations).where(eq(citations.documentId, 'doc-full-1')).run();
  db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, 'task-full-1')).run();
  db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, PID)).run();
  db.delete(agentSteps).where(eq(agentSteps.runId, 'run-full-1')).run();
  db.delete(agentExecutions).where(eq(agentExecutions.projectId, PID)).run();
  db.delete(agentTasks).where(eq(agentTasks.projectId, PID)).run();
  db.delete(toolApprovals).where(eq(toolApprovals.projectId, PID)).run();
  db.delete(agentPlans).where(eq(agentPlans.projectId, PID)).run();
  db.delete(llmCallLogs).where(eq(llmCallLogs.projectId, PID)).run();
  db.delete(chatSessions).where(eq(chatSessions.projectId, PID)).run();
  db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
  db.delete(references).where(eq(references.projectId, PID)).run();
  db.delete(documents).where(eq(documents.projectId, PID)).run();
  db.delete(projects).where(eq(projects.id, PID)).run();
}

describe('ProjectsService.remove 级联删除（全表 25 张）', () => {
  const svc = new ProjectsService();

  beforeEach(() => {
    cleanup();
    seed();
  });

  afterEach(() => {
    cleanup();
  });

  it('删除前 25 张表种子数据齐全（防测试空跑）', () => {
    const c = counts();
    for (const [k, v] of Object.entries(c)) expect(v, `${k} 未 seed`).toBe(1);
  });

  it('删除项目后所有表归零（含 references / knowledge / submissions / agent_plan / tool_approval）', () => {
    svc.remove(PID);
    expect(counts()).toEqual(ZERO);
  });

  it('不存在的项目删除时抛 404 且不误删其他数据', () => {
    expect(() => svc.remove('non-exist-project')).toThrow();
    expect(counts().documents).toBe(1);
  });
});
