/**
 * SQLite schema 迁移账本。
 *
 * 历史实现是启动时逐条 `ensureColumn()`：能补列，但没有“哪些迁移已经跑过”的记录，
 * 也无法发现迁移代码被改过。这里保留 `ensureColumn` 的幂等语义，但把每条变更
 * 包进版本化迁移，并把 version / name / checksum / applied_at 落到 `schema_migration`。
 *
 * 纪律：
 *  - 已应用的迁移不要改；要改 schema 就追加新版本。需要防手改的迁移可提供 signature。
 *  - 迁移本身必须幂等（`ensureColumn` / `IF NOT EXISTS`），旧库和新库都能安全跑。
 *  - 一个迁移一个事务；失败时账本不前进，下次启动会重试同一版本。
 */
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface SchemaMigration {
  version: number;
  name: string;
  /**
   * 可选的稳定签名。默认用 version:name 生成；不要用函数源码做 checksum，
   * 因为 dev 的 TS 与打包后的 JS 字符串不同，会让同一迁移在发行包里误报漂移。
   * 需要防手改时显式提供签名，并在修改迁移时同步改签名（更推荐直接追加新版本）。
   */
  signature?: string;
  up: (db: Database.Database) => void;
  down?: (db: Database.Database) => void;
}

interface MigrationLogger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

const noopLogger: MigrationLogger = {
  log: () => undefined,
  warn: () => undefined,
};

function checksum(migration: SchemaMigration): string {
  return createHash('sha1').update(migration.signature ?? `${migration.version}:${migration.name}`).digest('hex');
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(table),
  );
}

/** 幂等补列；表不存在时直接跳过，交给建表 DDL/迁移处理。 */
export function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  if (!tableExists(db, table)) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function addIfExists(db: Database.Database, table: string, column: string, ddl: string): void {
  ensureColumn(db, table, column, ddl);
}

/** 幂等删列；SQLite 3.35+ 支持 DROP COLUMN，旧库/新库都能安全跑。 */
function dropIfExists(db: Database.Database, table: string, column: string): void {
  if (!tableExists(db, table)) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}


/** v1 迁移：pipeline / memory 的旧列。 */
const m001PipelineMemory: SchemaMigration = {
  version: 1,
  name: 'pipeline-memory-columns',
  up(db) {
    addIfExists(db, 'memory_log', 'embedding', 'BLOB');
    addIfExists(db, 'pipeline_task', 'trace', "TEXT DEFAULT '[]'");
    addIfExists(db, 'pipeline_task', 'research_notice', 'TEXT');
    addIfExists(db, 'pipeline_task', 'research_meta', "TEXT DEFAULT ''");
  },
};

/** v2 迁移：知识库全文/向量列与文献库绑定。 */
const m002KnowledgeColumns: SchemaMigration = {
  version: 2,
  name: 'knowledge-columns',
  up(db) {
    addIfExists(db, 'knowledge_chunk', 'context', "TEXT DEFAULT ''");
    addIfExists(db, 'knowledge_chunk', 'vector', "TEXT DEFAULT '[]'");
    addIfExists(db, 'knowledge_chunk', 'embedding', 'BLOB');
    addIfExists(db, 'knowledge_doc', 'reference_id', 'TEXT');
  },
};

/** v3 迁移：文献阅读状态 / 去重指纹 / 笔记。 */
const m003ReferenceColumns: SchemaMigration = {
  version: 3,
  name: 'reference-metadata-columns',
  up(db) {
    addIfExists(db, 'reference', 'reading_status', "TEXT DEFAULT 'unread'");
    addIfExists(db, 'reference', 'fingerprint', "TEXT DEFAULT ''");
    addIfExists(db, 'reference', 'is_duplicate_of', "TEXT DEFAULT ''");
    addIfExists(db, 'reference', 'notes', "TEXT DEFAULT ''");
    if (tableExists(db, 'reference')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_reference_project_fp ON reference(project_id, fingerprint)');
    }
  },
};

/** v4 迁移：项目级研究要求 / 模板 / 企业归属。 */
const m004ProjectColumns: SchemaMigration = {
  version: 4,
  name: 'project-columns',
  up(db) {
    addIfExists(db, 'project', 'preface', "TEXT DEFAULT ''");
    addIfExists(db, 'project', 'templates', "TEXT DEFAULT '[]'");
    addIfExists(db, 'project', 'owner_id', "TEXT DEFAULT ''");
    if (tableExists(db, 'project')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_project_owner ON project(owner_id)');
    }
  },
};

