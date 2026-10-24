import type { CitationAudit,
  CitationRow,
  CiteStyle,
  DashboardOverview,
  Doc,
  DocVersionEntry,
  MemoryItem,
  Outline,
  PipelineTask,
  PolishRecord,
  Project,
  RenderCitationsResult,
} from '../types';
import { request } from './core';

/** writing 域 API（client.ts 按域拆分；barrel 统一导出于 ./client） */
export const writing = {
  projects: {
    list: () => request<Project[]>('/api/projects'),
    create: (name: string, description = '') =>
      request<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) }),
    update: (id: string, patch: Partial<Project>) =>
      request<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),
  },
  documents: {
    list: (projectId: string) => request<Doc[]>(`/api/documents?projectId=${projectId}`),
    get: (id: string) => request<Doc>(`/api/documents/${id}`),
    citationAudit: (id: string) => request<CitationAudit>(`/api/documents/${id}/citation-audit`),
    create: (projectId: string, title: string) =>
      request<Doc>('/api/documents', { method: 'POST', body: JSON.stringify({ projectId, title }) }),
    update: (id: string, patch: Partial<Doc>) =>
      request<Doc>(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/documents/${id}`, { method: 'DELETE' }),
    outline: (id: string, topic?: string, summary = '') =>
      request<Outline>(`/api/documents/${id}/outline`, { method: 'POST', body: JSON.stringify({ topic, summary }) }),
    section: (id: string, sectionTitle: string) =>
      request<{ text: string }>(`/api/documents/${id}/section`, { method: 'POST', body: JSON.stringify({ sectionTitle }) }),
    polish: (id: string, text: string, mode: 'polish' | 'reduce') =>
      request<{ original: string; polished: string; reason: string }>(`/api/documents/${id}/polish`, {
        method: 'POST',
        body: JSON.stringify({ text, mode }),
      }),
    translate: (id: string, text: string, targetLang: 'zh' | 'en') =>
      request<{ translated: string }>(`/api/documents/${id}/translate`, {
        method: 'POST',
        body: JSON.stringify({ text, targetLang }),
      }),
    polishRecords: (id: string) => request<PolishRecord[]>(`/api/documents/${id}/polish-records`),
    citations: (id: string) => request<CitationRow[]>(`/api/documents/${id}/citations`),
    addCitation: (id: string, body: { referenceId: string; location?: string; context?: string }) =>
      request<CitationRow>(`/api/documents/${id}/citations`, { method: 'POST', body: JSON.stringify(body) }),
    removeCitation: (id: string, citationId: string) =>
      request<{ ok: boolean }>(`/api/documents/${id}/citations/${citationId}`, { method: 'DELETE' }),
    exportCitations: (id: string, format: string) =>
      request<string[]>(`/api/documents/${id}/export-citations?format=${format}`),
    exportMarkdown: (id: string) =>
      request<{ markdown: string; filename: string }>(`/api/documents/${id}/export`),
    exportDocx: (id: string) =>
      request<{ base64: string; filename: string }>(`/api/documents/${id}/export-docx`),
    abstract: (id: string) => request<{ abstract: string; keywords: string[] }>(`/api/documents/${id}/abstract`, { method: 'POST' }),
    /** 版本命名（PATCH versions JSON 内嵌 name，幂等覆盖；version 不存在/被历史上限淘汰返回 400），返回更新后的 versions 数组 */
    setVersionName: (id: string, version: number, name: string) =>
      request<DocVersionEntry[]>(`/api/documents/${id}/version-name`, { method: 'PATCH', body: JSON.stringify({ version, name }) }),
    /** 按样式渲染正文锚点+参考文献列表（纯函数预览，永不落库；前端确认后自行 PATCH content 覆盖） */
    renderCitations: (id: string, style: CiteStyle, dryRun = true) =>
      request<RenderCitationsResult>(`/api/documents/${id}/render-citations`, { method: 'POST', body: JSON.stringify({ style, dryRun }) }),
  },
  pipeline: {
    create: (projectId: string, topic: string) =>
      request<PipelineTask>('/api/pipeline', { method: 'POST', body: JSON.stringify({ projectId, topic }) }),
    get: (id: string) => request<PipelineTask>(`/api/pipeline/${id}`),
    list: (projectId: string) => request<PipelineTask[]>(`/api/pipeline?projectId=${projectId}`),
    confirmOutline: (id: string, outline?: Outline) =>
      request<PipelineTask>(`/api/pipeline/${id}/confirm-outline`, { method: 'POST', body: JSON.stringify({ outline }) }),
    /** 差距#9a：删除任务记录（DELETE /api/pipeline/:id，后端已就绪；失败/interrupted 任务同样可删） */
    remove: (id: string) => request<{ ok: boolean }>(`/api/pipeline/${id}`, { method: 'DELETE' }),
    /** 停止运行中的任务（POST /api/pipeline/:id/stop；上游挂起时不再只能重启服务） */
    stop: (id: string) => request<PipelineTask>(`/api/pipeline/${id}/stop`, { method: 'POST' }),
  },
  chat: {
    answer: (message: string, history: { role: string; content: string }[] = [], projectId?: string) =>
      request<{ answer: string }>('/api/chat', { method: 'POST', body: JSON.stringify({ message, history, projectId }) }),
    /** 项目最近对话摘要（对话历史侧栏） */
    sessions: (projectId: string) =>
      request<{ sessions: { id: string; summary: string; messageCount: number; totalTokens: number; createdAt: number }[] }>(
        `/api/chat/sessions?projectId=${projectId}`,
      ),
  },
  memory: {
    list: (type?: string, q = '') => request<MemoryItem[]>(`/api/memory?type=${type || ''}&q=${encodeURIComponent(q)}`),
    add: (type: 'episodic' | 'procedural', content: string, projectId?: string, keywords: string[] = []) =>
      request<MemoryItem>('/api/memory', { method: 'POST', body: JSON.stringify({ type, content, projectId, keywords }) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/memory/${id}`, { method: 'DELETE' }),
  },
  dashboard: {
    /** 科研全链路总览（待办计数 + 卡点列表；接口未就绪时前端 catch 降级为小字提示） */
    overview: (projectId?: string) =>
      request<DashboardOverview>(`/api/dashboard/overview${projectId ? `?projectId=${projectId}` : ''}`),
  },
};
