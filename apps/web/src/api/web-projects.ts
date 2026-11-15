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
  files: (id: string) => request<{ path: string; bytes: number }[]>(`/api/web-projects/${id}/files`),
  readFile: (id: string, path: string) =>
    request<{ path: string; content: string; bytes: number }>(`/api/web-projects/${id}/file?path=${encodeURIComponent(path)}`),
  writeFile: (id: string, path: string, content: string) =>
    request<{ ok: boolean; path: string; bytes: number }>(`/api/web-projects/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path, content }),
    }),
  removeFile: (id: string, path: string) =>
    request<{ ok: boolean }>(`/api/web-projects/${id}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
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
  /** 网页验收：按断言列表检查并返回逐条通过/失败 */
  verify: (
    id: string,
    checks: {
      type: 'exists' | 'text' | 'count' | 'visible' | 'value' | 'request' | 'no-console-error' | 'visual';
      selector?: string;
      expect?: string | number;
      label?: string;
      urlIncludes?: string;
      baseline?: string;
      maxDiffRatio?: number;
    }[],
  ) =>
    request<{
      url: string; title: string; total: number; passed: number; failed: number; allPassed: boolean;
      results: { label: string; type: string; ok: boolean; actual: string }[];
    }>(`/api/browser/sessions/${id}/verify`, { method: 'POST', body: JSON.stringify({ checks }) }),
  fill: (id: string, selector: string, value: string) =>
    request<{ ok: boolean }>(`/api/browser/sessions/${id}/fill`, { method: 'POST', body: JSON.stringify({ selector, value }) }),
  /** 视觉基线：保存当前页面外观 / 列出 / 删除 */
  baselines: () => request<{ name: string; bytes: number; savedAt: number }[]>('/api/browser/baselines'),
  saveBaseline: (id: string, name: string, fullPage = false) =>
    request<{ ok: boolean; name: string; url: string; width: number; height: number; bytes: number }>(
      `/api/browser/sessions/${id}/baseline`,
      { method: 'POST', body: JSON.stringify({ name, fullPage }) },
    ),
  deleteBaseline: (name: string) => request<{ ok: boolean }>(`/api/browser/baselines/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  /** 视觉回归：当前截图 vs 基线，返回差异比例与差异图 */
  visualDiff: (id: string, name: string, opts: { fullPage?: boolean; maxDiffRatio?: number } = {}) =>
    request<{
      ok: boolean; name: string; url: string;
      expected: { width: number; height: number }; actual: { width: number; height: number };
      sizeMismatch: boolean; diffPixels: number; totalPixels: number; diffRatio: number; threshold: number;
      baselineBytes: number; actualBytes: number; diffDataUrl?: string;
    }>(`/api/browser/sessions/${id}/visual-diff`, { method: 'POST', body: JSON.stringify({ name, ...opts }) }),
};
