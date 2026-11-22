import type { components } from './api/openapi-types';

/**
 * 项目：类型来自 OpenAPI 生成 contract（ProjectDto）。
 * 不再手写第二份字段；新增字段先在 server DTO 声明。
 */
export type Project = components['schemas']['ProjectDto'];

/** 项目级评审标准（服务端 ProjectQualityStandardDto；未生成 OpenAPI 前先手写同形）。 */
export interface ProjectQualityStandard {
  key: 'draft' | 'standard' | 'strict' | 'review' | 'conference';
  label: string;
  passScore: number;
  minChars: number;
  minSections: number;
  minUniqueCitations: number;
  source: 'project' | 'global' | 'fallback';
}

/**
 * 项目级研究 Brief：研究问题 / 范围 / 方法 / 约束 / 成功标准（Agent 每轮读取）。
 * 类型来自 OpenAPI 生成 contract（NestJS DTO），不再手写第二份。
 */
export type ResearchBrief = components['schemas']['ResearchBriefDto'];
export type ResearchBriefPatch = components['schemas']['ResearchBriefPatchDto'];

/** 自主科研对象（阶段 2） */
export interface ResearchProgram {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  domain: string;
  autonomyLevel: string;
  status: string;
  constraints: Record<string, unknown>;
  successCriteria: unknown[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchCycle {
  id: string;
  programId: string;
  seq: number;
  state: string;
  objective: string;
  summary: string;
  budget: Record<string, unknown>;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchQuestion {
  id: string;
  programId: string;
  cycleId: string | null;
  question: string;
  scope: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchProgramDetail extends ResearchProgram {
  cycles: ResearchCycle[];
  questions: ResearchQuestion[];
}

export interface ResearchHypothesis {
  id: string;
  programId: string;
  questionId: string;
  statement: string;
  rationale: string;
  predictions: unknown[];
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchProtocol {
  id: string;
  programId: string;
  hypothesisId: string;
  version: number;
  design: Record<string, unknown>;
  status: string;
  approvedBy: string;
  approvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchEvidence {
  id: string;
  programId: string;
  claimId: string;
  sourceType: string;
  sourceId: string;
  quote: string;
  stance: string;
  strength: number;
  verified: number;
  createdBy: string;
  createdAt: number;
}

export interface ResearchClaim {
  id: string;
  programId: string;
  cycleId: string | null;
  protocolId: string | null;
  statement: string;
  confidence: number;
  status: string;
  scope: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResearchRun {
  id: string;
  programId: string;
  cycleId: string | null;
  protocolId: string | null;
  experimentId: string;
  status: string;
  manifest: Record<string, unknown>;
  summary: string;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * 文档：类型来自 OpenAPI 生成 contract（DocDto）。
 * 写作/质量/投稿/实验共用同一字段源，后端新增字段先改 DocDto。
 */
export type Doc = components['schemas']['DocDto'];

export interface OutlineSection {
  title: string;
  subsections: string[];
}
export interface Outline {
  title: string;
  sections: OutlineSection[];
}

/**
 * 文献：类型来自 OpenAPI 生成 contract（ReferenceDto）。
 * 文献库、写作引用、投稿选刊共用同一字段源。
 */
export type Reference = components['schemas']['ReferenceDto'];

/** 学术库发现检索的结果（未入库：无 id/projectId/createdAt，需走导入接口才成为 Reference） */
export type DiscoveredReference = {
  title: string;
  authors?: string[] | string;
  year?: number | null;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  citationCount?: number;
  source?: string;
};

/** 学术发现检索结果：含三源可达性，前端据此区分「没搜到」与「网络不可达」 */
export type ReferenceDiscoverResult = components['schemas']['ReferenceDiscoverDto'];
export type NoveltyCheckResult = components['schemas']['NoveltyCheckDto'];

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
  /** 兼容字段：门禁分（新报告=客观分；拆分前的历史行=LLM 分） */
  totalScore: number;
  /** 原始 JSON 字符串（/api/quality 列表）或已解析对象（/api/quality/latest 等）——取值统一走 jsonText */
  scores: string | Record<string, number>;
  /** 确定性客观检查分（门禁口径；拆分前的历史行为 null） */
  objectiveScore?: number | null;
  /** 客观检查维度明细 */
  objectiveDimensions?: string | ObjectiveQualityDimension[];
  /** LLM 参考总分（不参与门禁；历史行回填为当时的 totalScore） */
  llmScore?: number | null;
  /** LLM 七维分项 */
  llmScores?: string | Record<string, number>;
  /** 专家审核分（预留） */
  expertScore?: number | null;
  expertStatus?: string;
  /** split=客观/LLM 已分列；llm-legacy=拆分前老数据（只有 LLM 分） */
  scoreSource?: 'split' | 'llm-legacy';
  feedback: string;
  createdAt: number;
}

/** 客观质量检查器（确定性规则引擎）单维度报告 */
export interface ObjectiveQualityDimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  evidence: string[];
}

/** 客观质量检查器 API 响应外壳（report 内才是五维报告） */
export interface ObjectiveAuditResponse {
  documentId: string;
  title: string;
  report: ObjectiveQualityReport;
  llmHistory: { totalScore: number; createdAt: number; scores: string | Record<string, number> }[];
}

/** 项目质量总览：类型来自 OpenAPI 生成 contract（ProjectQualityOverviewDto）。 */
export type ProjectQualityOverview = components['schemas']['ProjectQualityOverviewDto'];

/** 单篇质量条目：从总览契约的数组元素派生，不另写一份。 */
export type ProjectQualityOverviewItem = ProjectQualityOverview['items'][number];

/** GET /api/documents/:id/objective-audit 的 report 字段 —— 同一文本必然同分同指纹 */
export interface ObjectiveQualityReport {
  totalScore: number;
  dimensions: ObjectiveQualityDimension[];
  hardFails: string[];
  stats: {
    chars: number;
    cjkChars: number;
    englishWords: number;
    sections: number;
    paragraphs: number;
    sentences: number;
    citations: number;
    referenceEntries: number;
    uniqueCitations: number;
    avgSentenceChars: number;
    duplicateParagraphs: number;
    placeholderHits: number;
    boilerplateHits?: number;
    maxSectionShare?: number;
  };
  fingerprint: string;
  standard?: { key: string; label: string; passScore: number };
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

/** 厂商协议（主流三选一） */
export type ModelProtocol = 'openai-compatible' | 'anthropic-messages' | 'google-gemini';

/** 检测到的模型条目（/models 元数据） */
export interface DiscoveredModel {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutput?: number;
  toolCalling?: boolean;
  ownedBy?: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: ModelProtocol;
  contextWindow: number;
  maxOutput: number;
  toolCalling: number;
  models: DiscoveredModel[];
  isActive: number;
  createdAt: number;
}

/** 检测模型响应 */
export interface ModelDiscoveryResult {
  ok: boolean;
  models: DiscoveredModel[];
  error?: string;
  endpoint?: string;
}

/** 连接测试响应 */
export interface ProviderTestResult {
  ok: boolean;
  reply: string;
  model: string;
  latencyMs: number;
}

/** 本地推荐模型（设置页「本地模型」目录项 + 实时状态） */
export interface LocalModelInfo {
  id: string;
  name: string;
  vendor: string;
  params: string;
  contextWindow: number;
  runtimeContextWindow: number;
  maxOutput: number;
  license: string;
  quantization: string;
  sizeBytes: number;
  sha256: string;
  fileName: string;
  ollamaName: string;
  description: string;
  highlights: string[];
  note?: string;
  recommended?: boolean;
  toolCalling: boolean;
  sources: { label: string; url: string }[];
  installed: boolean;
  downloadedBytes: number;
  status: 'idle' | 'downloading' | 'verifying' | 'installed' | 'error' | 'cancelled';
  error?: string;
  speedBps: number;
  filePath: string;
  providerName?: string;
}

/** 本地模型导入结果：失败用 code 区分下一步动作 */
export interface LocalModelInstallResult {
  ok: boolean;
  code?: 'NOT_DOWNLOADED' | 'OLLAMA_NOT_RUNNING' | 'OLLAMA_CREATE_FAILED' | 'PROVIDER_FAILED';
  message?: string;
  providerId?: string;
  ollamaModel?: string;
}

/** 本机 Ollama 探测结果 */
export interface OllamaStatus {
  ok: boolean;
  models?: number;
  error?: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  enabled: number;
  createdAt: number;
}

/** 角色与技能：自定义系统提示词 + 技能启停（对标 Dify/Coze 人设管理） */
export interface PersonaSkill {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: number;
  builtin: number;
}
export interface PersonaConfig {
  name: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  skills: PersonaSkill[];
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
  /** 跨块上下文起止序号（0 起；旧数据只有 chunkSeq 时前端回退到单块） */
  chunkStartSeq?: number;
  chunkEndSeq?: number;
  chunkCount?: number;
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
  chunkStartSeq?: number;
  chunkEndSeq?: number;
  chunkCount?: number;
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
  /** contextChunks > 0 时返回跨块 passage 的起止序号与块数 */
  startSeq?: number;
  endSeq?: number;
  chunkCount?: number;
  matchedChunkIds?: string[];
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

/** 研究计划确定性审计（零 LLM；不替代论文质量评分） */
export type PlanAuditSeverity = 'blocker' | 'warning' | 'info';
export type PlanAuditCategory =
  | 'sample'
  | 'timeline'
  | 'construct'
  | 'measurement'
  | 'novelty'
  | 'journal'
  | 'references'
  | 'terminology';
export interface PlanAuditFinding {
  id: string;
  severity: PlanAuditSeverity;
  category: PlanAuditCategory;
  message: string;
  evidence?: string;
  suggestion: string;
}
export interface PlanAuditMetrics {
  t1Target?: number;
  pairedTarget?: number;
  attritionPct?: number;
  t1Weeks?: string;
  t2Weeks?: string;
  gapWeeks?: number;
  lagWeeks?: number;
}
export interface PlanAuditResult {
  ok: boolean;
  title: string;
  chars: number;
  score: number;
  blockers: number;
  warnings: number;
  findings: PlanAuditFinding[];
  metrics: PlanAuditMetrics;
  summary: string;
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
  ai: {
    baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean; models: string[];
    /** true = 未配置强模型，PI/评审/长文实际在用 fast（质量瓶颈信号） */
    strongModelFallback?: boolean;
    protocol: ModelProtocol; contextWindow: number; maxOutput: number; toolCalling: boolean;
  };
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
  /** 语义召回分数（仅带 q 查询时由后端返回；列表接口为 0） */
  score?: number;
  /** semantic | lexical | hybrid | recent */
  match?: 'semantic' | 'lexical' | 'hybrid' | 'recent';
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
  /** 段落级锚点：选中的原文与正文偏移；旧数据/无锚点为空 */
  quote: string;
  anchorStart: number | null;
  anchorEnd: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 自建期刊库：类型来自 OpenAPI 生成 contract（JournalDto）。 */
export type Journal = components['schemas']['JournalDto'];

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
/** Web 项目沙箱记录：类型来自 OpenAPI 生成 contract（WebProjectDto）。 */
export type WebProject = components['schemas']['WebProjectDto'];

/**
 * 实验记录：类型来自 OpenAPI 生成 contract（ExperimentDto）。
 * 实验页与写作页实验回流共用。
 */
export type Experiment = components['schemas']['ExperimentDto'];

/* =====================================================================
 * 投稿流程状态跟踪（13 状态码 + 事件流 + 周期推断）
 * ===================================================================== */

/**
 * 投稿状态：类型来自 OpenAPI 生成 contract（SubmissionTrackDto.currentStatus 枚举）。
 * 13 个状态码单一来源为后端 SUBMISSION_STATUSES。
 */
export type SubmissionStatus = components['schemas']['SubmissionTrackDto']['currentStatus'];

/** 投稿状态历史事件：类型来自 OpenAPI 生成 contract（SubmissionStatusEventDto）。 */
export type SubmissionStatusEvent = components['schemas']['SubmissionStatusEventDto'];

/** 一条投稿记录（含事件流 + L3 推断字段）：类型来自 OpenAPI 生成 contract。 */
export type SubmissionTrack = components['schemas']['SubmissionTrackDto'];

/** 投稿就绪检查（确定性，不调模型）：类型来自 OpenAPI 生成 contract。 */
export type SubmissionReadiness = components['schemas']['SubmissionReadinessDto'];

/** 投稿包（DOCX + BibTeX + 清单 + manifest）：类型来自 OpenAPI 生成 contract。 */
export type SubmissionPackage = components['schemas']['SubmissionPackageDto'];

/** 内置投稿排版模板（服务端 SUBMISSION_TEMPLATES）。 */
export interface SubmissionTemplate {
  key: 'generic' | 'ieee' | 'elsevier' | 'springer' | 'nature';
  label: string;
  note: string;
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
/** 引用网络节点：类型来自 OpenAPI 生成 contract（ReferenceGraphNodeDto）。 */
export type GraphNode = components['schemas']['ReferenceGraphNodeDto'];

/** 引用网络边：类型来自 OpenAPI 生成 contract（ReferenceGraphEdgeDto）。 */
export type GraphEdge = components['schemas']['ReferenceGraphEdgeDto'];

/** 引用网络聚合：类型来自 OpenAPI 生成 contract（ReferenceGraphDto）。 */
export type ReferenceGraph = components['schemas']['ReferenceGraphDto'];

/** BibTeX 导入结果 */
export interface BibtexImportResult {
  imported: number;
  skipped: number;
  total: number;
}

/* =====================================================================
 * 连贯连通：Dashboard 全链路总览聚合（GET /api/dashboard/overview）
 * ===================================================================== */

/** 驾驶舱总览：类型来自 OpenAPI 生成 contract（DashboardOverviewDto）。 */
export type DashboardOverview = components['schemas']['DashboardOverviewDto'];

/** 超期投稿卡点：从总览契约的数组元素派生，不另写一份。 */
export type OverdueSubmissionItem = DashboardOverview['overdueSubmissions'][number];

/** 低分文档卡点：从总览契约的数组元素派生，不另写一份。 */
export type LowQualityDocItem = DashboardOverview['lowQualityDocs'][number];

/** B-4.3 引用体检结果（/api/documents/:id/citation-audit） */
export interface CitationAudit {
  anchorTotal: number;
  maxAnchor: number;
  citationRows: number;
  verifiedCount: number;
  noDoi: number;
  ghost: number;
  score: number;
  /** v1.9 新增（可选，兼容旧后端） */
  missingAnchors?: number[];
  uncitedCount?: number;
  duplicateDoi?: string[];
  /** 面向用户的文案（历史字段） */
  issues: string[];
  /** 结构化明细（分级着色与定位） */
  details?: { level: 'red' | 'yellow' | 'info'; code: string; message: string; items?: (string | number)[] }[];
}

/** B-5.2 网搜 provider 配置（/api/web/config；key 掩码回显，保存时传新值） */
export interface WebSearchConfig {
  provider: 'duckduckgo' | 'so360' | 'searxng' | 'tavily' | 'serper' | 'brave';
  searxngUrl?: string;
  tavilyKey?: string;
  serperKey?: string;
  braveKey?: string;
  chatFallback?: boolean;
  available?: { duckduckgo: boolean; so360: boolean; searxng: boolean; tavily: boolean; serper: boolean; brave: boolean };
}

/** 配置中心：权限档 */
export type PermissionMode = 'strict' | 'balanced' | 'open' | 'unrestricted';
export interface PermissionModeInfo { value: PermissionMode; label: string; description: string }
export interface CoreProtectedItem { key: string; label: string; reason: string }
export interface PermissionInfo { mode: PermissionMode; modes: PermissionModeInfo[]; coreProtected: CoreProtectedItem[] }

export interface ConfigRole {
  id: string; name: string; systemPrompt: string; isDefault: number; enabled: number; createdAt: number; updatedAt: number;
}
export interface ConfigConstraint {
  id: string; title: string; rule: string; level: 'must' | 'must_not' | 'should'; scope: 'all' | 'chat' | 'pipeline' | 'writing';
  enabled: number; sortOrder: number; source: string; createdAt: number; updatedAt: number;
}
export interface ConfigHook {
  id: string; name: string; event: 'chat:before' | 'chat:after' | 'pipeline:before' | 'pipeline:after';
  type: 'prompt_inject' | 'block' | 'webhook'; config: string; enabled: number; priority: number; createdAt: number; updatedAt: number;
}
export interface ConfigAuditEntry {
  id: string; actor: string; category: string; action: string; target: string; detail: string; allowed: number; reason: string; createdAt: number;
}
export interface ConfigPresetSummary { id: string; name: string; description: string; constraints: number; hooks: number }
export interface ConfigSnapshot {
  permission: PermissionInfo;
  roles: ConfigRole[];
  constraints: ConfigConstraint[];
  hooks: ConfigHook[];
  presets: ConfigPresetSummary[];
  audit: ConfigAuditEntry[];
  defaults: number;
}
export interface ConfigPreview { scope: 'chat' | 'pipeline' | 'writing'; text: string; role: ConfigRole | null }

/** 扩展中心（v1.4） */
export type ExtensionKind = 'skill' | 'mcp' | 'role' | 'constraint' | 'hook' | 'prompt';
export interface ExtensionAsset {
  id: string;
  key: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  source: 'builtin-public' | 'builtin-private' | 'user' | 'import' | string;
  repo: string;
  license: string;
  install: string;
  tags: string;
  manifest: string;
  enabled: number;
  visibility: 'public' | 'private' | string;
  createdAt: number;
  updatedAt: number;
}
export interface ExtensionTemplate {
  kind: ExtensionKind;
  fields: { key: string; label: string; required: boolean; example?: string }[];
  jsonExample: Record<string, unknown>;
}
export interface ExtensionKindsResponse {
  kinds: { value: ExtensionKind; label: string; description: string; total: number; enabled: number }[];
  assets: ExtensionAsset[];
  templates: ExtensionTemplate[];
}
export interface ExtensionImportResult { added: number; updated: number; assets: ExtensionAsset[]; errors: string[] }


/** 修改计划执行队列（单文档保留最近 20 队历史） */
export interface RevisionQueueItem {
  id: string;
  planItemId: string;
  sectionTitle: string;
  reviewPoints: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  error: string;
  before: string;
  after: string;
  changed: boolean;
  reviewCommentId: string;
  commentResolved: boolean;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface RevisionQueue {
  id: string;
  documentId: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'stopped';
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  autoResolve: boolean;
  resolvedCommentIds: string[];
  items: RevisionQueueItem[];
}

export interface RevisionQueueSummary {
  id: string;
  documentId: string;
  status: RevisionQueue['status'];
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
  changed: number;
  resolvedComments: number;
  autoResolve: boolean;
}

export interface RevisionQueueInput {
  planItemId?: string;
  sectionTitle?: string;
  reviewPoints?: string;
  excerpt?: string;
  suggestedAction?: string;
  reviewCommentId?: string;
}
