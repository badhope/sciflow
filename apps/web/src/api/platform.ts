import type { WebSearchConfig,
  AppSettings,
  ConfigConstraint,
  ConfigHook,
  ConfigPreview,
  ConfigRole,
  ConfigSnapshot,
  PermissionInfo,
  DiscoveredModel,
  ModelDiscoveryResult,
  ModelProtocol,
  ProviderTestResult,
  Experiment,
  Journal,
  JournalMatchResult,
  McpServerInfo,
  McpToolInfo,
  ModelProvider,
  PersonaConfig,
  PersonaSkill,
  ParseEmailResult,
  SelfCheck,
  SubmissionStatus,
  SubmissionTrack,
} from '../types';
import { request, setToken } from './core';

/** platform 域 API（client.ts 按域拆分；barrel 统一导出于 ./client） */
export interface AuditEntry {
  id: string;
  actor: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  allowed: number;
  reason: string;
  createdAt: number;
}

export const platform = {
  health: () => request<{ status: string; time: number; uptime: number; authMode: string; db: boolean; desktop: boolean; ai: { configured: boolean; model: string } }>('/api/health'),

  auth: {
    register: (email: string, password: string, name?: string) =>
      request<{ token: string; user: { id: string; email: string; name: string; role: string } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      }),
    login: (email: string, password: string) =>
      request<{ token: string; user: { id: string; email: string; name: string; role: string } }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ id: string; email: string; name: string; role: string; createdAt: number }>('/api/auth/me'),
    logout: () => setToken(null),
  },
  extensions: {
    list: (kind?: string) => request<import('../types').ExtensionKindsResponse>(`/api/extensions${kind ? `?kind=${kind}` : ''}`),
    create: (p: {
      id?: string; kind: string; key?: string; name: string; description?: string;
      repo?: string; license?: string; install?: string; tags?: string[];
      manifest?: Record<string, unknown>; visibility?: string;
    }) => request<import('../types').ExtensionAsset>('/api/extensions', { method: 'POST', body: JSON.stringify(p) }),
    toggle: (id: string, enabled: boolean) => request<import('../types').ExtensionAsset>(`/api/extensions/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    apply: (id: string) => request<import('../types').ExtensionAsset>(`/api/extensions/${id}/apply`, { method: 'POST' }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/extensions/${id}`, { method: 'DELETE' }),
    resetBuiltin: () => request<{ restored: number }>('/api/extensions/reset-builtin', { method: 'POST' }),
    importRaw: (p: { filename?: string; content: string }) => request<import('../types').ExtensionImportResult>('/api/extensions/import', { method: 'POST', body: JSON.stringify(p) }),
    /**
     * 上传扩展资产。
     *
     * 此前是裸 `fetch('/api/extensions/upload', ...)`，绕过 `u()` 与整套 request() 基建：
     *   - 桌面端页面从 `file://` 加载 → 相对路径解析成 `file:///api/...` → **上传必然失败**
     *     （点了没反应）；
     *   - 不带 Authorization → 企业 JWT 模式下 401；
     *   - 没有错误转译 → 用户看到的是英文原文或裸 HTTP 状态码。
     * 改走 request()：绝对地址、令牌、重试策略、中文错误转译一次到位。
     * FormData 的 Content-Type 由 core.ts 识别并交给 fetch 生成（保住 multipart boundary）。
     */
    upload: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      // 大 bundle 上传可能超过 60s；显式 signal 关掉 core.ts 的默认兜底（与 generate 同处理）
      return request<import('../types').ExtensionImportResult>('/api/extensions/upload', {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(300_000),
      });
    },
    // AI 生成可能耗时 1-3 分钟：显式传 signal 关闭默认 60s 兜底（core.ts 有 signal 时不加超时）
    generate: (kind: string, brief: string) => request<{ draft: Record<string, unknown>; raw: string }>('/api/extensions/generate', {
      method: 'POST',
      body: JSON.stringify({ kind, brief }),
      signal: AbortSignal.timeout(300_000),
    }),
    exportBundle: () => request<Record<string, unknown>>('/api/extensions/export'),
  },
  config: {
    snapshot: () => request<ConfigSnapshot>('/api/config'),
    /** 配置/权限审计流水（谁在何时改了什么、被拒绝的操作及原因） */
    auditLog: (limit = 100) => request<AuditEntry[]>(`/api/config/audit?limit=${limit}`),
    /**
     * Prometheus 文本指标（设置页用于健康面板 + 运维直接 scrape /api/metrics）。
     * 同样改走 request()：修掉桌面端相对路径失效、缺 Authorization，
     * 以及此前**不检查 res.ok** —— 5xx/401 的错误响应体会被当成指标文本直接渲染进面板。
     * request() 对 text/plain 响应按文本原样返回，语义不变。
     */
    metricsText: () => request<string>('/api/metrics'),
    setPermission: (mode: string) => request<PermissionInfo>('/api/config/permission', { method: 'POST', body: JSON.stringify({ mode }) }),
    listRoles: () => request<ConfigRole[]>('/api/config/roles'),
    createRole: (p: { name: string; systemPrompt?: string; isDefault?: boolean }) => request<ConfigRole[]>('/api/config/roles', { method: 'POST', body: JSON.stringify(p) }),
    updateRole: (id: string, p: { name?: string; systemPrompt?: string; isDefault?: boolean; enabled?: number }) => request<ConfigRole[]>(`/api/config/roles/${id}`, { method: 'POST', body: JSON.stringify(p) }),
    deleteRole: (id: string) => request<ConfigRole[]>(`/api/config/roles/${id}`, { method: 'DELETE' }),
    listConstraints: () => request<ConfigConstraint[]>('/api/config/constraints'),
    createConstraint: (p: { title: string; rule: string; level?: string; scope?: string; sortOrder?: number }) => request<ConfigConstraint[]>('/api/config/constraints', { method: 'POST', body: JSON.stringify(p) }),
    updateConstraint: (id: string, p: { title?: string; rule?: string; level?: string; scope?: string; enabled?: number; sortOrder?: number }) => request<ConfigConstraint[]>(`/api/config/constraints/${id}`, { method: 'POST', body: JSON.stringify(p) }),
    deleteConstraint: (id: string) => request<ConfigConstraint[]>(`/api/config/constraints/${id}`, { method: 'DELETE' }),
    listHooks: () => request<ConfigHook[]>('/api/config/hooks'),
    createHook: (p: { name: string; event: string; type: string; config?: unknown; priority?: number }) => request<ConfigHook[]>('/api/config/hooks', { method: 'POST', body: JSON.stringify(p) }),
    updateHook: (id: string, p: { name?: string; event?: string; type?: string; config?: unknown; enabled?: number; priority?: number }) => request<ConfigHook[]>(`/api/config/hooks/${id}`, { method: 'POST', body: JSON.stringify(p) }),
    deleteHook: (id: string) => request<ConfigHook[]>(`/api/config/hooks/${id}`, { method: 'DELETE' }),
    applyPreset: (id: string) => request<ConfigSnapshot>(`/api/config/presets/${id}/apply`, { method: 'POST' }),
    preview: (scope: 'chat' | 'pipeline') => request<ConfigPreview>(`/api/config/preview?scope=${scope}`),
    exportBundle: () => request<Record<string, unknown>>('/api/config/export'),
    importBundle: (bundle: unknown, merge = true) => request<{ ok: boolean; rolesAdded: number; constraintsAdded: number; hooksAdded: number; errors: string[] }>('/api/config/import', { method: 'POST', body: JSON.stringify({ bundle, merge }) }),
  },
  settings: {
    get: () => request<AppSettings>(`/api/settings`),
    check: () => request<SelfCheck>(`/api/settings/check`),
    testModel: (model: string) =>
      request<{ ok: boolean; reply: string; model: string; latencyMs: number }>(`/api/settings/test`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      }),
    listProviders: () => request<ModelProvider[]>(`/api/settings/providers`),
    saveProvider: (p: {
      id?: string; name: string; baseUrl: string; apiKey?: string; model: string;
      protocol?: ModelProtocol; contextWindow?: number; maxOutput?: number; toolCalling?: number;
      models?: DiscoveredModel[];
    }) =>
      request<{ ok: boolean; id: string }>(`/api/settings/providers`, { method: 'POST', body: JSON.stringify(p) }),
    /** 检测模型：表单地址+Key 实时拉取模型目录（不保存） */
    discoverModels: (p: { id?: string; baseUrl: string; apiKey?: string; protocol?: ModelProtocol; privateOk?: boolean }) =>
      request<ModelDiscoveryResult>(`/api/settings/providers/discover`, { method: 'POST', body: JSON.stringify(p) }),
    /** 连接测试：表单当前协议/地址/Key/模型（不保存） */
    testProvider: (p: { id?: string; baseUrl: string; apiKey?: string; protocol?: ModelProtocol; model: string; maxOutput?: number; privateOk?: boolean }) =>
      request<ProviderTestResult>(`/api/settings/providers/test`, { method: 'POST', body: JSON.stringify(p) }),
    removeProvider: (id: string) => request<{ ok: boolean }>(`/api/settings/providers/${id}`, { method: 'DELETE' }),
    activateProvider: (id: string) =>
      request<{ ok: boolean; active: string }>(`/api/settings/providers/${id}/activate`, { method: 'POST' }),
    listMcpServers: () => request<McpServerInfo[]>(`/api/settings/mcp-servers`),
    saveMcpServer: (p: { id?: string; name: string; url: string }) =>
      request<{ ok: boolean; id: string }>(`/api/settings/mcp-servers`, { method: 'POST', body: JSON.stringify(p) }),
    removeMcpServer: (id: string) => request<{ ok: boolean }>(`/api/settings/mcp-servers/${id}`, { method: 'DELETE' }),
    /** 角色与技能（persona + skills）：自定义系统提示词 + 技能启停 */
    getPersona: () => request<PersonaConfig>(`/api/settings/persona`),
    savePersona: (p: { name?: string; systemPrompt?: string; skills?: PersonaSkill[] }) =>
      request<{ ok: boolean } & PersonaConfig>(`/api/settings/persona`, { method: 'POST', body: JSON.stringify(p) }),
    /** Agent 权限档：AI 能读什么、能改什么（默认 workspace，不碰系统配置） */
    getAgentAccess: () =>
      request<{ mode: string; modes: { value: string; label: string; description: string }[] }>(`/api/settings/agent-access`),
    setAgentAccess: (mode: string) =>
      request<{ mode: string; modes: { value: string; label: string; description: string }[] }>(`/api/settings/agent-access`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }),
  },
  webSearchConfig: {
    get: () => request<WebSearchConfig>('/api/web/config'),
    save: (p: Partial<WebSearchConfig>) => request<{ ok: boolean; config?: WebSearchConfig; error?: string }>('/api/web/config', { method: 'PUT', body: JSON.stringify(p) }),
    search: (q: string) => request<{ results: { title: string; url: string; snippet: string }[]; provider?: string; notice?: string | null }>('/api/web/search', { method: 'POST', body: JSON.stringify({ q }) }),
  },
  usage: {
    // 类型与 UsageStats 共用同一份声明，避免两处结构漂移
    summary: () => request<import('../pages/settings/settings-context').UsageSummary>('/api/usage/summary'),
  },
  mcp: {
    info: () => request<{ protocol: string; version: string; name: string; tools: number }>('/api/mcp/info'),
    tools: () => request<{ tools: McpToolInfo[] }>('/api/mcp/tools'),
    call: (name: string, args: Record<string, any>) =>
      request<{ name: string; content?: { type: string; text: string }[]; isError?: boolean }>('/api/mcp/call', {
        method: 'POST',
        body: JSON.stringify({ name, arguments: args }),
      }),
  },
  mcpExternal: {
    discover: (url: string) =>
      request<{ tools: { name?: string; description?: string }[] }>(`/api/mcp/external/discover`, {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
    call: (id: string, name: string, args: Record<string, any>) =>
      request<any>(`/api/mcp/external/${id}/call`, { method: 'POST', body: JSON.stringify({ name, arguments: args }) }),
  },
  experiments: {
    run: (body: { projectId: string; goal?: string; code: string; documentId?: string | null }) =>
      request<Experiment>('/api/experiments/run', { method: 'POST', body: JSON.stringify(body) }),
    list: (projectId: string) => request<Experiment[]>(`/api/experiments?projectId=${projectId}`),
    /** 按文档关联的实验（updatedAt 倒序；接口未就绪时前端 catch 降级为空态） */
    byDocument: (documentId: string) =>
      request<Experiment[]>(`/api/experiments/by-document/${encodeURIComponent(documentId)}`),
    get: (id: string) => request<Experiment>(`/api/experiments/${id}`),
    update: (id: string, patch: { goal?: string; conclusion?: string }) =>
      request<Experiment>(`/api/experiments/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/experiments/${id}`, { method: 'DELETE' }),
  },
  submission: {
    journals: (title: string, abstract: string, field: string) =>
      request<string>('/api/submission/journals', { method: 'POST', body: JSON.stringify({ title, abstract, field }) }),
    coverLetter: (title: string, abstract: string, journal: string) =>
      request<string>('/api/submission/cover-letter', { method: 'POST', body: JSON.stringify({ title, abstract, journal }) }),
    replyReview: (reviewComments: string, response: string, taskId?: string) =>
      request<{ letter: string; revisionPlan: { id: string; excerpt: string; category: string; severity: string; suggestedAction: string }[]; reflexionId: string | null }>('/api/submission/reply-review', { method: 'POST', body: JSON.stringify({ reviewComments, response, taskId }) }),
    /* —— 科研高级功能：期刊库 + 结构化匹配 —— */
    journalsMatch: (title: string, abstract: string) =>
      request<JournalMatchResult>('/api/submission/journals-match', { method: 'POST', body: JSON.stringify({ title, abstract }) }),
    listJournals: () => request<Journal[]>('/api/submission/journals'),
    addJournal: (j: Partial<Journal>) => request<Journal>('/api/submission/journals-lib', { method: 'POST', body: JSON.stringify(j) }),
    removeJournal: (id: string) => request<{ ok: boolean }>(`/api/submission/journals-lib/${id}`, { method: 'DELETE' }),
    /* —— 投稿流程状态跟踪 —— */
    trackSubmit: (body: {
      projectId: string;
      journalId?: string;
      journalName: string;
      documentId?: string;
      submittedAt?: number;
      currentStatus?: string;
      note?: string;
      previousSubmissionId?: string;
      revisionDeadline?: number | null;
    }) => request<SubmissionTrack>('/api/submission/track', { method: 'POST', body: JSON.stringify(body) }),
    listTracks: (projectId: string) => request<SubmissionTrack[]>(`/api/submission/track?projectId=${encodeURIComponent(projectId)}`),
    addTrackEvent: (id: string, body: { status: string; date?: number; note?: string }) =>
      request<SubmissionTrack>(`/api/submission/track/${id}/event`, { method: 'POST', body: JSON.stringify(body) }),
    parseEmail: (emailText: string, currentStatus: string) =>
      request<ParseEmailResult>('/api/submission/track/parse-email', { method: 'POST', body: JSON.stringify({ emailText, currentStatus }) }),
    updateTrack: (id: string, patch: Partial<{ notes: string; currentStatus: SubmissionStatus; revisionDeadline: number | null }>) =>
      request<SubmissionTrack>(`/api/submission/track/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    removeTrack: (id: string) => request<{ ok: boolean }>(`/api/submission/track/${id}`, { method: 'DELETE' }),
  },
};
