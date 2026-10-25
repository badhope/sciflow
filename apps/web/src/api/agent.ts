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

export const agent = {
  /** 项目 Agent 执行历史列表 */
  executions: (projectId: string, limit = 20) =>
    request<{ executions: AgentExecution[] }>(`/api/agent/executions?projectId=${projectId}&limit=${limit}`),
  /** 单次执行详情（含步骤链） */
  getRun: (id: string) => request<AgentRunDetail>(`/api/agent/runs/${id}`),
  /** Token 用量走势（按日聚合） */
  usageTrend: (projectId: string, days = 14) =>
    request<{ trend: TokenUsagePoint[] }>(`/api/agent/usage?projectId=${projectId}&days=${days}`),
};
