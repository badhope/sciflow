import type { components } from './openapi-types';
import { request } from './core';

/**
 * Agent 执行追踪（GET /api/agent/*）：
 * 后端记录每个项目 Agent 的执行历史（流水线/多智能体编排），供前端观测
 * 执行列表、单次步骤链与 Token 用量走势。本地/企业模式均可访问。
 */

export type AgentExecution = components['schemas']['AgentExecutionDto'];
export type AgentStep = components['schemas']['AgentStepDto'];
export type AgentRunDetail = components['schemas']['AgentRunDetailDto'];

/** Token 用量点：类型来自 OpenAPI 生成 contract（TokenUsagePointDto）。 */
export type TokenUsagePoint = components['schemas']['TokenUsagePointDto'];


export type TaskItem = components['schemas']['TaskItemDto'];
export type TaskSummary = components['schemas']['TaskSummaryDto'];
export type AgentPlanItem = components['schemas']['AgentPlanDto'];
export type ApprovalItem = components['schemas']['AgentApprovalDto'];

/** Agent 指标 v0（工具调用 + run 状态聚合） */
/** Agent 指标：类型来自 OpenAPI 生成 contract（AgentMetricsDto）。 */
export type AgentMetrics = components['schemas']['AgentMetricsDto'];

export interface BackgroundJob {
  id: string;
  projectId: string;
  sessionKey: string;
  message: string;
  model: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  output: string;
  error: string;
  runId: string;
  totalTokens: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type AgentTriggerType = 'time' | 'reference.created' | 'pipeline.completed' | 'quality.threshold' | 'experiment.failed';
export type AgentNotifyChannel = 'inapp' | 'browser' | 'feishu';

export interface AgentNotification {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: number;
  dedupeKey: string | null;
  createdAt: number;
}

export interface AgentSchedule {
  id: string;
  projectId: string;
  name: string;
  cadence: 'once' | 'hourly' | 'daily' | 'weekly';
  minuteOfHour: number;
  hourOfDay: number;
  weekday: number;
  message: string;
  sessionKey: string;
  model: string;
  enabled: number;
  lastRunAt: number | null;
  nextRunAt: number;
  triggerType: AgentTriggerType;
  triggerConfig: string;
  notifyChannels: string;
  notifyTarget: string | null;
  lastStatus: string | null;
  createdAt: number;
  updatedAt: number;
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

  /** 研究计划列表 */
  plans: (projectId: string) =>
    request<{ plans: AgentPlanItem[] }>(`/api/agent/plans?projectId=${encodeURIComponent(projectId)}`),

  /** 批准 / 拒绝研究计划 */
  decidePlan: (id: string, approved: boolean) =>
    request<{ plan: AgentPlanItem }>(`/api/agent/plans/${id}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    }),

  /** Agent 指标（项目级 run 指标 + 实例级工具指标） */
  metrics: (projectId: string, days = 7) =>
    request<AgentMetrics>(`/api/agent/metrics?days=${days}&projectId=${encodeURIComponent(projectId)}`),

  /** 批准或拒绝 */
  decideApproval: (id: string, approved: boolean) =>
    request<{ approval: ApprovalItem }>(`/api/agent/approvals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    }),

  /** 后台多会话执行器：入队后立即返回，服务端继续跑 */
  startBackground: (body: { projectId: string; message: string; sessionKey?: string; model?: string }) =>
    request<BackgroundJob>('/api/chat/background', { method: 'POST', body: JSON.stringify(body) }),
  backgroundJobs: (projectId: string, limit = 20) =>
    request<{ jobs: BackgroundJob[] }>(`/api/chat/background?projectId=${encodeURIComponent(projectId)}&limit=${limit}`),
  backgroundJob: (id: string) => request<BackgroundJob>(`/api/chat/background/${id}`),
  cancelBackground: (id: string) =>
    request<BackgroundJob>(`/api/chat/background/${id}/cancel`, { method: 'POST' }),

  schedules: (projectId: string) =>
    request<{ schedules: AgentSchedule[] }>(`/api/schedules?projectId=${encodeURIComponent(projectId)}`),
  createSchedule: (body: {
    projectId: string; name: string; cadence: 'once' | 'hourly' | 'daily' | 'weekly';
    message: string; minuteOfHour?: number; hourOfDay?: number; weekday?: number; delayMinutes?: number;
    model?: string;
    triggerType?: AgentTriggerType;
    triggerConfig?: Record<string, unknown>;
    notifyChannels?: AgentNotifyChannel[];
    notifyTarget?: string;
  }) => request<AgentSchedule>('/api/schedules', { method: 'POST', body: JSON.stringify(body) }),
  updateSchedule: (id: string, projectId: string, body: {
    enabled?: boolean; message?: string; name?: string;
    triggerType?: AgentTriggerType; triggerConfig?: Record<string, unknown>;
    notifyChannels?: AgentNotifyChannel[]; notifyTarget?: string;
  }) =>
    request<AgentSchedule>(`/api/schedules/${id}?projectId=${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSchedule: (id: string, projectId: string) =>
    request<{ deleted: boolean }>(`/api/schedules/${id}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  runSchedule: (id: string, projectId: string) =>
    request<{ job: BackgroundJob }>(`/api/schedules/${id}/run?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }),

  /** 自动化通知收件箱（站内信） */
  notifications: (projectId: string, limit = 20) =>
    request<{ notifications: AgentNotification[]; unread: number }>(`/api/agent/notifications?projectId=${encodeURIComponent(projectId)}&limit=${limit}`),
  markNotificationRead: (id: string, projectId: string) =>
    request<{ ok: boolean }>(`/api/agent/notifications/${id}/read?projectId=${encodeURIComponent(projectId)}`, { method: 'PATCH' }),
  markAllNotificationsRead: (projectId: string) =>
    request<{ ok: boolean }>('/api/agent/notifications/read-all', { method: 'POST', body: JSON.stringify({ projectId }) }),
  retryNotification: (id: string, projectId: string) =>
    request<{ ok: boolean }>(`/api/agent/notifications/${id}/retry`, { method: 'POST', body: JSON.stringify({ projectId }) }),
};
