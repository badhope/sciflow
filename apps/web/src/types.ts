export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  /** 项目级系统提示（差距#22：写作偏好，每轮注入；仅字符串） */
  preface?: string;
  /** 差距#1：自定义大纲模板持久化（JSON 字符串，PATCH /api/projects/:id 写入；GET/list 返回） */
  templates?: string;
}

export interface Doc {
  id: string;
  projectId: string;
  title: string;
  content: string;
  outline: string;
  version: number;
  versions: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface OutlineSection {
  title: string;
  subsections: string[];
}
export interface Outline {
  title: string;
  sections: OutlineSection[];
}

export interface Reference {
  id: string;
  projectId: string;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: string;
  tags: string;
  citationCount: number;
  createdAt: number;
  /** 科研高级功能扩展字段（后端返回） */
  readingStatus?: 'unread' | 'reading' | 'read' | 'cited';
  /** 阅读笔记（差距#11：读后想法，可本地编辑落库） */
  notes?: string;
  fingerprint?: string;
  isDuplicateOf?: string;
}

/** 文献录入入参（authors 兼容数组与 JSON 字符串两种形态） */
export type ReferenceInput = {
  title: string;
  authors?: string[] | string;
  year?: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  source?: string;
  citationCount?: number;
};

export interface CitationRow {
  id: string;
  documentId: string;
  referenceId: string;
  location: string;
  context: string;
  format: string;
  verified: number;
  createdAt: number;
  reference: Reference;
}

/** 支持的 8 种引用样式（与前端 WritingPage CITE_STYLES 一致） */
export type CiteStyle = 'apa' | 'ieee' | 'vancouver' | 'gbt' | 'nature' | 'chicago' | 'springer' | 'acs';

/** POST /api/documents/:id/render-citations 响应：纯函数渲染预览，永不落库（前端确认后自行覆盖保存 content） */
export interface RenderCitationsResult {
  /** 重排后的正文（著者-年样式把 [n] 换成 (作者, 年)；序号样式原样） */
  content: string;
  /** 文末参考文献条目（序号样式按插入序；著者-年样式按作者姓字母序） */
  references: string[];
  style: CiteStyle;
  /** 序号样式恒 false；著者-年样式发生正文重排为 true */
  changed: boolean;
}

/** versions JSON 历史元素（本轮起可选携带 name） */
export interface DocVersionEntry {
  version: number;
  content: string;
  updatedAt: number;
  name?: string;
}

export interface QualityReport {
  id: string;
  documentId: string;
  totalScore: number;
  /** 原始 JSON 字符串（/api/quality 列表）或已解析对象（/api/quality/latest 等）——取值统一走 jsonText */
  scores: string | Record<string, number>;
  feedback: string;
  createdAt: number;
}

export interface PipelineStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'awaiting_confirmation' | 'done' | 'scored' | 'retry' | 'failed' | 'skipped';
  output?: string;
  retryCount: number;
  /** F2 反共识大纲变体（outline 步骤 awaiting_confirmation 时有值）：Outline JSON 串数组 */
  variants?: string[];
  /** F-2.7 时间线：步骤起止毫秒时间戳 */
  startedAt?: number;
  endedAt?: number;
}

/** F3 实验设计助手：结构化实验设计稿 */
export interface ExperimentDesign {
  objective: string;
  variables: { independent: string[]; dependent: string[]; controlled: string[] };
  groups: { name: string; role: string; description: string }[];
  sampleHint: string;
  procedure: string[];
  analysisPlan: string[];
  risks: string[];
}

export interface ExperimentDesignRecord {
  id: string;
  question: string;
  design: ExperimentDesign;
  createdAt: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: number;
  createdAt: number;
}

export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  enabled: number;
  createdAt: number;
}

export interface ReactTraceStep {
  round: number;
  thought: string;
  action: string;
  query: string;
  found: number;
}

export interface PipelineTask {
  id: string;
  projectId: string;
  documentId: string | null;
  topic: string;
  currentStep: string;
  // interrupted：后端 checkpoint 在服务重启时对前半段中断任务的标记（无产物文档，不自动续跑）
  status: 'running' | 'awaiting_confirmation' | 'completed' | 'failed' | 'interrupted';
  steps: PipelineStep[];
  retryCount: number;
  trace: string; // JSON: ReactTraceStep[]
  lastError: string;
  createdAt: number;
  updatedAt: number;
}

