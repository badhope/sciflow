import type { Experiment } from '../types';
import { request } from './core';

/** 长篇写作（百万字级）：书 → 卷 → 章 */
export interface LongformBookSummary {
  id: string;
  projectId: string;
  title: string;
  premise: string;
  styleHint: string;
  targetCharsPerChapter: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface LongformChapter {
  id: string;
  bookId: string;
  volumeId: string;
  seq: number;
  title: string;
  goal: string;
  beats: string;
  entities: string;
  content: string;
  summary: string;
  chars: number;
  status: 'pending' | 'writing' | 'done' | 'failed' | string;
  error: string;
  createdAt: number;
  updatedAt: number;
}

export interface LongformVolume {
  id: string;
  bookId: string;
  seq: number;
  title: string;
  goal: string;
  createdAt: number;
}

export interface LongformBookDetail extends LongformBookSummary {
  volumes: LongformVolume[];
  chapters: LongformChapter[];
  stats: { total: number; done: number; pending: number; failed: number; chars: number };
}

export interface LongformWriteResult {
  done: boolean;
  chapter: { id: string; seq: number; title: string; chars: number } | null;
  stats: LongformBookDetail['stats'];
  error?: string;
  failedSeq?: number;
}

export const longform = {
  list: (projectId: string) => request<LongformBookSummary[]>(`/api/longform/books?projectId=${encodeURIComponent(projectId)}`),
  create: (body: { projectId: string; title: string; premise?: string; styleHint?: string; targetCharsPerChapter?: number }) =>
    request<LongformBookDetail>('/api/longform/books', { method: 'POST', body: JSON.stringify(body) }),
  get: (id: string) => request<LongformBookDetail>(`/api/longform/books/${id}`),
  addVolume: (id: string, body: { title: string; goal?: string; chapters: number }) =>
    request<LongformBookDetail>(`/api/longform/books/${id}/volumes`, { method: 'POST', body: JSON.stringify(body) }),
  writeNext: (id: string, body: { retryFailed?: boolean } = {}) =>
    request<LongformWriteResult>(`/api/longform/books/${id}/write-next`, { method: 'POST', body: JSON.stringify(body) }),
  write: (id: string, count: number) =>
    request<{ stopped: boolean; written: { seq: number; title: string; chars: number }[]; stats: LongformBookDetail['stats']; allDone: boolean; error?: string }>(
      `/api/longform/books/${id}/write`,
      { method: 'POST', body: JSON.stringify({ count }) },
    ),
  compile: (id: string) =>
    request<{ title: string; chapters: number; chars: number; markdown: string }>(`/api/longform/books/${id}/compile`),
};

export type { Experiment };