/** v5 迁移：LLM 调用类型与项目归属。 */
const m005LlmCallColumns: SchemaMigration = {
  version: 5,
  name: 'llm-call-columns',
  up(db) {
    addIfExists(db, 'llm_call_log', 'kind', "TEXT DEFAULT 'llm'");
    addIfExists(db, 'llm_call_log', 'project_id', "TEXT DEFAULT ''");
    if (tableExists(db, 'llm_call_log')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_llm_project ON llm_call_log(project_id)');
    }
  },
};

/** v6 迁移：实验沙箱多运行时。 */
const m006ExperimentRuntime: SchemaMigration = {
  version: 6,
  name: 'experiment-runtime-column',
  up(db) {
    addIfExists(db, 'experiment', 'runtime', "TEXT DEFAULT 'python'");
  },
};

/** v7 迁移：模型厂商协议与能力目录。 */
const m007ProviderColumns: SchemaMigration = {
  version: 7,
  name: 'provider-capability-columns',
  up(db) {
    addIfExists(db, 'model_provider', 'protocol', "TEXT DEFAULT 'openai-compatible'");
    addIfExists(db, 'model_provider', 'context_window', 'INTEGER DEFAULT 0');
    addIfExists(db, 'model_provider', 'max_output', 'INTEGER DEFAULT 0');
    addIfExists(db, 'model_provider', 'tool_calling', 'INTEGER DEFAULT 1');
    addIfExists(db, 'model_provider', 'models', "TEXT DEFAULT '[]'");
  },
};

/** v8 迁移：质量报告三源拆分。 */
const m008QualityColumns: SchemaMigration = {
  version: 8,
  name: 'quality-source-columns',
  up(db) {
    addIfExists(db, 'quality_report', 'objective_score', 'INTEGER');
    addIfExists(db, 'quality_report', 'objective_dimensions', "TEXT DEFAULT '[]'");
    addIfExists(db, 'quality_report', 'llm_score', 'INTEGER');
    addIfExists(db, 'quality_report', 'llm_scores', "TEXT DEFAULT '{}'");
    addIfExists(db, 'quality_report', 'expert_score', 'INTEGER');
    addIfExists(db, 'quality_report', 'expert_status', "TEXT DEFAULT 'unreviewed'");
  },
};

/** v9 迁移：文档修改队列。 */
const m009DocumentRevisionQueue: SchemaMigration = {
  version: 9,
  name: 'document-revision-queue-column',
  up(db) {
    addIfExists(db, 'document', 'revision_queue', "TEXT DEFAULT '{}'");
  },
};

/** v10 迁移：审稿意见段落锚点。 */
const m010ReviewAnchors: SchemaMigration = {
  version: 10,
  name: 'review-comment-anchors',
  up(db) {
    addIfExists(db, 'review_comment', 'quote', "TEXT DEFAULT ''");
    addIfExists(db, 'review_comment', 'anchor_start', 'INTEGER');
    addIfExists(db, 'review_comment', 'anchor_end', 'INTEGER');
    if (tableExists(db, 'review_comment')) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_review_comment_status_document ON review_comment(status, document_id)');
    }
  },
};

/** v11 迁移：中文 FTS 从 unicode61 升到 trigram。 */
const m011FtsTrigram: SchemaMigration = {
  version: 11,
  name: 'fts-trigram',
  up(db) {
    if (!tableExists(db, 'knowledge_chunk_fts') || !tableExists(db, 'knowledge_chunk')) return;
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='knowledge_chunk_fts'").get() as
      | { sql?: string }
      | undefined;
    if (!row?.sql || !/unicode61/.test(row.sql)) return;
    db.exec(`
      DROP TRIGGER IF EXISTS knowledge_chunk_fts_ai;
      DROP TRIGGER IF EXISTS knowledge_chunk_fts_ad;
      DROP TRIGGER IF EXISTS knowledge_chunk_fts_au;
      DROP TABLE IF EXISTS knowledge_chunk_fts;
      CREATE VIRTUAL TABLE knowledge_chunk_fts USING fts5(
        chunk_id UNINDEXED,
        content,
        tokenize='trigram'
      );
      INSERT INTO knowledge_chunk_fts(chunk_id, content) SELECT id, content FROM knowledge_chunk;
      CREATE TRIGGER knowledge_chunk_fts_ai AFTER INSERT ON knowledge_chunk BEGIN
        INSERT INTO knowledge_chunk_fts(chunk_id, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER knowledge_chunk_fts_ad AFTER DELETE ON knowledge_chunk BEGIN
        DELETE FROM knowledge_chunk_fts WHERE chunk_id = old.id;
      END;
      CREATE TRIGGER knowledge_chunk_fts_au AFTER UPDATE ON knowledge_chunk BEGIN
        UPDATE knowledge_chunk_fts SET content = new.content WHERE chunk_id = old.id;
      END;
    `);
  },
};

