import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core';

/** 项目 */
export const projects = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  status: text('status').default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** 项目级系统提示（projectPreface）：写作/规划时注入 system prompt 开头（差距 #22） */
  preface: text('preface').default(''),
  /** 差距#1：自定义大纲模板（JSON 字符串：[{name,description,sections:[{title,points}]}]） */
  templates: text('templates').default('[]'),
  /** 归属用户（AUTH_MODE=jwt 企业模式使用；空串=本地单用户模式的公共项目） */
  ownerId: text('owner_id').default(''),
});

/** 文档（论文草稿，多版本历史以 JSON 保存在 versions） */
export const documents = sqliteTable('document', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  content: text('content').default(''),
  outline: text('outline').default('[]'), // JSON: [{id,title,children:[...]}]
  version: integer('version').default(1),
  versions: text('versions').default('[]'), // JSON: [{version,content,updatedAt}]
  status: text('status').default('draft'), // draft | reviewing | polished | final
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 文献库 */
export const references = sqliteTable('reference', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  authors: text('authors').default('[]'), // JSON: string[]
  year: integer('year'),
  venue: text('venue').default(''),
  doi: text('doi').default(''),
  url: text('url').default(''),
  abstract: text('abstract').default(''),
  source: text('source').default('manual'), // manual（本地文献库，已移除国外在线源）
  tags: text('tags').default('[]'), // JSON: string[]
  citationCount: integer('citation_count').default(0),
  // 科研高级功能：阅读状态 / 去重指纹 / 重复指向
  readingStatus: text('reading_status').default('unread'), // unread | reading | read | cited
  fingerprint: text('fingerprint').default(''), // 标题归一化后哈希（项目内去重依据）
  isDuplicateOf: text('is_duplicate_of').default(''), // 重复时指向已存在文献 id
  notes: text('notes').default(''), // 文献笔记（路线图差距 #11）
  createdAt: integer('created_at').notNull(),
});

/** 引用关系（文档 -> 文献） */
export const citations = sqliteTable('citation', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  referenceId: text('reference_id').notNull(),
  location: text('location').default(''), // 章节/段落位置
  context: text('context').default(''), // 引用上下文句
  format: text('format').default('apa'), // apa | ieee | vancouver
  verified: integer('verified').default(0), // DOI 核验 0/1
  createdAt: integer('created_at').notNull(),
});

/** 质量评分报告（7 维，0-100） */
export const qualityReports = sqliteTable('quality_report', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  totalScore: integer('total_score').notNull(),
  scores: text('scores').notNull(), // JSON: {literature,logic,citation,language,novelty,figures,format}
  feedback: text('feedback').default(''), // 改进建议
  createdAt: integer('created_at').notNull(),
});

/** 流水线任务（8 步状态机） */
export const pipelineTasks = sqliteTable('pipeline_task', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  documentId: text('document_id'), // 产物文档（大纲确认后创建）
  topic: text('topic').notNull(),
  currentStep: text('current_step').default(''),
  status: text('status').default('running'), // running | awaiting_confirmation | completed | failed
  steps: text('steps').default('[]'), // JSON: [{key,label,status,output,retryCount}]
  retryCount: integer('retry_count').default(0),
  trace: text('trace').default('[]'), // JSON: ReAct 轨迹 [{round,thought,action,observation}]
  lastError: text('last_error').default(''),
  // 流水线 Research 阶段跨库检索增强：
  // researchNotice —— 跨库（文献库+知识库）命中 0 时的结构化引导文案，命中>0 时为 null（前端可读）
  researchNotice: text('research_notice'),
  // researchMeta —— 命中>0 时持久化的跨库命中摘要 JSON：{ lib:[{title,score}], kn:PaperHit[] }，供产物参考文献块回标来源/匹配度
  researchMeta: text('research_meta').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 润色/改写记录（原文 + 润色文 + 理由） */
export const polishRecords = sqliteTable('polish_record', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  type: text('type').notNull(), // polish | translate | reduce
  original: text('original').notNull(),
  polished: text('polished').notNull(),
  reason: text('reason').default(''),
  createdAt: integer('created_at').notNull(),
});

/** 知识库文档（NotebookLM 式 RAG：上传的资料原文） */
export const knowledgeDocs = sqliteTable('knowledge_doc', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  type: text('type').default('text'), // text | pdf | markdown
  chunkCount: integer('chunk_count').default(0),
  // 文献库↔知识库打通（#5）：可空外键，指向同项目 reference.id；不强绑，可手动绑定/解除
  referenceId: text('reference_id'),
  createdAt: integer('created_at').notNull(),
});

