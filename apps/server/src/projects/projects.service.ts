import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, sqlite } from '../db/database';
import { projects, documents, references, pipelineTasks, reflexionLogs, screeningQueue, extractionFields, extractionValues, reviewComments, experiments, submissions, submissionStatusEvents, citations, qualityReports, polishRecords, knowledgeDocs, knowledgeChunks, memoryLogs, agentExecutions, agentSteps, chatSessions } from '../db/schema';
import { parseJson } from '../common/json-guard';
import { BUNDLE_TABLES, BUNDLE_VERSION, buildIdMap, remapRow, renameOnImport, validateBundle } from './project-bundle';

/** Zod schemas for projects input validation */
const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional().default(''),
});

const updateProjectSchema = z.object({
  id: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    preface: z.string().max(10000).optional(),
    templates: z.string().max(100000).optional(),
  }),
});

@Injectable()
export class ProjectsService {
  list(ownerId = '') {
    // ownerId 为空 = 本地/桌面模式：返回全部（历史行为）
    // 非空 = 企业模式：只返回归属该用户的（含历史 owner_id 为空的公共项目？不给：
    // 企业模式下未归属的项目一律不可见，避免跨用户数据泄露）
    if (!ownerId) return db.select().from(projects).orderBy(projects.updatedAt).all();
    return db.select().from(projects).where(eq(projects.ownerId, ownerId)).orderBy(projects.updatedAt).all();
  }

  get(id: string) {
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new NotFoundException('项目不存在');
    return row;
  }

  create(input: { name: string; description?: string }, ownerId = '') {
    const validated = createProjectSchema.parse(input);
    const now = Date.now();
    const row = {
      id: randomUUID(),
      name: validated.name.trim(),
      description: validated.description || '',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      // 企业模式：记录归属；本地模式为空串（公共项目）
      ownerId,
    };
    db.insert(projects).values(row).run();
    return row;
  }

  update(id: string, patch: { name?: string; description?: string; preface?: string; templates?: string }) {
    const validated = updateProjectSchema.parse({ id, patch });
    this.get(validated.id);
    // preface（项目级系统提示，差距 #22）只接受字符串，其余字段维持既有透传行为
    if (validated.patch.preface !== undefined && typeof validated.patch.preface !== 'string') {
      throw new BadRequestException('preface 必须为字符串');
    }
    // 差距 #1：templates 只接受合法 JSON 数组字符串（[{name,description,sections:[{title,points}]}]）
    if (validated.patch.templates !== undefined) {
      if (typeof validated.patch.templates !== 'string') throw new BadRequestException('templates 必须是 JSON 字符串');
      const parsed = parseJson<unknown>(validated.patch.templates, null);
      if (!parsed || !Array.isArray(parsed)) throw new BadRequestException('templates 必须是合法 JSON 数组');
    }
    const clean: Record<string, unknown> = { ...validated.patch, updatedAt: Date.now() };
    db.update(projects).set(clean).where(eq(projects.id, validated.id)).run();
    return this.get(validated.id);
  }

