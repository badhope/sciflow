import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import {
  documents,
  projects,
  references,
  experiments,
  extractionFields,
  knowledgeDocs,
  memoryLogs,
  submissions,
  researchDesigns,
  reviewComments,
  agentExecutions,
  qualityReports,
  agentTasks,
  toolApprovals,
  researchPrograms,
  researchCycles,
  researchQuestions,
  researchHypotheses,
  researchProtocols,
  researchClaims,
  researchEvidence,
  researchRuns,
} from '../db/schema';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 项目归属校验（防 IDOR）
 *
 * 背景（2026-10 安全审计）：`GET /api/documents/:id`、`PATCH /api/documents/:id`
 * 只按主键取数，不校验归属 —— 实测用 A 项目的文档 id 可直接读取/改写。
 * 本地单用户模式下这不构成跨用户越权（只有一个用户），但企业模式（AUTH_MODE=jwt）
 * 必然是多账号，必须按 owner 隔离。
 *
 * 策略：
 *  - AUTH_MODE != jwt：不做归属校验（保持本地/桌面零登录体验，行为与历史一致）
 *  - AUTH_MODE == jwt：项目必须属于当前用户；不属于时统一返回 404（不泄露「存在但无权」）
 *
 * v1.8 扩展：知识库 / 记忆 / 投稿 / 研究设计稿 / 审稿意见 / 执行轨迹 / 评分报告
 * 七类子资源补齐断言；并引入 `assertAdmin()` 供「全局配置」类端点使用
 * （配置是实例级的，不属于任何项目，按项目归属无法表达，必须按角色）。
 */
@Injectable()
export class ProjectAccessService {
  get enforced(): boolean {
    return (process.env.AUTH_MODE || 'none') === 'jwt';
  }

  /** 当前请求的用户 id（本地模式恒为空串） */
  ownerOf(user?: AuthPayload): string {
    return this.enforced ? String(user?.sub || '') : '';
  }

