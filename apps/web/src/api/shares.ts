import { request } from './core';

export interface ShareLinkInfo {
  id: string;
  token: string;
  title: string;
  targetType: 'document' | 'conversation';
  targetId: string;
  allowComments: boolean;
  path: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt?: number | null;
  revoked?: boolean;
}

export interface PublicComment {
  id: string;
  authorName: string;
  content: string;
  createdAt: number;
}

export interface PublicShare {
  targetType: 'document' | 'conversation';
  title: string;
  content: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  version: number;
  projectTitle: string;
  allowComments: boolean;
  comments: PublicComment[];
  createdAt: number;
  expiresAt: number | null;
}

export const shares = {
  create: (body: { projectId: string; targetType: 'document' | 'conversation'; targetId: string; expiresInDays?: number; allowComments?: boolean }) =>
    request<ShareLinkInfo>('/api/shares', { method: 'POST', body: JSON.stringify(body) }),
  list: (projectId: string) => request<{ shares: ShareLinkInfo[] }>(`/api/shares?projectId=${encodeURIComponent(projectId)}`),
  revoke: (id: string, projectId: string) =>
    request<ShareLinkInfo>(`/api/shares/${id}/revoke?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }),
  getPublic: (token: string) => request<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`),
  addComment: (token: string, body: { authorName?: string; content: string }) =>
    request<PublicComment>(`/api/public/shares/${encodeURIComponent(token)}/comments`, { method: 'POST', body: JSON.stringify(body) }),
  deleteComment: (shareId: string, commentId: string, projectId: string) =>
    request<{ deleted: boolean }>(`/api/shares/${shareId}/comments/${commentId}?projectId=${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
};

export function absoluteShareUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}
