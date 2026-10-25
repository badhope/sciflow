import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { documents, projects, references, experiments, extractionFields } from '../db/schema';
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

  /** 显式拒绝（用于业务上必须报 403 的场景） */
  deny(message = '无权访问该资源'): never {
    throw new ForbiddenException(message);
  }
}
