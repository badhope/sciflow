import type { WebProject } from '../types';
import { request } from './core';

/** Web 项目沙箱：独立目录 + npm install/build + 静态预览 */
export const webProjects = {
  templates: () => request<{ key: string; label: string }[]>('/api/web-projects/templates'),
  list: (projectId: string) => request<WebProject[]>(`/api/web-projects?projectId=${encodeURIComponent(projectId)}`),
  create: (body: { projectId: string; name: string; template?: string }) =>
    request<WebProject>('/api/web-projects', { method: 'POST', body: JSON.stringify(body) }),
  get: (id: string) => request<WebProject>(`/api/web-projects/${id}`),
  install: (id: string) => request<{ ok: boolean; log: string }>(`/api/web-projects/${id}/install`, { method: 'POST' }),
  build: (id: string) => request<{ ok: boolean; log: string }>(`/api/web-projects/${id}/build`, { method: 'POST' }),
  preview: (id: string) => request<{ url: string; port: number }>(`/api/web-projects/${id}/preview`, { method: 'POST' }),
  stop: (id: string) => request<{ stopped: boolean }>(`/api/web-projects/${id}/stop`, { method: 'POST' }),
  runAll: (id: string) =>
    request<{ ok: boolean; stage: string; url?: string; error?: string }>(`/api/web-projects/${id}/run-all`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/web-projects/${id}`, { method: 'DELETE' }),
};

/** 内置浏览器（服务端 Chromium） */
export interface BrowserSession {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  lastUsed: number;
  history: { action: string; target: string; at: number; ok: boolean }[];
}

export const browser = {
  list: () => request<BrowserSession[]>('/api/browser/sessions'),
  open: (url: string) => request<BrowserSession>('/api/browser/sessions', { method: 'POST', body: JSON.stringify({ url }) }),
  close: (id: string) => request<{ ok: boolean }>(`/api/browser/sessions/${id}`, { method: 'DELETE' }),
  navigate: (id: string, url: string) =>
    request<BrowserSession>(`/api/browser/sessions/${id}/navigate`, { method: 'POST', body: JSON.stringify({ url }) }),
  text: (id: string, maxChars = 8000) =>
    request<{ url: string; title: string; text: string; truncated: boolean }>(`/api/browser/sessions/${id}/text?maxChars=${maxChars}`),
  screenshot: (id: string, fullPage = false) =>
    request<{ url: string; dataUrl: string }>(`/api/browser/sessions/${id}/screenshot?fullPage=${fullPage ? 1 : 0}`),
  elements: (id: string) =>
    request<{ url: string; elements: { tag: string; text: string; selector: string; type?: string }[] }>(`/api/browser/sessions/${id}/elements`),
  click: (id: string, selector: string) =>
    request<{ ok: boolean }>(`/api/browser/sessions/${id}/click`, { method: 'POST', body: JSON.stringify({ selector }) }),
  fill: (id: string, selector: string, value: string) =>
    request<{ ok: boolean }>(`/api/browser/sessions/${id}/fill`, { method: 'POST', body: JSON.stringify({ selector, value }) }),
};