/** v12 迁移：后台多会话执行器任务表。 */
const m012BackgroundJobs: SchemaMigration = {
  version: 12,
  name: 'agent-background-jobs',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_background_job (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        session_key TEXT DEFAULT 'default',
        message TEXT NOT NULL,
        model TEXT DEFAULT '',
        status TEXT DEFAULT 'queued',
        output TEXT DEFAULT '',
        error TEXT DEFAULT '',
        run_id TEXT DEFAULT '',
        total_tokens INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_agent_background_project ON agent_background_job(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_background_status ON agent_background_job(status, created_at);
    `);
  },
};

/** v13 迁移：后台任务补 token 统计列（v12 已建表的旧库也能升级）。 */
const m013BackgroundTokens: SchemaMigration = {
  version: 13,
  name: 'agent-background-tokens',
  up(db) {
    addIfExists(db, 'agent_background_job', 'total_tokens', 'INTEGER DEFAULT 0');
  },
};



/** v14 迁移：公开只读分享链接。 */
const m014ShareLinks: SchemaMigration = {
  version: 14,
  name: 'share-links',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS share_link (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        title TEXT DEFAULT '',
        snapshot TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_share_link_project ON share_link(project_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_share_link_token ON share_link(token);
    `);
  },
};

/** v15 迁移：定时任务调度器。 */
const m015AgentSchedules: SchemaMigration = {
  version: 15,
  name: 'agent-schedules',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_schedule (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cadence TEXT NOT NULL,
        minute_of_hour INTEGER DEFAULT 0,
        hour_of_day INTEGER DEFAULT 9,
        weekday INTEGER DEFAULT 1,
        message TEXT NOT NULL,
        session_key TEXT DEFAULT 'schedule',
        model TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_schedule_project ON agent_schedule(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_schedule_next ON agent_schedule(enabled, next_run_at);
    `);
  },
};

/** v16 迁移：chat_session 从“摘要账本”扩为“完整会话主记录”。 */
const m016ChatSessionConversations: SchemaMigration = {
  version: 16,
  name: 'chat-session-conversations',
  up(db) {
    addIfExists(db, 'chat_session', 'title', "TEXT DEFAULT ''");
    addIfExists(db, 'chat_session', 'messages_json', "TEXT DEFAULT '[]'");
    addIfExists(db, 'chat_session', 'branch_json', "TEXT DEFAULT '{}'");
    addIfExists(db, 'chat_session', 'pinned', 'INTEGER DEFAULT 0');
    addIfExists(db, 'chat_session', 'archived', 'INTEGER DEFAULT 0');
    addIfExists(db, 'chat_session', 'last_message_at', 'INTEGER');
    addIfExists(db, 'chat_session', 'source', "TEXT DEFAULT 'cloud'");
    addIfExists(db, 'chat_session', 'summary_only', 'INTEGER DEFAULT 0');
    if (tableExists(db, 'chat_session')) {
      // 旧库的历史行只有摘要，没有完整消息；标记为 summary_only，避免被当成可打开会话。
      db.exec(`
        UPDATE chat_session
        SET summary_only = 1,
            source = 'legacy-summary',
            title = CASE WHEN title = '' THEN substr(summary, 1, 60) ELSE title END
        WHERE messages_json IS NULL OR messages_json = '[]';
        CREATE INDEX IF NOT EXISTS idx_chat_session_project_last ON chat_session(project_id, last_message_at DESC);
      `);
    }
  },
};


/** v17 迁移：自动化触发器 + 统一 Agent 收件箱。 */
const m017AutomationNotifications: SchemaMigration = {
  version: 17,
  name: 'automation-notifications',
  up(db) {
    addIfExists(db, 'agent_schedule', 'trigger_type', "TEXT DEFAULT 'time'");
    addIfExists(db, 'agent_schedule', 'trigger_config', "TEXT DEFAULT '{}'");
    addIfExists(db, 'agent_schedule', 'notify_channels', "TEXT DEFAULT '[\"inapp\"]'");
    addIfExists(db, 'agent_schedule', 'notify_target', "TEXT DEFAULT ''");
    addIfExists(db, 'agent_schedule', 'last_status', "TEXT DEFAULT 'pending'");
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_notification (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT DEFAULT 'system',
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        link TEXT DEFAULT '',
        read INTEGER DEFAULT 0,
        dedupe_key TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_notification_project ON agent_notification(project_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_notification_dedupe ON agent_notification(project_id, dedupe_key) WHERE dedupe_key <> '';
    `);
  },
};

