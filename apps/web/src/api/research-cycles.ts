import type { ResearchClaim, ResearchCycle, ResearchProtocol, ResearchRun } from '../types';
import { request } from './core';

/**
 * 自主研究循环 API（阶段 3+）。
 * 循环由服务端 LangGraph 驱动，前端只负责「发起 / 轮询 / 审批 / 恢复」。
 */
export interface ResearchCycleStatus extends ResearchCycle {
  program: { id: string; title: string; autonomyLevel: string };
  claims: ResearchClaim[];
  runs: ResearchRun[];
  protocols: ResearchProtocol[];
  tokensSpent: number;
}

export const researchCycles = {
  start: (
    programId: string,
    body: { question?: string; maxIterations?: number; maxTokens?: number; approvalMode?: 'human' | 'ai' },
  ) =>
    request<ResearchCycleStatus>('/api/research-cycles/start', {
      method: 'POST',
      body: JSON.stringify({ programId, ...body }),
    }),
  resume: (cycleId: string, body: { approved?: boolean }) =>
    request<ResearchCycleStatus>(`/api/research-cycles/${cycleId}/resume`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  status: (cycleId: string) => request<ResearchCycleStatus>(`/api/research-cycles/${cycleId}`),
  list: (programId: string) =>
    request<ResearchCycle[]>(`/api/research-cycles?programId=${encodeURIComponent(programId)}`),
};
