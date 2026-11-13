import type {
  ResearchClaim,
  ResearchCycle,
  ResearchEvidence,
  ResearchHypothesis,
  ResearchProgram,
  ResearchProgramDetail,
  ResearchProtocol,
  ResearchQuestion,
  ResearchRun,
} from '../types';
import { request } from './core';

/** 自主科研对象 API（阶段 2）：Program → Cycle → Question → Claim / Run */
export const programs = {
  list: (projectId: string) =>
    request<ResearchProgram[]>(`/api/programs?projectId=${encodeURIComponent(projectId)}`),
  create: (projectId: string, body: { title: string; goal?: string; domain?: string; autonomyLevel?: string }) =>
    request<ResearchProgram>('/api/programs', {
      method: 'POST',
      body: JSON.stringify({ projectId, ...body }),
    }),
  get: (id: string) => request<ResearchProgramDetail>(`/api/programs/${id}`),
  createCycle: (programId: string, body: { objective?: string; budget?: unknown; state?: string }) =>
    request<ResearchCycle>(`/api/programs/${programId}/cycles`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createQuestion: (programId: string, body: { question: string; scope?: string; cycleId?: string }) =>
    request<ResearchQuestion>(`/api/programs/${programId}/questions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listProgramProtocols: (programId: string) =>
    request<ResearchProtocol[]>(`/api/programs/${programId}/protocols`),
  listHypotheses: (questionId: string) =>
    request<ResearchHypothesis[]>(`/api/programs/questions/${questionId}/hypotheses`),
  createHypothesis: (questionId: string, body: { statement: string; rationale?: string; predictions?: unknown }) =>
    request<ResearchHypothesis>(`/api/programs/questions/${questionId}/hypotheses`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listProtocols: (hypothesisId: string) =>
    request<ResearchProtocol[]>(`/api/programs/hypotheses/${hypothesisId}/protocols`),
  createProtocol: (hypothesisId: string, body: { design?: unknown; status?: string }) =>
    request<ResearchProtocol>(`/api/programs/hypotheses/${hypothesisId}/protocols`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveProtocol: (protocolId: string) =>
    request<ResearchProtocol>(`/api/programs/protocols/${protocolId}/approve`, { method: 'POST' }),
  listClaims: (programId: string) =>
    request<ResearchClaim[]>(`/api/programs/${programId}/claims`),
  createClaim: (
    programId: string,
    body: { statement: string; cycleId?: string; protocolId?: string; confidence?: number; status?: string; scope?: string },
  ) =>
    request<ResearchClaim>(`/api/programs/${programId}/claims`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listEvidence: (claimId: string) =>
    request<ResearchEvidence[]>(`/api/programs/claims/${claimId}/evidence`),
  addEvidence: (
    claimId: string,
    body: { sourceType: string; sourceId?: string; quote?: string; stance?: string; strength?: number; verified?: boolean },
  ) =>
    request<ResearchEvidence>(`/api/programs/claims/${claimId}/evidence`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  verifyEvidence: (evidenceId: string, verified: boolean) =>
    request<ResearchEvidence>(`/api/programs/evidence/${evidenceId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ verified }),
    }),
  listRuns: (programId: string) =>
    request<ResearchRun[]>(`/api/programs/${programId}/runs`),
  createRun: (
    programId: string,
    body: { cycleId?: string; protocolId?: string; experimentId?: string; status?: string; manifest?: unknown; summary?: string; startedAt?: number; endedAt?: number },
  ) =>
    request<ResearchRun>(`/api/programs/${programId}/runs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateRun: (
    runId: string,
    body: { status?: string; manifest?: unknown; summary?: string; experimentId?: string; startedAt?: number; endedAt?: number },
  ) =>
    request<ResearchRun>(`/api/programs/runs/${runId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
