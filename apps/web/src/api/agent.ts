import { request } from './core';

/**
 * Agent 执行追踪（GET /api/agent/*）：
 * 后端记录每个项目 Agent 的执行历史（流水线/多智能体编排），供前端观测
 * 执行列表、单次步骤链与 Token 用量走势。本地/企业模式均可访问。
 */

export interface AgentExecution {
  id: string;
  projectId: string;
  /** 触发来源（pipeline / mcp / manual） */
  source: string;
  /** 执行标签或目标描述 */
  label: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  startedAt: number;
  finishedAt?: number | null;
  totalTokens?: number | null;
}

export interface AgentStep {
  id: string;
  runId: string;
  index: number;
  tool?: string | null;
  summary: string;
  tokens?: number | null;
  status: string;
  createdAt: number;
}

export interface AgentRunDetail extends AgentExecution {
  steps: AgentStep[];
}

export interface TokenUsagePoint {
  date: string;
  tokens: number;
  runs: number;
}


/** 任务清单条目（harness：模型把多步工作显式列出，用户可核进度） */
export interface TaskItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  seq: number;
  group: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  percent: number;
}

/** 工具审批请求（harness：有副作用的操作先问用户） */
export interface ApprovalItem {
  id: string;
  toolName: string;
  args: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  projectId: string | null;
  runId: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export const agent = {
  /** 项目 Agent 执行历史列表 */
  executions: (projectId: string, limit = 20) =>
    request<{ executions: AgentExecution[] }>(`/api/agent/executions?projectId=${projectId}&limit=${limit}`),
  /** 单次执行详情（含步骤链） */
  getRun: (id: string) => request<AgentRunDetail>(`/api/agent/runs/${id}`),
  /** Token 用量走势（按日聚合） */
  usageTrend: (projectId: string, days = 14) =>
    request<{ trend: TokenUsagePoint[] }>(`/api/agent/usage?projectId=${projectId}&days=${days}`),

  /** 任务清单 + 进度摘要 */
  tasks: (projectId?: string, runId?: string) => {
    const qs = new URLSearchParams();
    if (projectId) qs.set('projectId', projectId);
    if (runId) qs.set('runId', runId);
    const q = qs.toString();
    return request<{ tasks: TaskItem[]; summary: TaskSummary }>(`/api/agent/tasks${q ? `?${q}` : ''}`);
  },

  /** 待处理审批 */
  pendingApprovals: (projectId?: string) =>
    request<{ approvals: ApprovalItem[] }>(
      `/api/agent/approvals${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),

  /** 批准或拒绝 */
  decideApproval: (id: string, approved: boolean) =>
    request<{ approval: ApprovalItem }>(`/api/agent/approvals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    }),
};