export interface PolishRecord {
  id: string;
  documentId: string;
  type: string;
  original: string;
  polished: string;
  reason: string;
  createdAt: number;
}

/** 知识库文档绑定的文献摘要（文献库↔知识库打通 #5，list/bind 响应内嵌） */
export interface KnowledgeRefSummary {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
  /** 差距#2：绑定文献作者串（后端未返回时前端容错为空不显示） */
  authors?: string;
}

export interface KnowledgeDoc {
  id: string;
  projectId: string;
  name: string;
  type: string;
  chunkCount: number;
  /** 可空外键：绑定的文献 id（#5） */
  referenceId: string | null;
  /** 绑定文献的摘要，未绑定时为 null */
  reference: KnowledgeRefSummary | null;
  createdAt: number;
}

export interface KnowledgeSource {
  docName: string;
  snippet: string;
  score: number;
  /** RAG 引用可点（#17）：块 id + 完整块文本，前端"展开原文" */
  chunkId: string;
  chunkText: string;
  /** 命中块在所属文档内的分块序号（0 起，来源卡片显示 分块 seq+1） */
  chunkSeq: number;
  /** 命中块绑定的文献（#5） */
  referenceId: string | null;
  referenceTitle: string | null;
  /** 差距#2：绑定文献作者/年份（SSE/检索未下发时前端容错为空不显示） */
  referenceAuthors?: string | null;
  referenceYear?: number | null;
}

export interface KnowledgeQueryResult {
  answer: string;
  sources: KnowledgeSource[];
}

/** Chat SSE 首事件来源（/api/chat/stream 的 sources 数组元素）。
 *  旧字段 docName/score 保留；chunkText/chunkSeq/referenceId/referenceTitle 为本轮新增附加，与 KnowledgeSource 对齐。 */
export interface ChatSource {
  docName: string;
  score: number;
  /** 完整命中块文本（来源卡片"展开原文"） */
  chunkText: string;
  /** 命中块在所属知识库文档内的分块序号（0 起） */
  chunkSeq: number;
  referenceId: string | null;
  referenceTitle: string | null;
  /** 差距#2：绑定文献作者/年份（SSE 未下发时前端容错为空不显示） */
  referenceAuthors?: string | null;
  referenceYear?: number | null;
}

/** 学习复盘取数（GET /api/knowledge/:id）：单文档全部分块正文（按 seq 升序） */
export interface KnowledgeChunkDetail {
  id: string;
  seq: number;
  content: string;
}

/** GET /api/knowledge/:id 响应：文档元信息 + chunks + outline（Markdown 标题派生，无标题为 null） */
export interface KnowledgeDocDetail extends KnowledgeDoc {
  chunks: KnowledgeChunkDetail[];
  outline: string | null;
}

/** POST /api/knowledge/search：纯检索命中块（BM25+向量，不调 LLM，与 query 的 sources 同源字段） */
export interface KnowledgeSearchHit {
  id: string;
  docId: string;
  content: string;
  seq: number;
  context: string;
  docName: string;
  score: number;
  referenceId: string | null;
  referenceTitle: string | null;
}


export interface ExtractedPaper {
  ref: string;
  title: string;
  year: number;
  method: string;
  results: string;
  contribution: string;
  limitations: string;
}

export interface EvidenceStance {
  claim: string;
  stance: string;
  count: number;
  refs: string[];
  note: string;
}

export interface CustomIntent {
  id: string;
  key: string;
  label: string;
  route: string;
  keywords: string;
  enabled: number;
  isCustom: number;
  createdAt: number;
}

export interface CustomPromptTool {
  toolKey: string;
  toolLabel: string;
  prompt: string;
  enabled: number;
  customized: boolean;
}

export interface PipelineStepConfig {
  key: string;
  label: string;
  core: boolean;
  /** 是否允许在设置页启停（骨架步骤为 false） */
  configurable: boolean;
  enabled: number;
  customized: boolean;
}

export interface QualityWeightItem {
  key: string;
  label: string;
  weight: number;
}

export interface IntentResult {
  intent: string;
  label: string;
  confidence: number;
  topic: string;
  route: string;
  matchedBy: 'rule' | 'llm';
}