/** 知识库分块（检索单元；context=Contextual Retrieval 文档上下文前缀，vector=TF 向量 JSON） */
export const knowledgeChunks = sqliteTable('knowledge_chunk', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull(),
  content: text('content').notNull(),
  seq: integer('seq').default(0),
  context: text('context').default(''), // 文档级上下文描述（检索时拼在块前，+35-50% 精度）
  vector: text('vector').default('[]'), // JSON: 归一化 TF 向量 {term: weight}
  embedding: blob('embedding'), // sqlite-vec 向量（float32[] 序列化 BLOB，vec0 虚拟表外部存储）
});

export type Project = typeof projects.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type QualityReport = typeof qualityReports.$inferSelect;
export type PipelineTask = typeof pipelineTasks.$inferSelect;
export type PolishRecord = typeof polishRecords.$inferSelect;
export type KnowledgeDoc = typeof knowledgeDocs.$inferSelect;
/** Reflexion 反思日志（质量门回炉的语义梯度，注入下一轮起草） */
export const reflexionLogs = sqliteTable('reflexion_log', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  round: integer('round').default(1),
  note: text('note').notNull(),
  instructions: text('instructions').default('[]'), // JSON: string[]
  createdAt: integer('created_at').notNull(),
});

/** 记忆库（Phase 2：情景记忆 episodic / 程序记忆 procedural） */
export const memoryLogs = sqliteTable('memory_log', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // episodic | procedural
  projectId: text('project_id'),
  content: text('content').notNull(),
  keywords: text('keywords').default('[]'), // JSON: string[]
  createdAt: integer('created_at').notNull(),
});

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type ReflexionLog = typeof reflexionLogs.$inferSelect;
export type MemoryLog = typeof memoryLogs.$inferSelect;

/** 模型厂商（可插拔多模型：OpenAI/DeepSeek/通义/豆包/Agnes 等，LiteLLM 式） */
export const modelProviders = sqliteTable('model_provider', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').default(''),
  model: text('model').notNull(),
  isActive: integer('is_active').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type ModelProvider = typeof modelProviders.$inferSelect;

/** 外部 MCP 服务器（工具生态互通：可接入任意 MCP 兼容服务） */
export const mcpServers = sqliteTable('mcp_server', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  enabled: integer('enabled').default(1),
  createdAt: integer('created_at').notNull(),
});

export type McpServer = typeof mcpServers.$inferSelect;

/** LLM 调用日志（token 成本追踪：每一次补全/流式调用的用量审计） */
export const customIntents = sqliteTable('custom_intent', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  route: text('route').notNull(),
  keywords: text('keywords').notNull(),
  enabled: integer('enabled').default(1),
  isCustom: integer('is_custom').default(1),
  createdAt: integer('created_at').notNull(),
});

export const pipelineConfigs = sqliteTable('pipeline_config', {
  stepKey: text('step_key').primaryKey(),
  enabled: integer('enabled').default(1),
  stepOrder: integer('step_order').default(0),
});

export const appSettings = sqliteTable('app_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const customPrompts = sqliteTable('custom_prompt', {
  id: text('id').primaryKey(),
  toolKey: text('tool_key').notNull().unique(),
  toolLabel: text('tool_label').notNull(),
  prompt: text('prompt').notNull(),
  enabled: integer('enabled').default(1),
  updatedAt: integer('updated_at').notNull(),
});