  remove(id: string) {
    this.get(id);
    // 先捕获本项目文档 id（review_comment 按 document_id 关联，删文档前需级联清理）
    const docIds = db.select().from(documents).where(eq(documents.projectId, id)).all().map((d) => d.id);
    // 捕获本项目抽取字段 id（extraction_value 按 field_id 关联，删字段前需级联清理取值）
    const fieldIds = db.select().from(extractionFields).where(eq(extractionFields.projectId, id)).all().map((f) => f.id);
    // 级联清理：文档、文献、流水线任务及其反思日志
    const tasks = db.select().from(pipelineTasks).where(eq(pipelineTasks.projectId, id)).all();
    for (const t of tasks) {
      db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, t.id)).run();
    }
    // 科研高级功能级联清理：审稿意见（按文档）、筛选队列（按项目）、抽取取值与字段（按项目）
    for (const docId of docIds) {
      db.delete(reviewComments).where(eq(reviewComments.documentId, docId)).run();
      db.delete(citations).where(eq(citations.documentId, docId)).run();
      db.delete(qualityReports).where(eq(qualityReports.documentId, docId)).run();
      db.delete(polishRecords).where(eq(polishRecords.documentId, docId)).run();
    }
    db.delete(screeningQueue).where(eq(screeningQueue.projectId, id)).run();
    for (const fieldId of fieldIds) {
      db.delete(extractionValues).where(eq(extractionValues.fieldId, fieldId)).run();
    }
    db.delete(extractionFields).where(eq(extractionFields.projectId, id)).run();
    // 知识库级联清理：分块先于文档
    const kdIds = db.select().from(knowledgeDocs).where(eq(knowledgeDocs.projectId, id)).all().map((k) => k.id);
    for (const kdId of kdIds) {
      db.delete(knowledgeChunks).where(eq(knowledgeChunks.docId, kdId)).run();
    }
    db.delete(knowledgeDocs).where(eq(knowledgeDocs.projectId, id)).run();
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, id)).run();
    // 投稿跟踪级联清理：状态流水先于投稿记录删除
    const subIds = db.select().from(submissions).where(eq(submissions.projectId, id)).all().map((s) => s.id);
    for (const sid of subIds) {
      db.delete(submissionStatusEvents).where(eq(submissionStatusEvents.submissionId, sid)).run();
    }
    db.delete(submissions).where(eq(submissions.projectId, id)).run();
    // Agent 轨迹级联：步骤先于执行记录（step 只带 run_id，必须先收集 run id）
    const runIds = db.select().from(agentExecutions).where(eq(agentExecutions.projectId, id)).all().map((r) => r.id);
    for (const runId of runIds) {
      db.delete(agentSteps).where(eq(agentSteps.runId, runId)).run();
    }
    db.delete(agentExecutions).where(eq(agentExecutions.projectId, id)).run();
    // 对话会话摘要级联（chat_session 按 project_id 关联；消息体在摘要字段内，无独立表）
    db.delete(chatSessions).where(eq(chatSessions.projectId, id)).run();
    db.delete(documents).where(eq(documents.projectId, id)).run();
    db.delete(references).where(eq(references.projectId, id)).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, id)).run();
    db.delete(experiments).where(eq(experiments.projectId, id)).run();
    db.delete(projects).where(eq(projects.id, id)).run();
    return { ok: true };
  }

  /**
   * 项目全量导出：把项目及其全部子表行打包成一个自包含 JSON。
   * includeRuntime=true 时附带流水线任务/反思日志/Agent 轨迹（归档或调试用）。
   */
  exportBundle(projectId: string, includeRuntime = false) {
    const project = this.get(projectId);
    const tables: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};
    for (const spec of BUNDLE_TABLES) {
      if (!spec.defaultInclude && !includeRuntime) continue;
      try {
        const rows = sqlite
          .prepare(`SELECT * FROM ${spec.table} WHERE ${spec.projectColumn} = ?`)
          .all(projectId) as Record<string, unknown>[];
        // snake_case → camelCase，使导出包与 API 形状一致（导入端按 camelCase 读取）
        const mapped = rows.map((r) => toCamelRow(r, spec.dropFields));
        tables[spec.key] = mapped;
        counts[spec.key] = mapped.length;
      } catch {
        // 表不存在（旧库/未迁移）：跳过而不是让整个导出失败
        tables[spec.key] = [];
        counts[spec.key] = 0;
      }
    }
    return {
      bundleVersion: BUNDLE_VERSION,
      exportedAt: Date.now(),
      project: toCamelRow(project as unknown as Record<string, unknown>),
      tables,
      counts,
    };
  }

  /**
   * 项目导入：为整个包生成新 id（避免撞主键），重映射所有外键后写入。
   * 返回新项目 id 与各表导入行数；同名项目自动改名为「（导入）」。
   */
  importBundle(raw: unknown, ownerId = '') {
    const checked = validateBundle(raw);
    if (!checked.ok) throw new BadRequestException(checked.reason);
    const bundle = checked.bundle;
    const existingNames = (db.select({ name: projects.name }).from(projects).all() as { name: string }[]).map((r) => r.name);
    const idMap = buildIdMap(bundle, () => randomUUID());
    const newProjectId = idMap.get(String(bundle.project.id));
    if (!newProjectId) throw new BadRequestException('项目包缺少项目 id');

    const name = renameOnImport(String(bundle.project.name || ''), existingNames);
    const now = Date.now();
    const projectRow = remapRow(bundle.project, idMap, {
      id: newProjectId,
      name,
      createdAt: now,
      updatedAt: now,
      ownerId,
    });

    const stats: Record<string, number> = {};
    db.transaction(() => {
      db.insert(projects).values(projectRow as never).run();
      for (const spec of BUNDLE_TABLES) {
        const rows = bundle.tables[spec.key];
        if (!Array.isArray(rows) || rows.length === 0) {
          stats[spec.key] = 0;
          continue;
        }
        let inserted = 0;
        for (const row of rows) {
          const mapped = remapRow(row, idMap, { projectId: newProjectId });
          try {
            db.run(sql`INSERT INTO ${sql.raw(spec.table)} (${sql.raw(Object.keys(mapped).map(toSnake).join(', '))}) VALUES (${sql.join(Object.values(mapped).map((v) => sql`${v === undefined ? null : v}`), sql`, `)})`);
            inserted += 1;
          } catch {
            // 单行失败不中断整个导入（例如目标库缺列）：统计里体现为少导入了若干行
          }
        }
        stats[spec.key] = inserted;
      }
    });

    return { projectId: newProjectId, name, stats };
  }
}

/** DB 列名（snake_case）→ API 字段名（camelCase） */
function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** API 字段名（camelCase）→ DB 列名（snake_case） */
function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** 导出行转 camelCase，并按需丢弃大体积字段 */
function toCamelRow(row: Record<string, unknown>, dropFields: string[] = []): Record<string, unknown> {
  const drop = new Set(dropFields);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (drop.has(k)) continue;
    out[toCamel(k)] = v;
  }
  return out;
}