export interface ResearchDesignResult {
  noveltyScore: number;
  noveltyFeedback: string;
  feasibilityScore: number;
  feasibilityFeedback: string;
  methods: string[];
  risks: string[];
  nextSteps: string[];
  paperCount: number;
}

export interface PaperComparisonResult {
  summary: string;
  rows: { paper: string; 研究问题: string; 方法: string; 主要结论: string; 局限: string }[];
}

export interface SimulatedReviewResult {
  reviewers: { role: string; score: number; strengths: string[]; concerns: string[]; suggestion: string }[];
  verdict: string;
  overall: string;
}

export interface DeepDiveResult {
  title: string;
  oneLine: string;
  researchQuestion: string;
  motivation: string;
  method: string;
  keyFindings: string[];
  limitations: string[];
  futureWork: string;
  takeaway: string;
}

export interface GapResult {
  gaps: { gap: string; evidence: string; opportunity: string; feasibility: string }[];
  recommendedTopic: string;
}

export interface EvidenceResult {
  summary: string;
  stances: EvidenceStance[];
}

export interface AppSettings {
  ai: { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean; models: string[] };
  env: { node: string; database: string; port: number };
  sources: { literature: string[] };
}

export interface SelfCheck {
  database: { ok: boolean; path: string };
  ai: { configured: boolean; ok: boolean; model: string; latencyMs: number; detail: string };
  /** 检索栈能力（向量 / 嵌入模型 / 全文索引）与降级原因 */
  retrieval?: { vector: boolean; embeddingModel: boolean; fullText: boolean; ok: boolean; notes: string[] };
  timestamp: number;
}

