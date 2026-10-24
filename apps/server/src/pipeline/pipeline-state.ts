import type { PaperHit } from '../references/references.service';

// ─── Types shared across graph nodes ─────────────────────────────

/** pipeline_task row shape (drizzle $inferSelect subset) */
export interface PipelineTaskRow {
  id: string;
  projectId: string;
  documentId: string | null;
  topic: string;
  currentStep: string | null;
  status: string | null;
  retryCount: number | null;
  lastError: string | null;
  researchNotice: string | null;
  researchMeta: string | null;
}

export interface OutlineSection {
  title: string;
  subsections?: string[];
}

export interface Outline {
  title: string;
  sections: OutlineSection[];
}

export interface QualityReport {
  totalScore: number;
  feedback: string;
}

export interface ResearchPlan {
  searchStrategy?: { keywords?: string[] };
}

/** ReAct 轨迹条目（落 pipeline_task.trace，前端 ReAct 面板的线上契约；round = 全局步序号） */
export interface ResearchTraceEntry {
  round: number;
  thought: string;
  action: string;
  query: string;
  found: number;
}

/**
 * LangGraph 流水线状态。
 * 各字段由对应 node 写入；reducer 为覆盖式（最后写入者胜）。
 */
export interface PipelineState {
  taskId: string;
  task: PipelineTaskRow;
  verifiedTopic: string;
  plan: ResearchPlan;
  researchTrace: ResearchTraceEntry[];
  enrichedLibHits: PaperHit[];
  enrichedKnHits: PaperHit[];
  researchNotice?: string;
  literatureSummary: string;
  outline?: Outline;
  documentId?: string;
  report?: QualityReport;
}


export type { PaperHit };
