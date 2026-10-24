import type {
  BibtexImportResult,
  CustomIntent,
  CustomPromptTool,
  DeepDiveResult,
  EvidenceResult,
  ExtractedPaper,
  ExtractionField,
  ExtractionTableResult,
  GapResult,
  IntentResult,
  KnowledgeDoc,
  KnowledgeDocDetail,
  KnowledgeQueryResult,
  KnowledgeSearchHit,
  PaperComparisonResult,
  PipelineStepConfig,
  QualityReport,
  QualityWeightItem,
  Reference,
  ReferenceGraph,
  ReferenceInput,
  ExperimentDesignRecord,
  ResearchDesignResult,
  ReviewComment,
  ScreeningItem,
  SimulatedReviewResult,
} from '../types';
import { friendlyError, request, u } from './core';

/** research 域 API（client.ts 按域拆分；barrel 统一导出于 ./client） */
export const research = {
  references: {
    search: (query: string, limit = 8, projectId?: string) =>
      request<Reference[]>(`/api/references/search`, { method: 'POST', body: JSON.stringify({ query, limit, projectId }) }),
    list: (projectId: string) => request<Reference[]>(`/api/references?projectId=${projectId}`),
    create: (projectId: string, hit: ReferenceInput) =>
      request<Reference>('/api/references', { method: 'POST', body: JSON.stringify({ projectId, hit }) }),
    importMany: (projectId: string, hits: ReferenceInput[]) =>
      request<Reference[]>('/api/references/import', { method: 'POST', body: JSON.stringify({ projectId, hits }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/references/${id}`, { method: 'DELETE' }),
    summarize: (projectId: string, topic: string) =>
      request<string>(`/api/references/summarize`, { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    extract: (projectId: string) =>
      request<ExtractedPaper[]>(`/api/references/extract`, { method: 'POST', body: JSON.stringify({ projectId }) }),
    evidence: (projectId: string, question: string) =>
      request<EvidenceResult>(`/api/references/evidence`, { method: 'POST', body: JSON.stringify({ projectId, question }) }),
    deepDive: (projectId: string, refId: string) => request<DeepDiveResult>(`/api/references/deep-dive`, { method: 'POST', body: JSON.stringify({ projectId, refId }) }),
    gap: (projectId: string, topic: string) => request<GapResult>(`/api/references/gap`, { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    /* —— 科研高级功能：阅读状态 / 去重指纹 / 笔记（差距#11） —— */
    update: (id: string, patch: Partial<{ readingStatus: string; tags: string; notes: string | null }>) =>
      request<Reference>(`/api/references/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    /* —— 差距#20：批量 DOI 本地核验（合法置 cited / 非法不动 / 不存在进 skipped，纯本地格式校验不调外部） —— */
    verifyDois: (ids: string[]) =>
      request<{ valid: { id: string }[]; invalid: { id: string }[]; skipped: { id: string }[] }>(
        '/api/references/verify-dois',
        { method: 'POST', body: JSON.stringify({ ids }) },
      ),
    /* —— 系统综述：筛选队列 —— */
    screen: (projectId: string, referenceId: string, status: string, reason = '') =>
      request<ScreeningItem>('/api/references/screen', { method: 'POST', body: JSON.stringify({ projectId, referenceId, status, reason }) }),
    screenBulk: (projectId: string, referenceIds: string[], status: string, reason = '') =>
      request<{ ok: boolean; updated: number }>('/api/references/screen/bulk', { method: 'POST', body: JSON.stringify({ projectId, referenceIds, status, reason }) }),
    screenList: (projectId: string) => request<ScreeningItem[]>(`/api/references/screen?projectId=${projectId}`),
    /* —— 系统综述：文献编码抽取表 —— */
    extractionFields: (projectId: string) => request<ExtractionField[]>(`/api/references/extraction/fields?projectId=${projectId}`),
    addExtractionField: (projectId: string, key: string, label: string, kind = 'text', options: string[] = []) =>
      request<ExtractionField>('/api/references/extraction/fields', { method: 'POST', body: JSON.stringify({ projectId, key, label, kind, options }) }),
    removeExtractionField: (id: string) => request<{ ok: boolean }>(`/api/references/extraction/fields/${id}`, { method: 'DELETE' }),
    setExtractionValue: (fieldId: string, referenceId: string, value: string) =>
      request<{ ok: boolean }>('/api/references/extraction/values', { method: 'PUT', body: JSON.stringify({ fieldId, referenceId, value }) }),
    extractionTable: (projectId: string) => request<ExtractionTableResult>(`/api/references/extraction/table?projectId=${projectId}`),
    /* —— 引用网络图（共引 + 去重边聚合） —— */
    graph: (projectId: string) => request<ReferenceGraph>(`/api/references/graph?projectId=${projectId}`),
    /* —— BibTeX/RIS 导出（纯文本，前端 Blob 下载） —— */
    exportReferences: async (projectId: string, format: 'bibtex' | 'ris'): Promise<string> => {
      const res = await fetch(u(`/api/references/export?projectId=${encodeURIComponent(projectId)}&format=${format}`));
      if (!res.ok) throw new Error(friendlyError(undefined, res.status));
      return res.text();
    },
    /* —— BibTeX 导入（指纹去重，返回 imported/skipped） —— */
    importBibtex: (projectId: string, text: string) =>
      request<BibtexImportResult>('/api/references/import-bibtex', { method: 'POST', body: JSON.stringify({ projectId, text }) }),
    /* —— 引用打通：为某文档幂等添加引用（与 documents.citations 读路径分离写入口） —— */
    addCitation: (body: { documentId: string; referenceId: string; location?: string; context?: string }) =>
      request<{ id?: string; ok?: boolean }>('/api/references/citations', { method: 'POST', body: JSON.stringify(body) }),
  },
  knowledge: {
    list: (projectId: string) => request<KnowledgeDoc[]>(`/api/knowledge?projectId=${projectId}`),
    upload: (projectId: string, name: string, type: string, content: string) =>
      request<KnowledgeDoc>(`/api/knowledge/upload`, { method: 'POST', body: JSON.stringify({ projectId, name, type, content }) }),
    query: (projectId: string, question: string) =>
      request<KnowledgeQueryResult>(`/api/knowledge/query`, { method: 'POST', body: JSON.stringify({ projectId, question }) }),
    /** 学习复盘取数：单文档全部分块正文（按 seq 升序）+ outline（Markdown 标题派生） */
    get: (id: string) => request<KnowledgeDocDetail>(`/api/knowledge/${id}`),
    /** 纯检索（不调 LLM，本地 BM25+向量）：返回命中文块，供来源卡片「引用到论文」/命令面板使用 */
    search: (projectId: string, query: string) =>
      request<KnowledgeSearchHit[]>(`/api/knowledge/search`, { method: 'POST', body: JSON.stringify({ projectId, query }) }),
    /** 文献库↔知识库打通（#5）：绑定/解除文献，referenceId 传 null 解除 */
    bind: (id: string, referenceId: string | null) =>
      request<KnowledgeDoc>(`/api/knowledge/${id}/bind`, { method: 'PATCH', body: JSON.stringify({ referenceId }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/knowledge/${id}`, { method: 'DELETE' }),
    /** 语义地图：分块 embedding 的 2D 投影（F-2.2） */
    semanticMap: (projectId: string, limit = 5000) =>
      request<{
        points: { id: string; docId: string; docName: string; seq: number; x: number; y: number; snippet: string }[];
        total: number;
        sampled: boolean;
        limit: number;
      }>(`/api/knowledge/${projectId}/map?limit=${limit}`),
  },
  research: {
    designReview: (idea: string, papers: { title: string; year?: number | null; venue?: string; abstract?: string }[]) =>
      request<ResearchDesignResult>(`/api/research/design-review`, { method: 'POST', body: JSON.stringify({ idea, papers }) }),
    comparison: (papers: { title: string; year?: number | null; venue?: string; abstract?: string }[]) =>
      request<PaperComparisonResult>(`/api/research/comparison`, { method: 'POST', body: JSON.stringify({ papers }) }),
    review: (title: string, content: string) =>
      request<SimulatedReviewResult>(`/api/research/review`, { method: 'POST', body: JSON.stringify({ title, content }) }),
    /* —— 审稿意见闭环 —— */
    reviewComments: (documentId: string) => request<ReviewComment[]>(`/api/research/review-comments?documentId=${documentId}`),
    addReviewComments: (documentId: string, comments: { reviewer: string; commentText: string; category?: string }[]) =>
      request<ReviewComment[]>('/api/research/review-comments', { method: 'POST', body: JSON.stringify({ documentId, comments }) }),
    updateReviewComment: (id: string, patch: Partial<{ status: string; responseText: string; category: string }>) =>
      request<ReviewComment>(`/api/research/review-comments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeReviewComment: (id: string) => request<{ ok: boolean }>(`/api/research/review-comments/${id}`, { method: 'DELETE' }),
    responseLetter: (documentId: string) =>
      request<{ letter: string }>('/api/research/response-letter', { method: 'POST', body: JSON.stringify({ documentId }) }),
    /** F3 实验设计助手：研究问题 → 结构化设计稿（落库） */
    designExperiment: (projectId: string, question: string, papers: unknown[] = []) =>
      request<ExperimentDesignRecord & { error?: string }>('/api/research/design', { method: 'POST', body: JSON.stringify({ projectId, question, papers }) }),
    listDesigns: (projectId: string) => request<ExperimentDesignRecord[]>(`/api/research/design?projectId=${projectId}`),
    removeDesign: (id: string) => request<{ ok: boolean }>(`/api/research/design/${id}`, { method: 'DELETE' }),
  },
  quality: {
    review: (documentId: string, title: string, content: string) =>
      request<QualityReport>('/api/quality', { method: 'POST', body: JSON.stringify({ documentId, title, content }) }),
    history: (documentId: string) => request<QualityReport[]>(`/api/quality?documentId=${documentId}`),
    /** 最新一次质量评分（无记录时后端返回 null；接口未就绪时前端 catch 降级为空态） */
    latest: (documentId: string) =>
      request<QualityReport | null>(`/api/quality/latest?documentId=${encodeURIComponent(documentId)}`),
    /** 差距#7：把最新 quality_report.feedback 结构化为 review_comment（幂等，返回 created/existing） */
    exportComments: (documentId: string) =>
      request<{ created: number; existing: number }>(`/api/quality/export-comments?documentId=${encodeURIComponent(documentId)}`, { method: 'POST' }),
  },
  judgment: {
    intent: (message: string, context = '') =>
      request<IntentResult>(`/api/judgment/intent`, { method: 'POST', body: JSON.stringify({ message, context }) }),
  },
  customization: {
    listIntents: () => request<CustomIntent[]>('/api/customization/intents'),
    createIntent: (body: { key: string; label: string; route: string; keywords: string[] }) =>
      request<CustomIntent>('/api/customization/intents', { method: 'POST', body: JSON.stringify(body) }),
    updateIntent: (id: string, patch: Partial<{ label: string; route: string; keywords: string[]; enabled: number }>) =>
      request<CustomIntent[]>(`/api/customization/intents/${id}`, { method: 'POST', body: JSON.stringify(patch) }),
    deleteIntent: (id: string) => request<{ ok: boolean }>(`/api/customization/intents/${id}`, { method: 'DELETE' }),
    listPrompts: () => request<CustomPromptTool[]>('/api/customization/prompts'),
    upsertPrompt: (toolKey: string, prompt: string, enabled = 1) =>
      request<CustomPromptTool[]>(`/api/customization/prompts/${toolKey}`, { method: 'POST', body: JSON.stringify({ prompt, enabled }) }),
    deletePrompt: (toolKey: string) => request<{ ok: boolean }>(`/api/customization/prompts/${toolKey}`, { method: 'DELETE' }),
    listPipelineSteps: () => request<PipelineStepConfig[]>('/api/customization/pipeline-steps'),
    updatePipelineStep: (stepKey: string, enabled: number) =>
      request<PipelineStepConfig[]>(`/api/customization/pipeline-steps/${stepKey}`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    resetPipelineSteps: () => request<{ ok: boolean }>('/api/customization/pipeline-steps', { method: 'DELETE' }),
    listQualityWeights: () => request<QualityWeightItem[]>('/api/customization/quality-weights'),
    setQualityWeights: (weights: Record<string, number>) =>
      request<QualityWeightItem[]>('/api/customization/quality-weights', { method: 'POST', body: JSON.stringify({ weights }) }),
    getJudgmentMode: () => request<{ mode: string }>('/api/customization/judgment-mode'),
    setJudgmentMode: (mode: string) => request<{ mode: string }>('/api/customization/judgment-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
    getPipelineSettings: () => request<{ researchDepth: number }>('/api/customization/pipeline-settings'),
    setPipelineSettings: (patch: { researchDepth?: number }) =>
      request<{ researchDepth: number }>('/api/customization/pipeline-settings', { method: 'POST', body: JSON.stringify(patch) }),
  },
};
