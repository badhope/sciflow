import { request } from './core';

export interface ShareLinkInfo {
  id: string;
  token: string;
  title: string;
  path: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt?: number | null;
  revoked?: boolean;
}

export interface PublicShare {
  title: string;
  content: string;
  version: number;
  projectTitle: string;
  createdAt: number;
  expiresAt: number | null;
}

export const shares = {
  create: (body: { projectId: string; targetType: 'document'; targetId: string; expiresInDays?: number }) =>
    request<ShareLinkInfo>('/api/shares', { method: 'POST', body: JSON.stringify(body) }),
  list: (projectId: string) => request<{ shares: ShareLinkInfo[] }>(`/api/shares?projectId=${encodeURIComponent(projectId)}`),
  revoke: (id: string, projectId: string) =>
    request<ShareLinkInfo>(`/api/shares/${id}/revoke?projectId=${encodeURIComponent(projectId)}`, { method: 'POST' }),
  getPublic: (token: string) => request<PublicShare>(`/api/public/shares/${encodeURIComponent(token)}`),
};

export function absoluteShareUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  // 分享页是独立只读路由（RootRoutes 按 pathname 判定），不能拼成 #/share/token：
  // HashRouter 下 location.pathname 仍是 /，会被当成普通页面而不是公开分享页。
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}
