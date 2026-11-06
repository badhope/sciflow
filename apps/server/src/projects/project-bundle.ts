/**
 * 项目全量导出 / 导入（纯逻辑层，无 IO）。
 *
 * 动机：用户会迁移机器、换设备、做归档，或把项目交给同事。此前只有整库备份
 * （scripts/backup-db.mjs，运维级、整库粒度），没有「导出这一个项目」的用户级入口。
 *
 * 设计约束：
 *  - 导出必须是**自包含**的：一个 JSON 文件带走项目及其全部子表数据，不依赖其他项目；
 *  - 导入必须**改 id**：避免与既有数据撞主键；同时把项目内所有外键重映射到新 id；
 *  - 不携带运行态噪音：pipeline 任务的中间状态、agent 执行轨迹等默认不带（可显式开启），
 *    否则归档文件会巨大且包含无意义的历史。
 */

/** 导出包格式版本：结构变更时递增，导入端据此拒绝不认识的版本 */
export const BUNDLE_VERSION = 1;

export interface BundleTableSpec {
  /** 导出包里的键名 */
  key: string;
  /** 表名（用于提示与统计） */
  table: string;
  /** 该表用于关联项目的列 */
  projectColumn: string;
  /** 是否默认导出（运行态轨迹默认不带） */
  defaultInclude: boolean;
  /** 导出前是否剥掉指定字段（如大体积内容） */
  dropFields?: string[];
}

/** 项目内所有按 projectId 归属的表（与 schema 对齐；新增表时在此登记） */
export const BUNDLE_TABLES: BundleTableSpec[] = [
  { key: 'documents', table: 'document', projectColumn: 'project_id', defaultInclude: true },
  { key: 'references', table: 'reference', projectColumn: 'project_id', defaultInclude: true },
  { key: 'citations', table: 'citation', projectColumn: 'project_id', defaultInclude: true },
  { key: 'qualityReports', table: 'quality_report', projectColumn: 'project_id', defaultInclude: true },
  { key: 'reviewComments', table: 'review_comment', projectColumn: 'project_id', defaultInclude: true },
  { key: 'polishRecords', table: 'polish_record', projectColumn: 'project_id', defaultInclude: true },
  { key: 'knowledgeDocs', table: 'knowledge_doc', projectColumn: 'project_id', defaultInclude: true },
  { key: 'knowledgeChunks', table: 'knowledge_chunk', projectColumn: 'project_id', defaultInclude: true },
  { key: 'memoryLogs', table: 'memory_log', projectColumn: 'project_id', defaultInclude: true },
  { key: 'experiments', table: 'experiment', projectColumn: 'project_id', defaultInclude: true },
  { key: 'submissions', table: 'submission', projectColumn: 'project_id', defaultInclude: true },
  { key: 'submissionEvents', table: 'submission_status_event', projectColumn: 'project_id', defaultInclude: true },
  { key: 'screeningQueue', table: 'screening_queue', projectColumn: 'project_id', defaultInclude: true },
  { key: 'extractionFields', table: 'extraction_field', projectColumn: 'project_id', defaultInclude: true },
  { key: 'extractionValues', table: 'extraction_value', projectColumn: 'project_id', defaultInclude: true },
  { key: 'chatSessions', table: 'chat_session', projectColumn: 'project_id', defaultInclude: true },
  // 运行态轨迹：默认不带（体积大、且对迁移无价值）
  { key: 'pipelineTasks', table: 'pipeline_task', projectColumn: 'project_id', defaultInclude: false },
  { key: 'reflexionLogs', table: 'reflexion_log', projectColumn: 'project_id', defaultInclude: false },
  { key: 'agentExecutions', table: 'agent_execution', projectColumn: 'project_id', defaultInclude: false },
];

export interface ProjectBundle {
  bundleVersion: number;
  exportedAt: number;
  project: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
  /** 导出时的行数统计（导入后可核对） */
  counts: Record<string, number>;
}

/** 校验导入包：结构不对时给出可读原因，而不是让数据库抛约束错。 */
export function validateBundle(raw: unknown): { ok: true; bundle: ProjectBundle } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: '导入内容不是合法 JSON 对象' };
  const b = raw as Partial<ProjectBundle>;
  if (typeof b.bundleVersion !== 'number') return { ok: false, reason: '缺少 bundleVersion，可能不是 SciFlow 项目包' };
  if (b.bundleVersion > BUNDLE_VERSION) {
    return { ok: false, reason: `项目包版本 ${b.bundleVersion} 高于当前支持的 ${BUNDLE_VERSION}，请升级后再导入` };
  }
  if (!b.project || typeof b.project !== 'object') return { ok: false, reason: '缺少 project 字段' };
  if (!b.tables || typeof b.tables !== 'object') return { ok: false, reason: '缺少 tables 字段' };
  for (const [k, v] of Object.entries(b.tables)) {
    if (!Array.isArray(v)) return { ok: false, reason: `tables.${k} 不是数组` };
  }
  return { ok: true, bundle: b as ProjectBundle };
}

/** 生成新 id 的纯函数入口（注入以便测试确定性） */
export type IdFactory = () => string;

/**
 * 构建旧 id → 新 id 映射。
 * 只映射包内实际出现的 id，避免生成大量无用条目。
 */
export function buildIdMap(bundle: ProjectBundle, newId: IdFactory): Map<string, string> {
  const map = new Map<string, string>();
  const addId = (id: unknown) => {
    if (typeof id === 'string' && id && !map.has(id)) map.set(id, newId());
  };
  addId(bundle.project.id);
  for (const rows of Object.values(bundle.tables)) {
    for (const row of rows) {
      addId(row.id);
      // 常见外键列：重映射时统一按「值命中旧 id 就换新 id」处理
      for (const col of ['projectId', 'documentId', 'referenceId', 'taskId', 'sessionId', 'docId', 'refId']) {
        addId(row[col]);
      }
    }
  }
  return map;
}

/**
 * 把一行数据里所有命中映射表的值替换为新 id（浅层：只处理顶层字段）。
 * 未命中的值原样保留（可能是 null / 业务字段）。
 */
export function remapRow(
  row: Record<string, unknown>,
  map: Map<string, string>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && map.has(v) ? map.get(v) : v;
  }
  return { ...out, ...overrides };
}

/** 导入前给项目重命名，避免同名混淆（同名时追加「（导入）」） */
export function renameOnImport(name: string, existingNames: string[]): string {
  const base = (name || '未命名项目').trim();
  if (!existingNames.includes(base)) return base;
  let candidate = `${base}（导入）`;
  let n = 2;
  while (existingNames.includes(candidate)) {
    candidate = `${base}（导入 ${n}）`;
    n += 1;
  }
  return candidate;
}