export const llmCallLogs = sqliteTable('llm_call_log', {
  id: text('id').primaryKey(),
  caller: text('caller').default('general'), // 调用方标识（pipeline/chat/orchestrator 等）
  /** 记录类型：llm=模型调用（计入 token 成本）；tool=工具调用（只计次数/耗时，无 token） */
  kind: text('kind').default('llm'),
  model: text('model').default(''),
  promptTokens: integer('prompt_tokens').default(0),
  completionTokens: integer('completion_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  latencyMs: integer('latency_ms').default(0),
  success: integer('success').default(1),
  error: text('error').default(''),
  createdAt: integer('created_at').notNull(),
});

export type LlmCallLog = typeof llmCallLogs.$inferSelect;

/** 系统综述·筛选队列（题录筛选：纳入/排除/待定） */
export const screeningQueue = sqliteTable('screening_queue', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  referenceId: text('reference_id').notNull(),
  status: text('status').default('pending'), // pending | included | excluded | uncertain
  reason: text('reason').default(''),
  reviewer: text('reviewer').default('me'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 系统综述·文献编码抽取字段（一列一个编码维度） */
export const extractionFields = sqliteTable('extraction_field', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  key: text('key').notNull(), // 小写字母数字下划线，项目内唯一
  label: text('label').notNull(),
  kind: text('kind').default('text'), // text | select
  options: text('options').default('[]'), // JSON: string[]
  createdAt: integer('created_at').notNull(),
});

/** 系统综述·抽取值（field × reference 交叉单元格） */
export const extractionValues = sqliteTable('extraction_value', {
  id: text('id').primaryKey(),
  fieldId: text('field_id').notNull(),
  referenceId: text('reference_id').notNull(),
  value: text('value').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 审稿意见闭环（按文档逐条记录） */
export const reviewComments = sqliteTable('review_comment', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull(),
  reviewer: text('reviewer').notNull(),
  commentText: text('comment_text').notNull(),
  category: text('category').default(''),
  status: text('status').default('open'), // open | resolved | deferred
  responseText: text('response_text').default(''),
  sectionRef: text('section_ref').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 自建期刊库（全局共享，不随项目级联删除） */
export const journals = sqliteTable('journal', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  issn: text('issn').default(''),
  publisher: text('publisher').default(''),
  scopeText: text('scope_text').default(''),
  if2024: real('if2024'), // REAL NULL（不确定指标一律 NULL，禁止编造）
  quartile: text('quartile').default(''),
  firstDecisionWeeks: integer('first_decision_weeks'),
  acceptanceRate: real('acceptance_rate'), // REAL NULL
  oa: text('oa').default(''),
  createdAt: integer('created_at').notNull(),
});

export type ScreeningQueue = typeof screeningQueue.$inferSelect;
export type ExtractionField = typeof extractionFields.$inferSelect;
export type ExtractionValue = typeof extractionValues.$inferSelect;
export type ReviewCommentRow = typeof reviewComments.$inferSelect;
export type Journal = typeof journals.$inferSelect;

/** 投稿流程状态机：13 个统一状态码（见投稿跟踪调研 §2.2） */
export const SUBMISSION_STATUSES = [
  'submitted',       // 收稿/已投稿
  'initial_review',  // 初审中
  'external_review', // 外审中
  'review_returned', // 外审意见已回
  'minor_revision',  // 小修
  'major_revision',  // 大修
  're_review',       // 复审中
  'final_review',    // 终审中
  'accepted',        // 已录用
  'in_production',   // 编辑加工/待见刊
  'rejected',        // 退稿（终态）
  'withdrawn',       // 主动撤稿（终态）
  'transferred',     // 转投他刊
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** 投稿记录（一条 = 一次投向某刊） */
export const submissions = sqliteTable('submission', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  documentId: text('document_id').default(''), // 可选：关联 sciflow 里的论文文档
  journalId: text('journal_id').default(''), // 可选：关联 journal 表（拿 firstDecisionWeeks）
  journalName: text('journal_name').notNull(), // 冗余存名，未入期刊库也能记
  manuscriptNo: text('manuscript_no').default(''), // 稿号（编辑部给的编号）
  title: text('title').default(''), // 稿件标题（冗余，便于列表显示）
  submittedAt: integer('submitted_at'), // 投稿日期（核心，驱动超期推断）
  currentStatus: text('current_status').default('submitted'), // 当前状态码
  statusUpdatedAt: integer('status_updated_at'), // 当前状态最近变更时间
  revisionDeadline: integer('revision_deadline'), // 修回/缴费截止（来自邮件）
  previousSubmissionId: text('previous_submission_id').default(''), // 转投他刊时指回旧记录
  source: text('source').default('manual'), // manual | email_ai
  notes: text('notes').default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** 投稿状态历史流水（append-only；submissions.currentStatus 为最新 event 的冗余缓存） */
export const submissionStatusEvents = sqliteTable('submission_status_event', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull(),
  fromStatus: text('from_status').default(''), // 变更前状态
  toStatus: text('to_status').notNull(), // 变更后状态
  eventAt: integer('event_at').notNull(), // 该状态实际发生日期（可早于录入时间）
  source: text('source').default('manual'), // manual | email_ai | system
  rawEmailText: text('raw_email_text').default(''), // 若来自邮件，存原文片段（可追溯/可重解析）
  confidence: real('confidence').default(1), // 邮件解析置信度；手动=1
  note: text('note').default(''),
  createdAt: integer('created_at').notNull(), // 录入时间
});

export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmissionStatusEventRow = typeof submissionStatusEvents.$inferSelect;

/** 轻量实验沙箱：本机 python3 执行记录（单用户本地威胁模型，临时目录+超时+进程组强杀） */
export const experiments = sqliteTable('experiment', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  documentId: text('document_id'), // 可空：关联到具体论文草稿
  goal: text('goal').default(''), // 实验目的/假设
  code: text('code').notNull(), // 用户提交的 python 源码
  stdout: text('stdout').default(''), // 截断后标准输出（≤64KB）
  stderr: text('stderr').default(''), // 截断后标准错误（≤64KB）
  stdoutTruncated: integer('stdout_truncated').default(0),
  stderrTruncated: integer('stderr_truncated').default(0),
  figures: text('figures').default('[]'), // JSON: string[] matplotlib 产出的 png（base64 data URL）
  conclusion: text('conclusion').default(''), // 实验结论（人工回填）
  runtimeMs: integer('runtime_ms').default(0),
  status: text('status').default('ok'), // ok | error | timeout
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type Experiment = typeof experiments.$inferSelect;

/** F3 实验设计助手：AI 结构化实验设计稿（变量表/对照组/功效提示/流程/分析计划），一个项目多份 */
export const researchDesigns = sqliteTable('research_design', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  question: text('question').notNull(), // 研究问题原文
  design: text('design').notNull(), // JSON: ExperimentDesign 结构
  createdAt: integer('created_at').notNull(),
});

export type ResearchDesign = typeof researchDesigns.$inferSelect;

/** 用户（企业认证 · AUTH_MODE=jwt 时启用；本地/桌面模式 AUTH_MODE=none 不强制登录） */
export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').default(''),
  role: text('role').default('member'), // admin | member | viewer（首位注册用户自动 admin）
  createdAt: integer('created_at').notNull(),
});

export type User = typeof users.$inferSelect;

/** Agent 执行轨迹（对标 Cursor/Cline 调用链追踪 + OpenHands 面板）。 */
export const agentExecutions = sqliteTable('agent_execution', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  /** 触发来源：chat | pipeline | tool | cron */
  source: text('source').notNull(),
  /** 用户原始输入 */
  input: text('input').default(''),
  /** 最终输出摘要 */
  outputSummary: text('output_summary').default(''),
  /** 总耗时 ms */
  durationMs: integer('duration_ms').default(0),
  /** 总 token 用量（prompt + completion） */
  totalTokens: integer('total_tokens').default(0),
  /** 状态：running | done | error | cancelled */
  status: text('status').default('running'),
  /** 错误信息（若有） */
  error: text('error').default(''),
  /** 使用的模型 */
  model: text('model').default(''),
  createdAt: integer('created_at').notNull(),
});

export type AgentExecution = typeof agentExecutions.$inferSelect;

/** Agent 执行步骤（单次 AgentRun 内的每一步 tool/LLM 调用） */
export const agentSteps = sqliteTable('agent_step', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  /** 步骤序号（运行时顺序） */
  seq: integer('seq').notNull(),
  /** 步骤类型：llm | tool | search | retrieve | thinking */
  kind: text('kind').notNull(),
  /** 步骤名称/摘要 */
  title: text('title').default(''),
  /** 输入内容（截断 ≤16KB） */
  input: text('input').default(''),
  /** 输出内容（截断 ≤16KB） */
  output: text('output').default(''),
  /** 耗时 ms */
  durationMs: integer('duration_ms').default(0),
  /** token 用量 */
  tokens: integer('tokens').default(0),
  /** 工具名称（kind=tool 时） */
  toolName: text('tool_name').default(''),
  /** 状态：ok | error */
  status: text('status').default('ok'),
  /** 错误信息 */
  error: text('error').default(''),
  createdAt: integer('created_at').notNull(),
});

export type AgentStep = typeof agentSteps.$inferSelect;

/** Web 搜索缓存（对标 Cursor @Web / Mistral 联网搜索） */
export const webSearchCache = sqliteTable('web_search_cache', {
  id: text('id').primaryKey(),
  /** 查询语句（规范化后作缓存 key） */
  query: text('query').notNull(),
  /** 来源引擎 */
  engine: text('engine').default('duckduckgo'),
  /** 结果 JSON */
  results: text('results').default('[]'),
  /** 命中次数 */
  hitCount: integer('hit_count').default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type WebSearchCache = typeof webSearchCache.$inferSelect;

/** 对话会话摘要（跨会话记忆注入：新对话启动时自动注入最近 N 轮摘要作为上下文，对标 Cursor 长上下文） */
export const chatSessions = sqliteTable('chat_session', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  /** 摘要内容（≤500 字） */
  summary: text('summary').default(''),
  /** 本轮对话消息数（不含 system） */
  messageCount: integer('message_count').notNull(),
  /** 本轮 token 用量 */
  totalTokens: integer('total_tokens').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type ChatSession = typeof chatSessions.$inferSelect;