export interface MemoryItem {
  id: string;
  type: 'episodic' | 'procedural';
  projectId: string | null;
  content: string;
  keywords: string[];
  createdAt: number;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/* =====================================================================
 * 科研高级功能契约类型（系统综述 / 审稿闭环 / 期刊库）
 * 与后端 B1 实现的 API 一一对应，前端页面按此消费
 * ===================================================================== */

/** 系统综述·筛选队列条目（join reference 元数据） */
export interface ScreeningItem {
  id: string;
  projectId: string;
  referenceId: string;
  status: 'pending' | 'included' | 'excluded' | 'uncertain';
  reason: string;
  reviewer: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  year: number | null;
  venue: string;
  authors: string;
}

/** 系统综述·文献编码抽取字段 */
export interface ExtractionField {
  id: string;
  projectId: string;
  key: string;
  label: string;
  kind: 'text' | 'select';
  options: string[];
  createdAt: number;
}

/** 系统综述·抽取表（跨文献编码矩阵） */
export interface ExtractionTableResult {
  fields: ExtractionField[];
  rows: { referenceId: string; title: string; year: number | null; venue: string; values: Record<string, string> }[];
}

/** 审稿意见闭环 */
export interface ReviewComment {
  id: string;
  documentId: string;
  reviewer: string;
  commentText: string;
  category: string;
  status: 'open' | 'resolved' | 'deferred';
  responseText: string;
  sectionRef: string;
  createdAt: number;
  updatedAt: number;
}

/** 自建期刊库 */
export interface Journal {
  id: string;
  name: string;
  issn: string;
  publisher: string;
  scopeText: string;
  if2024: number | null;
  quartile: string;
  firstDecisionWeeks: number | null;
  acceptanceRate: number | null;
  oa: string;
  createdAt: number;
}

/** 期刊匹配推荐结果（结构化） */
export interface JournalMatchItem {
  name: string;
  score: number;
  reason: string;
  gap: string;
  isInLibrary: boolean;
  if2024: number | null;
  quartile: string;
  firstDecisionWeeks: number | null;
  acceptanceRate: number | null;
  oa: string;
}

export interface JournalMatchResult {
  journals: JournalMatchItem[];
}

/** 轻量实验沙箱：本机 python3 执行记录 */
export interface Experiment {
  id: string;
  projectId: string;
  documentId: string | null;
  goal: string;
  code: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  /** matplotlib 产出的 png（base64 data URL） */
  figures: string[];
  conclusion: string;
  runtimeMs: number;
  status: 'ok' | 'error' | 'timeout';
  /** 运行时字段（不入库）：本次执行是否启用了 /proc RSS 内存监控 */
  memoryMonitored?: boolean;
  createdAt: number;
  updatedAt: number;
}

/* =====================================================================
 * 投稿流程状态跟踪（13 状态码 + 事件流 + 周期推断）
 * ===================================================================== */

/** 13 个统一状态码（后端 SUBMISSION_STATUSES） */
export type SubmissionStatus =
  | 'submitted'
  | 'initial_review'
  | 'external_review'
  | 'review_returned'
  | 'minor_revision'
  | 'major_revision'
  | 're_review'
  | 'final_review'
  | 'accepted'
  | 'in_production'
  | 'rejected'
  | 'withdrawn'
  | 'transferred';

/** 投稿状态历史事件（append-only 流水） */
export interface SubmissionStatusEvent {
  id: string;
  submissionId: string;
  fromStatus: string;
  toStatus: string;
  eventAt: number;
  source: string; // manual | email_ai | system
  rawEmailText: string;
  confidence: number;
  note: string;
  createdAt: number;
}

/** 一条投稿记录（含全部事件 + L3 推断字段） */
export interface SubmissionTrack {
  id: string;
  projectId: string;
  documentId: string;
  journalId: string;
  journalName: string;
  manuscriptNo: string;
  title: string;
  submittedAt: number | null;
  currentStatus: SubmissionStatus;
  statusUpdatedAt: number | null;
  revisionDeadline: number | null;
  previousSubmissionId: string;
  source: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  events: SubmissionStatusEvent[];
  /** L3 周期推断（journal.firstDecisionWeeks 存在时才有值） */
  dueAt: number | null;
  overdue: boolean;
  overdueDays: number;
  estimatedStage: SubmissionStatus | null;
}

/** AI 解析编辑部邮件的建议（不改库，用户确认后走 event 端点） */
export interface ParseEmailResult {
  suggestedStatus: SubmissionStatus;
  confidence: number;
  reason: string;
  date?: string;
}

/* =====================================================================
 * 引用网络图 + BibTeX/RIS 导入导出
 * ===================================================================== */

/** 引用网络节点（后端聚合，供前端力导向布局） */
export interface GraphNode {
  id: string;
  title: string;
  year: number | null;
  venue: string;
  citationCount: number;
  tags: string[];
  readingStatus?: string;
  isDuplicateOf?: string;
}

/** 引用网络边：a/b 为节点 id，weight=共引文档数（dup 边固定高亮） */
export interface GraphEdge {
  a: string;
  b: string;
  weight: number;
  type?: 'co-cite' | 'dup';
}

export interface ReferenceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** BibTeX 导入结果 */
export interface BibtexImportResult {
  imported: number;
  skipped: number;
  total: number;
}

/* =====================================================================
 * 连贯连通：Dashboard 全链路总览聚合（GET /api/dashboard/overview）
 * ===================================================================== */

/** 超期投稿卡点条目（后端 join 投稿记录） */
export interface OverdueSubmissionItem {
  id: string;
  journalName: string;
  title: string;
  status: string;
  overdueDays: number;
}

/** 低分文档卡点条目（后端取最新一次 QualityReport） */
export interface LowQualityDocItem {
  id: string;
  title: string;
  score: number;
  date: number;
}

/** 科研全链路总览（待办计数 + 卡点列表；后端未就绪时前端优雅降级为 null） */
export interface DashboardOverview {
  pendingOutline: number;
  overdueSubmissions: OverdueSubmissionItem[];
  openReviewComments: number;
  lowQualityDocs: LowQualityDocItem[];
  experimentCount: number;
  docCount: number;
  refCount: number;
}

/** B-4.3 引用体检结果（/api/documents/:id/citation-audit） */
export interface CitationAudit {
  anchorTotal: number;
  maxAnchor: number;
  citationRows: number;
  verifiedCount: number;
  noDoi: number;
  ghost: number;
  score: number;
  issues: string[];
}

/** B-5.2 网搜 provider 配置（/api/web/config；key 掩码回显，保存时传新值） */
export interface WebSearchConfig {
  provider: 'duckduckgo' | 'searxng' | 'tavily' | 'serper' | 'brave';
  searxngUrl?: string;
  tavilyKey?: string;
  serperKey?: string;
  braveKey?: string;
  chatFallback?: boolean;
  available?: { duckduckgo: boolean; searxng: boolean; tavily: boolean; serper: boolean; brave: boolean };
}
