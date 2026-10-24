import fs from 'node:fs';
import * as sqliteVecMod from 'sqlite-vec';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { configureSecrets, encryptLegacyKeys } from './secret-crypto';

const DATA_DIR = process.env.DATABASE_PATH
  ? path.dirname(path.resolve(process.env.DATABASE_PATH))
  : path.resolve(process.cwd(), 'apps', 'server', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'sciflow.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// 供应商 API Key 落库加密引导：主密钥与 DB 同目录，历史明文一次性加密。
// 备份/复制 sciflow.db 不再等于泄露凭据（密文需 .sciflow.key 或 SCIFLOW_SECRET 才能解）。
configureSecrets(path.dirname(DB_PATH));

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
// 写锁等待上限：并发写入排队而非立即报错（默认 5000ms）
sqlite.pragma('busy_timeout = 5000');

// ---------- sqlite-vec 扩展加载（向量 ANN 检索） ----------
/** 运行期能力探测：扩展是否真的加载成功（供 /api/health 与设置页自检展示） */
export let vecLoaded = false;
try {
  // sqlite-vec 官方入口：getLoadablePath() 按平台解析预编译扩展（win32→vec0.dll；mac→dylib；linux→so）
  // 注意：不能 require.resolve('sqlite-vec/better-sqlite3')——该包的 exports 只允许 '.' 子路径，
  // 会抛 ERR_PACKAGE_PATH_NOT_EXPORTED（此前启动报错的根因）。
  // 排障：SCIFLOW_NO_VEC=1 时跳过加载（向量检索回退 LIKE），用于定位原生扩展兼容性问题。
  if (process.env.SCIFLOW_NO_VEC !== '1') {
    const sqliteVec = sqliteVecMod;
    sqlite.loadExtension(sqliteVec.getLoadablePath());
    vecLoaded = true;
    console.log('[DB] sqlite-vec 扩展已加载（向量 ANN 检索可用）');
  } else {
    console.warn('[DB] SCIFLOW_NO_VEC=1，跳过 sqlite-vec 扩展加载（排障模式）');
  }
} catch (e: any) {
  console.warn(`[DB] sqlite-vec 扩展加载失败（向量检索不可用，将回退到全文 LIKE）: ${e?.message || e}`);
}

/** 建表 DDL（与 drizzle schema 保持一致，开箱即跑） */
sqlite.exec(`
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  preface TEXT DEFAULT '',
  templates TEXT DEFAULT '[]',
  owner_id TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS document (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  outline TEXT DEFAULT '[]',
  version INTEGER DEFAULT 1,
  versions TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reference (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  authors TEXT DEFAULT '[]',
  year INTEGER,
  venue TEXT DEFAULT '',
  doi TEXT DEFAULT '',
  url TEXT DEFAULT '',
  abstract TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  tags TEXT DEFAULT '[]',
  citation_count INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS citation (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  location TEXT DEFAULT '',
  context TEXT DEFAULT '',
  format TEXT DEFAULT 'apa',
  verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_report (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  total_score INTEGER NOT NULL,
  scores TEXT NOT NULL,
  feedback TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_task (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  topic TEXT NOT NULL,
  current_step TEXT DEFAULT '',
  status TEXT DEFAULT 'running',
  steps TEXT DEFAULT '[]',
  retry_count INTEGER DEFAULT 0,
  trace TEXT DEFAULT '[]',
  last_error TEXT DEFAULT '',
  research_notice TEXT,
  research_meta TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS polish_record (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  type TEXT NOT NULL,
  original TEXT NOT NULL,
  polished TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_doc (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  chunk_count INTEGER DEFAULT 0,
  reference_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunk (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  content TEXT NOT NULL,
  seq INTEGER DEFAULT 0,
  context TEXT DEFAULT '',
  vector TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS reflexion_log (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  round INTEGER DEFAULT 1,
  note TEXT NOT NULL,
  instructions TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  project_id TEXT,
  content TEXT NOT NULL,
  keywords TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_document_project ON document(project_id);
CREATE INDEX IF NOT EXISTS idx_reference_project ON reference(project_id);
CREATE INDEX IF NOT EXISTS idx_citation_document ON citation(document_id);
CREATE INDEX IF NOT EXISTS idx_quality_document ON quality_report(document_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_project ON pipeline_task(project_id);
CREATE INDEX IF NOT EXISTS idx_polish_document ON polish_record(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_doc(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_doc ON knowledge_chunk(doc_id);
CREATE INDEX IF NOT EXISTS idx_reflexion_task ON reflexion_log(task_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_log(type);
CREATE TABLE IF NOT EXISTS model_provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT DEFAULT '',
  model TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_intent (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  route TEXT NOT NULL,
  keywords TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  is_custom INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_config (
  step_key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  step_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_prompt (
  id TEXT PRIMARY KEY,
  tool_key TEXT NOT NULL UNIQUE,
  tool_label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_call_log (
  id TEXT PRIMARY KEY,
  caller TEXT DEFAULT 'general',
  kind TEXT DEFAULT 'llm',
  model TEXT DEFAULT '',
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  success INTEGER DEFAULT 1,
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_caller ON llm_call_log(caller);
CREATE INDEX IF NOT EXISTS idx_llm_created ON llm_call_log(created_at);

-- 科研高级功能：系统综述筛选队列
CREATE TABLE IF NOT EXISTS screening_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reason TEXT DEFAULT '',
  reviewer TEXT DEFAULT 'me',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_screening_project ON screening_queue(project_id);

-- 科研高级功能：文献编码抽取字段与取值
CREATE TABLE IF NOT EXISTS extraction_field (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT DEFAULT 'text',
  options TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extraction_field_project ON extraction_field(project_id);

CREATE TABLE IF NOT EXISTS extraction_value (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  value TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extraction_value_field ON extraction_value(field_id);

-- 科研高级功能：审稿意见闭环
CREATE TABLE IF NOT EXISTS review_comment (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  category TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  response_text TEXT DEFAULT '',
  section_ref TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_comment_document ON review_comment(document_id);

-- 科研高级功能：自建期刊库（全局共享）
CREATE TABLE IF NOT EXISTS journal (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  issn TEXT DEFAULT '',
  publisher TEXT DEFAULT '',
  scope_text TEXT DEFAULT '',
  if2024 REAL,
  quartile TEXT DEFAULT '',
  first_decision_weeks INTEGER,
  acceptance_rate REAL,
  oa TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

-- 轻量实验沙箱：本机 python3 执行记录
CREATE TABLE IF NOT EXISTS experiment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  goal TEXT DEFAULT '',
  code TEXT NOT NULL,
  stdout TEXT DEFAULT '',
  stderr TEXT DEFAULT '',
  stdout_truncated INTEGER DEFAULT 0,
  stderr_truncated INTEGER DEFAULT 0,
  figures TEXT DEFAULT '[]',
  conclusion TEXT DEFAULT '',
  runtime_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ok',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiment_project ON experiment(project_id);

-- F3 实验设计助手：AI 结构化实验设计稿（变量表/对照组/功效提示/流程/分析计划）
CREATE TABLE IF NOT EXISTS research_design (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  question TEXT NOT NULL,
  design TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_design_project ON research_design(project_id);

-- 投稿流程状态跟踪：投稿记录 + 状态历史流水
CREATE TABLE IF NOT EXISTS submission (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT DEFAULT '',
  journal_id TEXT DEFAULT '',
  journal_name TEXT NOT NULL,
  manuscript_no TEXT DEFAULT '',
  title TEXT DEFAULT '',
  submitted_at INTEGER,
  current_status TEXT DEFAULT 'submitted',
  status_updated_at INTEGER,
  revision_deadline INTEGER,
  previous_submission_id TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_project ON submission(project_id);

CREATE TABLE IF NOT EXISTS submission_status_event (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  source TEXT DEFAULT 'manual',
  raw_email_text TEXT DEFAULT '',
  confidence REAL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submission_event_submission ON submission_status_event(submission_id);

-- 全文检索：FTS5 虚拟表（独立表，关联 chunk_id）
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunk_fts USING fts5(
  chunk_id UNINDEXED,
  content,
  tokenize='trigram'
);
-- FTS5 同步触发器（INSERT/DELETE/UPDATE）
CREATE TRIGGER IF NOT EXISTS knowledge_chunk_fts_ai AFTER INSERT ON knowledge_chunk BEGIN
  INSERT INTO knowledge_chunk_fts(chunk_id, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS knowledge_chunk_fts_ad AFTER DELETE ON knowledge_chunk BEGIN
  DELETE FROM knowledge_chunk_fts WHERE chunk_id = old.id;
END;
CREATE TRIGGER IF NOT EXISTS knowledge_chunk_fts_au AFTER UPDATE ON knowledge_chunk BEGIN
  UPDATE knowledge_chunk_fts SET content = new.content WHERE chunk_id = old.id;
END;

-- 企业认证：用户表（AUTH_MODE=jwt 时启用；本地/桌面模式不强制登录）
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'member',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON user(email);
`);

// =====================================================================
// v0.2.1 新增：Agent 执行轨迹追踪 + Web 搜索缓存（对标 Cursor/Cline/OpenHands）
// =====================================================================
sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_execution (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source TEXT NOT NULL,
  input TEXT DEFAULT '',
  output_summary TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running',
  error TEXT DEFAULT '',
  model TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_exec_project ON agent_execution(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_step (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT DEFAULT '',
  input TEXT DEFAULT '',
  output TEXT DEFAULT '',
  duration_ms INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0,
  tool_name TEXT DEFAULT '',
  status TEXT DEFAULT 'ok',
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_step_run ON agent_step(run_id, seq);

CREATE TABLE IF NOT EXISTS web_search_cache (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  engine TEXT DEFAULT 'duckduckgo',
  results TEXT DEFAULT '[]',
  hit_count INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_search_query ON web_search_cache(query);
`);

// =====================================================================
// v0.3.0 新增：对话会话摘要（跨会话记忆注入，对标 Cursor 长上下文注入）
// =====================================================================
sqlite.exec(`CREATE TABLE IF NOT EXISTS chat_session (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  summary TEXT DEFAULT '',
  message_count INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_session_project ON chat_session(project_id, created_at DESC);
`);

/** 轻量迁移：为旧库补齐新列（CREATE TABLE IF NOT EXISTS 不会修改已有表） */
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    console.log(`[DB] 迁移：${table} 新增列 ${column}`);
  }
}
ensureColumn('pipeline_task', 'trace', "TEXT DEFAULT '[]'");
// Research 阶段跨库检索增强：命中 0 引导文案（null）+ 命中>0 命中摘要 JSON（''）
ensureColumn('pipeline_task', 'research_notice', "TEXT");
ensureColumn('pipeline_task', 'research_meta', "TEXT DEFAULT ''");
/** 迁移：旧库新增 fulltext 列 + 全文索引（LIKE 兜底 + BM25 回退用） */
ensureColumn('knowledge_chunk', 'context', "TEXT DEFAULT ''");
ensureColumn('knowledge_chunk', 'vector', "TEXT DEFAULT '[]'");
// 向量 ANN 检索：新增 embedding 列 + vec0 虚拟表（若 sqlite-vec 扩展可用）
ensureColumn('knowledge_chunk', 'embedding', 'BLOB');
try {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_embedding USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding FLOAT[384]
    );
  `);
  console.log('[DB] 向量检索虚拟表已就绪（knowledge_chunks_embedding vec0）');
} catch (e: any) {
  console.warn(`[DB] vec0 虚拟表创建失败（依赖 sqlite-vec 扩展）: ${e?.message || e}`);
}
// 文献库↔知识库打通（#5）：旧库补齐 reference_id 可空外键列
ensureColumn('knowledge_doc', 'reference_id', "TEXT");
// 科研高级功能：reference 阅读状态 / 去重指纹 / 重复指向
ensureColumn('reference', 'reading_status', "TEXT DEFAULT 'unread'");
ensureColumn('reference', 'fingerprint', "TEXT DEFAULT ''");
ensureColumn('reference', 'is_duplicate_of', "TEXT DEFAULT ''");
// 路线图差距 #11：文献笔记
ensureColumn('reference', 'notes', "TEXT DEFAULT ''");
// 路线图差距 #22：项目级系统提示 projectPreface
ensureColumn('project', 'preface', "TEXT DEFAULT ''");
// 差距 #1：自定义大纲模板（JSON 字符串数组）；旧库补齐默认 '[]'
ensureColumn('project', 'templates', "TEXT DEFAULT '[]'");
// 调用类型：llm=模型调用，tool=工具调用（分开统计，避免工具污染 token 成本看板）
ensureColumn('llm_call_log', 'kind', "TEXT DEFAULT 'llm'");
// 企业模式（AUTH_MODE=jwt）：项目归属，用于按用户隔离数据（防 IDOR）
ensureColumn('project', 'owner_id', "TEXT DEFAULT ''");
sqlite.exec('CREATE INDEX IF NOT EXISTS idx_project_owner ON project(owner_id)');

// ---------- 迁移：knowledge_chunk_fts 从 unicode61 升级到 trigram ----------
// 原因：unicode61 不切分 CJK（整段中文是一个 token），中文短语检索永远命中不到；
// trigram 支持 >=3 字符子串匹配（含 CJK），配合 buildTrigramQuery 的 3-gram OR 展开。
{
  const row = sqlite
    .prepare(`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='knowledge_chunk_fts'
    `)
    .get() as { sql?: string } | undefined;
  if (row?.sql && /unicode61/.test(row.sql)) {
    const reindex = () => {
      sqlite.exec(`
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
    };
    try {
      reindex();
      const n = (sqlite.prepare('SELECT COUNT(*) AS c FROM knowledge_chunk_fts').get() as { c: number }).c;
      console.log(`[DB] 迁移: knowledge_chunk_fts 已切换到 trigram tokenizer（重建索引 ${n} 块）`);
    } catch (e: any) {
      console.warn(`[DB] FTS trigram 迁移失败（保留 unicode61）: ${e?.message || e}`);
    }
  }
}

/** 期刊库种子：内置国内主流期刊（仅写领域定位等事实描述；ISSN/IF/分区等不确定指标一律 NULL，禁止编造） */
const seedJournals = [
  ['计算机学报', '中国计算机学会（CCF）会刊，中国科学院计算技术研究所主办。刊登计算机科学理论、系统结构、软件、人工智能、计算机网络等方向的原创性研究论文。'],
  ['软件学报', 'CCF 会刊，中国科学院软件研究所主办。聚焦软件工程、程序设计语言、系统软件、形式化方法、智能化软件工程等方向的高水平研究。'],
  ['电子学报', '中国电子学会主办。覆盖电子科学与技术、信号与信息处理、通信、微电子、雷达与遥感等电子信息领域的基础与应用研究。'],
  ['自动化学报', '中国自动化学会与中国科学院自动化研究所主办。聚焦控制理论与控制工程、模式识别、智能系统、机器人、复杂系统等方向。'],
  ['中文信息学报', '中国中文信息学会主办。聚焦自然语言处理、中文信息处理、机器翻译、信息抽取、文本挖掘、计算语言学等方向。'],
  ['计算机研究与发展', 'CCF 会刊，中国科学院计算技术研究所主办。刊登计算机系统、体系结构、算法、数据库、人工智能、信息安全等方向的研究成果。'],
];
const journalCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM journal').get() as { c: number }).c;
if (journalCount === 0) {
  const insert = sqlite.prepare(
    'INSERT INTO journal (id, name, issn, publisher, scope_text, if2024, quartile, first_decision_weeks, acceptance_rate, oa, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)',
  );
  const now = Date.now();
  for (const [name, scope] of seedJournals) {
    insert.run(randomUUID(), name, '', '', scope, '', '', now);
  }
  console.log(`[DB] 期刊库种子：已写入 ${seedJournals.length} 个国内期刊`);
}

// 一次性迁移：把库中历史明文 api_key 就地加密（兼容升级前的旧库）
encryptLegacyKeys(
  (sql) => sqlite.prepare(sql).all() as Array<Record<string, string | null>>,
  (id, encrypted) => {
    const stmt = sqlite.prepare('UPDATE model_provider SET ' + 'api_key' + '=? WHERE id=?')
    stmt.run(encrypted, id);
  },
);

/**
 * 数据库 schema 初始化（保留 ensureColumn 用于旧库 backward-compat 迁移）。
 * 新能力上线需要的列，在 DDL 里加 CREATE TABLE IF NOT EXISTS 自然兼容新库；
 * 已有的旧库走 ensureColumn 补齐。
 *
 * ⚠️ 未来大版本 schema 变化请用 `pnpm --filter @sciflow/server db:push`
 *    （drizzle-kit migration）替代手写 ensureColumn。
 */

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
export { sqlite, DB_PATH };
