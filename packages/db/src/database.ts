import fs from 'node:fs';
import * as sqliteVecMod from 'sqlite-vec';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { configureSecrets, encryptLegacyKeys } from './secret-crypto';
import { MIGRATIONS, runMigrations } from './migrations';

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

CREATE TABLE IF NOT EXISTS research_brief (
  project_id TEXT PRIMARY KEY,
  question TEXT DEFAULT '',
  scope TEXT DEFAULT '',
  methods TEXT DEFAULT '',
  constraints TEXT DEFAULT '',
  success_criteria TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
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
  revision_queue TEXT DEFAULT '{}',
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
  objective_score INTEGER,
  objective_dimensions TEXT DEFAULT '[]',
  llm_score INTEGER,
  llm_scores TEXT DEFAULT '{}',
  expert_score INTEGER,
  expert_status TEXT DEFAULT 'unreviewed',
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
  embedding BLOB,
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
CREATE INDEX IF NOT EXISTS idx_citation_reference ON citation(reference_id);
CREATE INDEX IF NOT EXISTS idx_memory_project_created ON memory_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_task(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_project_status ON pipeline_task(project_id, status);
CREATE INDEX IF NOT EXISTS idx_document_project_updated ON document(project_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS model_provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT DEFAULT '',
  model TEXT NOT NULL,
  protocol TEXT DEFAULT 'openai-compatible',
  context_window INTEGER DEFAULT 0,
  max_output INTEGER DEFAULT 0,
  tool_calling INTEGER DEFAULT 1,
  models TEXT DEFAULT '[]',
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


-- 配置中心（v1.3）：角色库 / 约束工程 / 钩子 / 审计
CREATE TABLE IF NOT EXISTS config_role (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS config_constraint (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  rule TEXT NOT NULL,
  level TEXT DEFAULT 'must',
  scope TEXT DEFAULT 'all',
  enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  source TEXT DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS config_hook (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  event TEXT NOT NULL,
  type TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS config_audit (
  id TEXT PRIMARY KEY,
  actor TEXT DEFAULT 'ui',
  category TEXT DEFAULT '',
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '',
  allowed INTEGER DEFAULT 1,
  reason TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_config_audit_created ON config_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_constraint_scope ON config_constraint(scope, enabled);


-- 扩展中心（v1.4）：统一资产表
CREATE TABLE IF NOT EXISTS extension_asset (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source TEXT DEFAULT 'user',
  repo TEXT DEFAULT '',
  license TEXT DEFAULT '',
  install TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  manifest TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  visibility TEXT DEFAULT 'public',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_extension_asset_key ON extension_asset(key);
CREATE INDEX IF NOT EXISTS idx_extension_asset_kind ON extension_asset(kind, enabled);

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
  project_id TEXT DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_llm_project ON llm_call_log(project_id);

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
  quote TEXT DEFAULT '',
  anchor_start INTEGER,
  anchor_end INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_comment_document ON review_comment(document_id);
CREATE INDEX IF NOT EXISTS idx_review_comment_status_document ON review_comment(status, document_id);

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
  runtime TEXT DEFAULT 'python',
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

-- 自主科研对象：Research Program / Cycle / Question / Hypothesis / Protocol
CREATE TABLE IF NOT EXISTS research_program (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  goal TEXT DEFAULT '',
  domain TEXT DEFAULT '',
  autonomy_level TEXT DEFAULT 'L2',
  status TEXT DEFAULT 'draft',
  constraints TEXT DEFAULT '{}',
  success_criteria TEXT DEFAULT '[]',
  created_by TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_program_project ON research_program(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_cycle (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state TEXT DEFAULT 'intake',
  objective TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  budget TEXT DEFAULT '{}',
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_cycle_program ON research_cycle(program_id, seq);

CREATE TABLE IF NOT EXISTS research_question (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  cycle_id TEXT,
  question TEXT NOT NULL,
  scope TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_question_program ON research_question(program_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_hypothesis (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  rationale TEXT DEFAULT '',
  predictions TEXT DEFAULT '[]',
  status TEXT DEFAULT 'proposed',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_hypothesis_question ON research_hypothesis(question_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_hypothesis_program ON research_hypothesis(program_id);

CREATE TABLE IF NOT EXISTS research_protocol (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  hypothesis_id TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  design TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  approved_by TEXT DEFAULT '',
  approved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_protocol_hypothesis ON research_protocol(hypothesis_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_research_protocol_program ON research_protocol(program_id);

-- 阶段 2B：Claim / Evidence / Run
CREATE TABLE IF NOT EXISTS research_claim (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  cycle_id TEXT,
  protocol_id TEXT,
  statement TEXT NOT NULL,
  confidence INTEGER DEFAULT 50,
  status TEXT DEFAULT 'draft',
  scope TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_claim_program ON research_claim(program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_claim_cycle ON research_claim(cycle_id);
CREATE INDEX IF NOT EXISTS idx_research_claim_protocol ON research_claim(protocol_id);

CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT DEFAULT '',
  quote TEXT DEFAULT '',
  stance TEXT DEFAULT 'supports',
  strength INTEGER DEFAULT 3,
  verified INTEGER DEFAULT 0,
  created_by TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_evidence_claim ON research_evidence(claim_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_evidence_program ON research_evidence(program_id);

CREATE TABLE IF NOT EXISTS research_run (
  id TEXT PRIMARY KEY,
  program_id TEXT NOT NULL,
  cycle_id TEXT,
  protocol_id TEXT,
  experiment_id TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  manifest TEXT DEFAULT '{}',
  summary TEXT DEFAULT '',
  started_at INTEGER,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_run_program ON research_run(program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_run_cycle ON research_run(cycle_id);
CREATE INDEX IF NOT EXISTS idx_research_run_protocol ON research_run(protocol_id);

-- 长篇写作：书 / 卷 / 章（按章增量生成，靠摘要维持跨章一致性）
CREATE TABLE IF NOT EXISTS longform_book (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  premise TEXT DEFAULT '',
  style_hint TEXT DEFAULT '',
  target_chars_per_chapter INTEGER DEFAULT 3000,
  status TEXT DEFAULT 'planning',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_longform_book_project ON longform_book(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS longform_volume (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  goal TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_longform_volume_book ON longform_volume(book_id, seq);

CREATE TABLE IF NOT EXISTS longform_chapter (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  goal TEXT DEFAULT '',
  beats TEXT DEFAULT '[]',
  entities TEXT DEFAULT '[]',
  content TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  chars INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_longform_chapter_book ON longform_chapter(book_id, seq);
CREATE INDEX IF NOT EXISTS idx_longform_chapter_status ON longform_chapter(book_id, status);

-- Web 项目沙箱：独立目录 + npm 构建 + 静态预览
CREATE TABLE IF NOT EXISTS web_project (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  template TEXT DEFAULT 'static',
  work_dir TEXT NOT NULL,
  status TEXT DEFAULT 'created',
  preview_port INTEGER,
  preview_url TEXT DEFAULT '',
  install_log TEXT DEFAULT '',
  build_log TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_project_project ON web_project(project_id, updated_at DESC);

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
  title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  messages_json TEXT DEFAULT '[]',
  branch_json TEXT DEFAULT '{}',
  message_count INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  pinned INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  last_message_at INTEGER,
  source TEXT DEFAULT 'cloud',
  summary_only INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_session_project ON chat_session(project_id, created_at DESC);
-- last_message_at 是 v16 新增列：旧库此时还没有，索引必须等迁移补列后再建。
`);


sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_task (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  run_id TEXT,
  "group" TEXT DEFAULT 'default',
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  seq INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_task_project ON agent_task(project_id, seq);
CREATE INDEX IF NOT EXISTS idx_agent_task_run ON agent_task(run_id);

CREATE TABLE IF NOT EXISTS tool_approval (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  run_id TEXT,
  tool_name TEXT NOT NULL,
  args TEXT DEFAULT '{}',
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_approval_status ON tool_approval(status, created_at DESC);


CREATE TABLE IF NOT EXISTS agent_plan (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  run_id TEXT,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  plan TEXT DEFAULT '{}',
  allowed_tools TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending',
  max_steps INTEGER DEFAULT 12,
  used_steps INTEGER DEFAULT 0,
  budget_tokens INTEGER DEFAULT 0,
  used_tokens INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_plan_project ON agent_plan(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_plan_status ON agent_plan(status, approved_at DESC);
`);

runMigrations(sqlite, MIGRATIONS, console);

// 向量 ANN 检索：embedding 列由迁移 v2 补齐后，再建 vec0 虚拟表（若 sqlite-vec 扩展可用）
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
 * 数据库 schema 初始化：DDL 负责新库，版本化迁移账本负责旧库补列。
 * 新 schema 变化请追加 `packages/db/src/migrations.ts` 版本，不要回到手写 ensureColumn。
 */

export const db: BetterSQLite3Database<typeof schema> = drizzle(sqlite, { schema });
export { sqlite, DB_PATH };