  /** 断言项目可访问，返回项目行 */
  assertProject(projectId: string, user?: AuthPayload) {
    if (!projectId) throw new NotFoundException('项目不存在');
    const row = db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!row) throw new NotFoundException('项目不存在');
    if (!this.enforced) return row;
    const owner = String((row as { ownerId?: string }).ownerId || '');
    const me = this.ownerOf(user);
    // 历史数据 owner_id 为空（本地模式创建）：企业模式下不允许任何非空用户认领，
    // 避免「先到先得」式越权；由管理员显式迁移归属。
    if (!owner || owner !== me) throw new NotFoundException('项目不存在');
    return row;
  }

  /**
   * 断言「实例级全局配置」可写：企业模式仅 admin。
   *
   * 为什么需要：设置页/配置中心/扩展中心/自定义项写的是**整台实例**的模型 Key、
   * 权限档、注入钩子、MCP 服务器——这些不是某个项目的资源，按项目归属无从表达。
   * 企业模式下若只要求登录，任一 member 都能把 baseURL 改成自己的服务器（窃取全部
   * 请求内容）或把权限档放开。本地模式保持零门槛。
   */
  assertAdmin(user?: AuthPayload) {
    if (!this.enforced) return;
    if (String(user?.role || '') !== 'admin') {
      throw new ForbiddenException('该操作会修改实例级全局配置，仅管理员可执行');
    }
  }

  /**
   * 当前用户可访问的项目 id 集合。
   * 本地模式返回 null（不限制，保持零登录体验）；企业模式返回 owner 匹配的项目。
   */
  accessibleProjectIds(user?: AuthPayload): string[] | null {
    if (!this.enforced) return null;
    const me = this.ownerOf(user);
    if (!me) return [];
    return db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.ownerId, me))
      .all()
      .map((r) => r.id);
  }

  /** 断言 Agent 任务可访问；无项目归属的全局任务企业模式仅 admin 可见 */
  assertAgentTask(taskId: string, user?: AuthPayload) {
    const row = db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).get();
    if (!row) throw new NotFoundException('任务不存在');
    if (row.projectId) this.assertProject(row.projectId, user);
    else if (this.enforced) this.assertAdmin(user);
    return row;
  }

  /** 断言工具审批可访问；无项目归属的全局审批企业模式仅 admin 可见 */
  assertToolApproval(approvalId: string, user?: AuthPayload) {
    const row = db.select().from(toolApprovals).where(eq(toolApprovals.id, approvalId)).get();
    if (!row) throw new NotFoundException('审批记录不存在');
    if (row.projectId) this.assertProject(row.projectId, user);
    else if (this.enforced) this.assertAdmin(user);
    return row;
  }

  /** 断言文档可访问（经由其 project 归属），返回文档行 */
  assertDocument(documentId: string, user?: AuthPayload) {
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) throw new NotFoundException('文档不存在');
    this.assertProject(doc.projectId, user);
    return doc;
  }

  /** 只读查询用的文档存在性检查（不抛错）：存在则校验归属，不存在返回 undefined。
   *  用于「按文档回流」类端点——文档不存在时返回空列表而非 404，存在但无权仍拒绝（防 IDOR）。 */
  findDocument(documentId: string, user?: AuthPayload) {
    if (!documentId) return undefined;
    const doc = db.select().from(documents).where(eq(documents.id, documentId)).get();
    if (!doc) return undefined;
    this.assertProject(doc.projectId, user);
    return doc;
  }

  /** 断言文献可访问（经由其 project 归属），返回文献行 */
  assertReference(referenceId: string, user?: AuthPayload) {
    const ref = db.select().from(references).where(eq(references.id, referenceId)).get();
    if (!ref) throw new NotFoundException('文献不存在');
    this.assertProject(ref.projectId, user);
    return ref;
  }

  /** 断言系统综述抽取字段可访问（经由其 project 归属） */
  assertExtractionField(fieldId: string, user?: AuthPayload) {
    const field = db.select().from(extractionFields).where(eq(extractionFields.id, fieldId)).get();
    if (!field) throw new NotFoundException('抽取字段不存在');
    this.assertProject(field.projectId, user);
    return field;
  }

  /** 断言实验可访问（经由其 project 归属），返回实验行 */
  assertExperiment(experimentId: string, user?: AuthPayload) {
    const exp = db.select().from(experiments).where(eq(experiments.id, experimentId)).get();
    if (!exp) throw new NotFoundException('实验不存在');
    this.assertProject(exp.projectId, user);
    return exp;
  }

  /** 断言知识库资料可访问（v1.8：此前 knowledge 全部端点零校验） */
  assertKnowledgeDoc(docId: string, user?: AuthPayload) {
    const row = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.id, docId)).get();
    if (!row) throw new NotFoundException('知识库资料不存在');
    this.assertProject(row.projectId, user);
    return row;
  }

  /** 断言记忆可访问；程序记忆可能无 projectId（全局写作风格），仅登录校验 */
  assertMemory(memoryId: string, user?: AuthPayload) {
    const row = db.select().from(memoryLogs).where(eq(memoryLogs.id, memoryId)).get();
    if (!row) throw new NotFoundException('记忆不存在');
    if (row.projectId) this.assertProject(row.projectId, user);
    else if (this.enforced && !user?.sub) throw new NotFoundException('记忆不存在');
    return row;
  }

  /** 断言投稿记录可访问（v1.8：此前投稿跟踪全部端点零校验） */
  assertSubmission(submissionId: string, user?: AuthPayload) {
    const row = db.select().from(submissions).where(eq(submissions.id, submissionId)).get();
    if (!row) throw new NotFoundException('投稿记录不存在');
    this.assertProject(row.projectId, user);
    return row;
  }

  /** 断言研究设计稿可访问 */
  assertResearchDesign(designId: string, user?: AuthPayload) {
    const row = db.select().from(researchDesigns).where(eq(researchDesigns.id, designId)).get();
    if (!row) throw new NotFoundException('实验设计稿不存在');
    this.assertProject(row.projectId, user);
    return row;
  }

  /** 断言自主科研项目可访问 */
  assertResearchProgram(programId: string, user?: AuthPayload) {
    const row = db.select().from(researchPrograms).where(eq(researchPrograms.id, programId)).get();
    if (!row) throw new NotFoundException('研究项目不存在');
    this.assertProject(row.projectId, user);
    return row;
  }

  /** 断言研究循环可访问（经由 program → project） */
  assertResearchCycle(cycleId: string, user?: AuthPayload) {
    const row = db.select().from(researchCycles).where(eq(researchCycles.id, cycleId)).get();
    if (!row) throw new NotFoundException('研究循环不存在');
    this.assertResearchProgram(row.programId, user);
    return row;
  }

  /** 断言研究问题可访问（经由 program → project） */
  assertResearchQuestion(questionId: string, user?: AuthPayload) {
    const row = db.select().from(researchQuestions).where(eq(researchQuestions.id, questionId)).get();
    if (!row) throw new NotFoundException('研究问题不存在');
    this.assertResearchProgram(row.programId, user);
    return row;
  }

  /** 断言研究假设可访问（经由 program → project） */
  assertResearchHypothesis(hypothesisId: string, user?: AuthPayload) {
    const row = db.select().from(researchHypotheses).where(eq(researchHypotheses.id, hypothesisId)).get();
    if (!row) throw new NotFoundException('研究假设不存在');
    this.assertResearchProgram(row.programId, user);
    return row;
  }

  /** 断言研究协议可访问（经由 program → project） */
  assertResearchProtocol(protocolId: string, user?: AuthPayload) {
    const row = db.select().from(researchProtocols).where(eq(researchProtocols.id, protocolId)).get();
    if (!row) throw new NotFoundException('研究协议不存在');
    this.assertResearchProgram(row.programId, user);
    return row;
  }

  /** 断言研究结论可访问（经由 program → project） */
  assertResearchClaim(claimId: string, user?: AuthPayload) {
    const row = db.select().from(researchClaims).where(eq(researchClaims.id, claimId)).get();
    if (!row) throw new NotFoundException('研究结论不存在');
    this.assertResearchProgram(row.programId, user);
    return row;
  }

  /** 断言证据可访问（经由 claim → program → project） */
  assertResearchEvidence(evidenceId: string, user?: AuthPayload) {
    const row = db.select().from(researchEvidence).where(eq(researchEvidence.id, evidenceId)).get();
    if (!row) throw new NotFoundException('研究证据不存在');
    this.assertResearchClaim(row.claimId, user);
    return row;
  }

  /** 断言研究运行可访问（经由 program → project） */
  assertResearchRun(runId: string, user?: AuthPayload) {
    const row = db.select().from(researchRuns).where(eq(researchRuns.id, runId)).get();
    if (!row) throw new NotFoundException('研究运行不存在');
    this.assertResearchProgram(row.programId, user);
    return row;
  }

  /** 断言审稿意见可访问（经由其 document → project 归属） */
  assertReviewComment(commentId: string, user?: AuthPayload) {
    const row = db.select().from(reviewComments).where(eq(reviewComments.id, commentId)).get();
    if (!row) throw new NotFoundException('审稿意见不存在');
    this.assertDocument(row.documentId, user);
    return row;
  }

  /** 断言执行轨迹可访问 */
  assertAgentExecution(runId: string, user?: AuthPayload) {
    const row = db.select().from(agentExecutions).where(eq(agentExecutions.id, runId)).get();
    if (!row) throw new NotFoundException('执行记录不存在');
    this.assertProject(row.projectId, user);
    return row;
  }

  /** 断言评分报告可访问（经由其 document → project 归属） */
  assertQualityReport(reportId: string, user?: AuthPayload) {
    const row = db.select().from(qualityReports).where(eq(qualityReports.id, reportId)).get();
    if (!row) throw new NotFoundException('评分报告不存在');
    this.assertDocument(row.documentId, user);
    return row;
  }

  /** 显式拒绝（用于业务上必须报 403 的场景） */
  deny(message = '无权访问该资源'): never {
    throw new ForbiddenException(message);
  }
}
