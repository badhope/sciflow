import { request } from './core';

export interface ConnectorStatus { ok: boolean; message: string; checkedAt: number }
export interface ConnectorInfo {
  key: 'zotero' | 'feishu' | 'notion' | 'drive' | 'overleaf';
  name: string;
  type: 'api' | 'sdk' | 'git';
  description: string;
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
  connected: boolean;
  masked: Record<string, string>;
  status: ConnectorStatus | null;
}

export const connectors = {
  list: (projectId: string) => request<{ connectors: ConnectorInfo[] }>(`/api/connectors?projectId=${encodeURIComponent(projectId)}`),
  connect: (projectId: string, key: string, config: Record<string, string>) =>
    request<{ connected: boolean }>('/api/connectors/connect', { method: 'POST', body: JSON.stringify({ projectId, key, config }) }),
  disconnect: (projectId: string, key: string) =>
    request<{ connected: boolean }>('/api/connectors/disconnect', { method: 'POST', body: JSON.stringify({ projectId, key }) }),
  test: (projectId: string, key: string) =>
    request<{ ok: boolean; message: string }>('/api/connectors/test', { method: 'POST', body: JSON.stringify({ projectId, key }) }),
  zoteroImport: (projectId: string, limit = 10) =>
    request<{ fetched: number; added: number; duplicate: number; skipped: number }>('/api/connectors/zotero/import', { method: 'POST', body: JSON.stringify({ projectId, limit }) }),
  feishuNotify: (projectId: string, text: string) =>
    request<{ ok: boolean }>('/api/connectors/feishu/notify', { method: 'POST', body: JSON.stringify({ projectId, text }) }),
  feishuImportDoc: (projectId: string, documentId: string) =>
    request<{ doc: unknown }>('/api/connectors/feishu/import-doc', { method: 'POST', body: JSON.stringify({ projectId, documentId }) }),
  notionSearch: (projectId: string, query: string) =>
    request<{ results: { id: string; type: string; title: string }[] }>('/api/connectors/notion/search', { method: 'POST', body: JSON.stringify({ projectId, query }) }),
  driveList: (projectId: string) =>
    request<{ files: { id?: string | null; name?: string | null; mimeType?: string | null }[] }>('/api/connectors/drive/list', { method: 'POST', body: JSON.stringify({ projectId }) }),
};