/** v18 迁移：对话分享 + 公开页只读评论。 */
const m018ShareConversationComments: SchemaMigration = {
  version: 18,
  name: 'share-conversation-comments',
  up(db) {
    addIfExists(db, 'share_link', 'allow_comments', 'INTEGER DEFAULT 0');
    db.exec(`
      CREATE TABLE IF NOT EXISTS share_comment (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL,
        author_name TEXT DEFAULT '匿名读者',
        content TEXT NOT NULL,
        status TEXT DEFAULT 'visible',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_share_comment_share ON share_comment(share_id, created_at);
    `);
  },
};


/** v19 迁移：删除未被前端使用的 project.templates 死字段（模板统一由 outline-templates 提供）。 */
const m019DropProjectTemplates: SchemaMigration = {
  version: 19,
  name: 'drop-project-templates',
  up(db) {
    dropIfExists(db, 'project', 'templates');
  },
};

export const MIGRATIONS: SchemaMigration[] = [
  m001PipelineMemory,
  m002KnowledgeColumns,
  m003ReferenceColumns,
  m004ProjectColumns,
  m005LlmCallColumns,
  m006ExperimentRuntime,
  m007ProviderColumns,
  m008QualityColumns,
  m009DocumentRevisionQueue,
  m010ReviewAnchors,
  m011FtsTrigram,
  m012BackgroundJobs,
  m013BackgroundTokens,
  m014ShareLinks,
  m015AgentSchedules,
  m016ChatSessionConversations,
  m017AutomationNotifications,
  m018ShareConversationComments,
  m019DropProjectTemplates,
];

interface LedgerRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: number;
}

/**
 * 执行未应用的迁移。默认对 MIGRATIONS 全量运行；测试可传自定义数组。
 * 返回本次实际应用的版本号，便于启动日志与测试断言。
 */
export function runMigrations(
  db: Database.Database,
  migrations: SchemaMigration[] = MIGRATIONS,
  logger: MigrationLogger = noopLogger,
): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL DEFAULT '',
      applied_at INTEGER NOT NULL
    );
  `);
  const applied = db.prepare('SELECT version, name, checksum, applied_at FROM schema_migration ORDER BY version').all() as LedgerRow[];
  const byVersion = new Map(applied.map((row) => [row.version, row]));
  const allVersions = new Set(migrations.map((m) => m.version));
  for (const row of applied) {
    if (!allVersions.has(row.version)) {
      throw new Error(`[db] schema_migration 记录了未知迁移 v${row.version}（${row.name}），请检查迁移数组是否被误删`);
    }
  }

  const newlyApplied: number[] = [];
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`[db] 迁移版本号必须是正整数：${String(migration.version)}`);
    }
    const previous = byVersion.get(migration.version);
    if (previous) {
      const expected = checksum(migration);
      if (previous.checksum && previous.checksum !== expected) {
        throw new Error(
          `[db] 迁移 v${migration.version}（${migration.name}）代码已变更：` +
          `账本 checksum=${previous.checksum.slice(0, 12)}，当前=${expected.slice(0, 12)}。` +
          '已应用迁移不可修改，请追加新版本。',
        );
      }
      continue;
    }
    const expected = checksum(migration);
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migration (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)').run(
        migration.version,
        migration.name,
        expected,
        Date.now(),
      );
    })();
    newlyApplied.push(migration.version);
    logger.log(`[DB] 迁移 v${migration.version} ${migration.name} 已应用`);
  }
  if (newlyApplied.length === 0) logger.log('[DB] schema 迁移账本已是最新');
  return newlyApplied;
}
