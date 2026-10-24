import { Component, Suspense, lazy, useCallback, useContext, useEffect, useMemo, useState, createContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HashRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import {
  BookOpen, Brain, Beaker, LayoutDashboard, Plus, RefreshCw, Search, Send, Settings, Trash2, Workflow, BookMarked, ChevronRight, Command, Sun, Moon, Monitor, XCircle as XCircleIcon, Gauge, Library, LayoutGrid, Menu as MenuIcon,
} from 'lucide-react';
import { api } from './api/client';
import { isNetworkError } from './api/core';
import type { KnowledgeDoc, Project, Reference } from './types';
import { errMsg } from './components/ui';
import { applyTheme, readStoredTheme, resolveTheme, systemPrefersDark, THEME_OPTIONS, type ThemeMode } from './lib/theme';
import { AuthGate } from './components/AuthGate';
import { AppShell, ShellNavGroup, ShellNavItem, useAppShell } from './components/AppShell';
import { BrandLockup } from './components/BrandMark';
import { StageBar } from './components/StageBar';
import { buildCommands, filterCommands } from './lib/commands';
import { useHotkeys } from './lib/hotkeys';
import { Button, Input, Modal, Spinner, ErrorBox, ToastViewport, ConfirmDialog, type ToastItem, type ToastKind } from './components/ui';
// 路由级代码分割：所有页面懒加载（首屏只加载当前视图，大厂 SPA 标准）
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const WritingPage = lazy(() => import('./pages/WritingPage').then((m) => ({ default: m.WritingPage })));
const LiteraturePage = lazy(() => import('./pages/LiteraturePage').then((m) => ({ default: m.LiteraturePage })));
const PipelinePage = lazy(() => import('./pages/PipelinePage').then((m) => ({ default: m.PipelinePage })));
const QualityPage = lazy(() => import('./pages/QualityPage').then((m) => ({ default: m.QualityPage })));
const SubmissionPage = lazy(() => import('./pages/SubmissionPage').then((m) => ({ default: m.SubmissionPage })));
const KnowledgePage = lazy(() => import('./pages/KnowledgePage').then((m) => ({ default: m.KnowledgePage })));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const MemoryPage = lazy(() => import('./pages/MemoryPage').then((m) => ({ default: m.MemoryPage })));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
/** 页面级骨架：懒加载 chunk 下载期间给出结构占位，避免整屏空白与布局跳动 */
function PageSkeleton({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" role="status" aria-live="polite" aria-label={`${name}加载中`}>
      <div className="skeleton h-7 w-48 rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="skeleton h-64 rounded-xl" />
      <span className="sr-only">{name}加载中…</span>
    </div>
  );
}
const SuspensePage = ({ children, name = '页面' }: { children: ReactNode; name?: string }) => (
  <Suspense fallback={<PageSkeleton name={name} />}>{children}</Suspense>
);

export type View =
  | 'workspace'
  | 'dashboard'
  | 'writing'
  | 'literature'
  | 'experiments'
  | 'pipeline'
  | 'quality'
  | 'submission'
  | 'knowledge'
  | 'memory'
  | 'settings';

/** 全部视图键（由类型收敛而来，作为路径解析的单一白名单来源） */
/** 平台修饰键显示文案（Windows 上不显示 ⌘） */
const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const VIEW_KEYS: readonly View[] = ['workspace', 'dashboard', 'writing', 'literature', 'experiments', 'pipeline', 'quality', 'submission', 'knowledge', 'memory', 'settings'];

/** 功能导航分组（大厂式：按工作流分组，设置独立收纳到底部） */
const VIEW_LABELS: Record<View, string> = {
  workspace: '工作台',
  dashboard: '项目总览',
  writing: '论文写作',
  literature: '文献调研',
  experiments: '实验记录',
  knowledge: '知识库',
  memory: '记忆中心',
  pipeline: '全自动流水线',
  quality: '质量评分',
  submission: '投稿辅助',
  settings: '设置',
};

/** 导航按「核心工作 → 自动化 → 记录与洞察」三段叙事（名称唯一来源 = VIEW_LABELS） */
const NAV_GROUPS: { label: string; items: { key: View; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    label: '核心工作',
    items: [
      { key: 'workspace', label: VIEW_LABELS.workspace, icon: LayoutDashboard },
      { key: 'writing', label: VIEW_LABELS.writing, icon: BookOpen },
      { key: 'literature', label: VIEW_LABELS.literature, icon: Library },
      { key: 'knowledge', label: VIEW_LABELS.knowledge, icon: BookMarked },
    ],
  },
  {
    label: '自动化',
    items: [
      { key: 'pipeline', label: VIEW_LABELS.pipeline, icon: Workflow },
      { key: 'quality', label: VIEW_LABELS.quality, icon: Gauge },
      { key: 'submission', label: VIEW_LABELS.submission, icon: Send },
    ],
  },
  {
    label: '记录与洞察',
    items: [
      { key: 'dashboard', label: VIEW_LABELS.dashboard, icon: LayoutGrid },
      { key: 'experiments', label: VIEW_LABELS.experiments, icon: Beaker },
      { key: 'memory', label: VIEW_LABELS.memory, icon: Brain },
    ],
  },
];


/** 页面级留白：全屏型页面（写作/工作台）自己管内边距，列表型页面统一留白 */
const PAGE_PADDING: Partial<Record<View, string>> = {
  workspace: 'p-3 sm:p-4',
  writing: 'p-2 sm:p-3',
};

/** 主题上下文（暗色模式，2026 桌面工具标配） */
/**
 * 视图渲染注册表（声明式）：每个视图一个入口，Record<View,...> 由类型系统保证不漏项。
 * 设置页不依赖项目；其余页面在无项目时由外层统一渲染"请先创建项目"占位。
 */
interface PageRenderCtx {
  project: Project | null;
  openDoc: (id: string) => void;
  onNavigate: (v: View) => void;
  initialDocId: string | null;
}
const PAGE_RENDERERS: Record<View, (ctx: PageRenderCtx) => ReactNode> = {
  workspace: ({ project, openDoc, initialDocId }) =>
    project ? (
      <PageErrorBoundary pageName="工作台">
        <SuspensePage name="工作台">
          {/* key=project.id：切项目必须整页重挂载，否则旧项目的消息会被写进新项目的 localStorage（跨项目串话） */}
          <WorkspacePage key={project.id} project={project} initialDocId={initialDocId} onOpenFullEditor={openDoc} />
        </SuspensePage>
      </PageErrorBoundary>
    ) : null,
  settings: () => <PageErrorBoundary pageName="设置"><SuspensePage name="设置"><SettingsPage /></SuspensePage></PageErrorBoundary>,
  dashboard: ({ project, onNavigate, openDoc }) =>
    project ? <PageErrorBoundary pageName="工作台"><SuspensePage name="项目总览"><DashboardPage project={project} onNavigate={onNavigate} openDoc={openDoc} /></SuspensePage></PageErrorBoundary> : null,
  writing: ({ project, initialDocId }) =>
    project ? <PageErrorBoundary pageName="论文写作"><SuspensePage name="论文写作"><WritingPage key={project.id} project={project} initialDocId={initialDocId} /></SuspensePage></PageErrorBoundary> : null,
  literature: ({ project }) => (project ? <PageErrorBoundary pageName="文献调研"><SuspensePage name="文献调研"><LiteraturePage key={project.id} project={project} /></SuspensePage></PageErrorBoundary> : null),
  experiments: ({ project }) => (project ? <PageErrorBoundary pageName="实验记录"><SuspensePage name="实验记录"><ExperimentsPage key={project.id} project={project} /></SuspensePage></PageErrorBoundary> : null),
  knowledge: ({ project }) => (project ? <PageErrorBoundary pageName="知识库"><SuspensePage name="知识库"><KnowledgePage key={project.id} project={project} /></SuspensePage></PageErrorBoundary> : null),
  memory: ({ project }) => (project ? <PageErrorBoundary pageName="记忆中心"><SuspensePage name="记忆中心"><MemoryPage key={project.id} /></SuspensePage></PageErrorBoundary> : null),
  pipeline: ({ project, openDoc }) =>
    project ? <PageErrorBoundary pageName="全自动流水线"><SuspensePage name="全自动流水线"><PipelinePage key={project.id} project={project} onOpenDoc={openDoc} /></SuspensePage></PageErrorBoundary> : null,
  quality: ({ project }) =>
    project ? (
      <PageErrorBoundary pageName="质量评分">
        <Suspense fallback={<div className="p-8 text-sm text-slate-400" role="status" aria-label="加载质量评分">加载质量评分…</div>}>
          <QualityPage key={project.id} project={project} />
        </Suspense>
      </PageErrorBoundary>
    ) : null,
  submission: ({ project }) => (project ? <PageErrorBoundary pageName="投稿辅助"><SuspensePage name="投稿辅助"><SubmissionPage key={project.id} project={project} /></SuspensePage></PageErrorBoundary> : null),
};

export const ThemeContext = createContext<{ theme: 'light' | 'dark'; mode: ThemeMode; setMode: (m: ThemeMode) => void; toggle: () => void }>({
  theme: 'light',
  mode: 'system',
  setMode: () => undefined,
  toggle: () => undefined,
});

/** 全局 Toast 反馈上下文（页面级操作成功/失败提示） */
export const ToastContext = createContext<(kind: 'success' | 'error' | 'info', text: string) => void>(() => undefined);

function AppInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pickedProjectId, setCurrentProjectId] = useState<string | null>(null);
  const qc = useQueryClient();
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredTheme());
  /** 系统偏好单独存 state，主题在渲染期派生（避免 effect 里 setState 造成级联渲染） */
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());
  const theme: 'light' | 'dark' = themeMode === 'system' ? (systemDark ? 'dark' : 'light') : themeMode;

  // ---- 全局 Toast 反馈 ----
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((s) => [...s, { id, kind, text }]);
    window.setTimeout(() => setToasts((s) => s.filter((t) => t.id !== id)), 2600);
  }, []);

  // 路由化：pathname 决定当前视图（hash 路由，刷新/分享/深链不丢状态）；无效路径兜底工作台
  const rawView = (location.pathname.replace(/^\//, '') || 'workspace') as View;
  const view: View = VIEW_KEYS.includes(rawView) ? rawView : 'workspace';
  const selectedDocId = searchParams.get('doc');
  const setView = useCallback(
    (v: View) => {
      navigate(`/${v}`);
    },
    [navigate],
  );

  useEffect(() => {
    localStorage.setItem('sciflow-theme', themeMode);
  }, [themeMode]);

  // 主题落到 <html>（唯一外部副作用）；theme 为派生值
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 跟随系统：系统主题变化时更新 systemDark（仅订阅，不在回调外 setState）
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 路由级标题：浏览器标签/历史记录可区分（此前全站恒为默认标题，多标签时无法辨认）
  useEffect(() => {
    document.title = `${VIEW_LABELS[view] || '工作台'} · SciFlow`;
  }, [view]);

  // 任务6：写作面包屑文档名——React Query 按 ?doc= 拉取（WritingPage 内部切文档改 ?doc=，queryKey 变化自动刷新）
  const writingDocQuery = useQuery({
    queryKey: ['doc-title', selectedDocId],
    queryFn: () => api.documents.get(selectedDocId!).then((d) => d.title || ''),
    enabled: view === 'writing' && !!selectedDocId,
  });
  const writingDocTitle = writingDocQuery.data ?? '';


  // 启动数据（React Query）：项目列表带冷启动重试（4 次 / 2s），健康自检失败静默
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    retry: 3,
    retryDelay: 2000,
  });
  const healthQuery = useQuery({ queryKey: ['health'], queryFn: () => api.health(), retry: 0, staleTime: 60_000 });
  const projects: Project[] = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const aiReady = healthQuery.data ? healthQuery.data.ai.configured : null;
  const loading = projectsQuery.isLoading;
  const error = projectsQuery.isError
    ? isNetworkError(projectsQuery.error)
      ? '连不上后端服务。请确认服务已启动（默认 http://127.0.0.1:3000），或检查设置里的服务地址。'
      : errMsg(projectsQuery.error)
    : '';
  // 选中项目为派生：显式选择 > 列表首个（不在 effect 里写 state）
  const currentProjectId = pickedProjectId && projects.some((p) => p.id === pickedProjectId) ? pickedProjectId : (projects[0]?.id ?? null);

  // 阶段条数据（项目级）：文档/概览/投稿三项，缺失即降级为「不做完成度推断」
  const stageDocsQuery = useQuery({
    queryKey: ['stage-docs', currentProjectId],
    queryFn: () => api.documents.list(currentProjectId!),
    enabled: !!currentProjectId && view !== 'settings',
    staleTime: 30_000,
  });
  const stageOverviewQuery = useQuery({
    queryKey: ['stage-overview', currentProjectId],
    queryFn: () => api.dashboard.overview(currentProjectId ?? undefined),
    enabled: !!currentProjectId && view !== 'settings',
    retry: 0,
    staleTime: 30_000,
  });
  const stageSubsQuery = useQuery({
    queryKey: ['stage-subs', currentProjectId],
    queryFn: () => api.submission.listTracks(currentProjectId!),
    enabled: !!currentProjectId && view !== 'settings',
    retry: 0,
    staleTime: 30_000,
  });

  // 全局快捷键（统一注册表）：命令面板 / 新建项目 / Esc 关闭
  useHotkeys([
    // 输入区内可达：焦点在搜索框/编辑器时 ⌘K 仍可开面板（历史回归：命令面板自己的输入框会吞掉 ⌘K）
    { combo: 'mod+k', allowInInput: true, handler: () => setCommandOpen((s) => !s) },
    {
      combo: 'mod+n',
      allowInInput: true,
      handler: () => {
        setCommandOpen(false);
        setShowNewProject(true);
      },
    },
    { combo: 'escape', allowInInput: true, handler: () => setCommandOpen(false) },
  ]);

  const createProject = async () => {
    if (!newName.trim()) return;
    const p = await api.projects.create(newName.trim());
    void qc.invalidateQueries({ queryKey: ['projects'] });
    setCurrentProjectId(p.id);
    setNewName('');
    setShowNewProject(false);
    setCommandOpen(false);
    toast('success', `项目「${p.name}」已创建`);
  };

  const renameProject = async () => {
    if (!renaming || !renameText.trim()) return;
    await api.projects.update(renaming.id, { name: renameText.trim() });
    void qc.invalidateQueries({ queryKey: ['projects'] });
    setRenaming(null);
    toast('success', '项目已重命名');
  };

  const confirmDeleteProject = async () => {
    if (!deletingProject) return;
    await api.projects.remove(deletingProject.id);
    void qc.invalidateQueries({ queryKey: ['projects'] });
    if (currentProjectId === deletingProject.id) setCurrentProjectId(null);
    toast('info', '项目已删除');
    setDeletingProject(null);
  };

  const currentProject = useMemo(() => projects.find((p) => p.id === currentProjectId) ?? null, [projects, currentProjectId]);
  const filteredProjects = useMemo(
    () => (projectQuery.trim() ? projects.filter((p) => p.name.toLowerCase().includes(projectQuery.trim().toLowerCase())) : projects),
    [projects, projectQuery],
  );

  // 阶段条数据派生：文档有正文 / 最近评分 / 投稿条数
  const stageDocs = stageDocsQuery.data ?? [];
  const stageDocWithContent = stageDocs.some((d) => (d.content || '').length > 40);
  // 评审完成度：文档状态进入 reviewing/polished/final 即视为已评审（lowQualityDocs 只含 <60 分，不能当完成信号）
  const stageReviewedCount = stageDocs.filter((d) => ['reviewing', 'polished', 'final'].includes(d.status)).length;
  const stageSubmissionCount = stageSubsQuery.data?.length ?? 0;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner label="SciFlow 启动中…" />
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, mode: themeMode, setMode: setThemeMode, toggle: () => setThemeMode((m) => (resolveTheme(m) === 'dark' ? 'light' : 'dark')) }}>
      <ToastContext.Provider value={toast}>
        {/* 全局登录门：仅 AUTH_MODE=jwt 企业模式可见，本地/桌面模式零干扰 */}
        <AuthGate />
        <div className="h-full text-slate-800 dark:text-slate-100">
          <AppShell
            sidebarWidth={224}
            toolbarTitle={VIEW_LABELS[view]}
            stageBar={
              currentProject && view !== 'settings' ? (
                <StageBar
                  project={currentProject}
                  view={view}
                  overview={stageOverviewQuery.data ?? null}
                  docCount={stageDocs.length}
                  hasContent={stageDocWithContent}
                  score={null}
                  reviewedDocCount={stageReviewedCount}
                  submissionCount={stageSubmissionCount}
                  onNavigate={(v) => setView(v as View)}
                />
              ) : undefined
            }
            mobileTabbar={<MobileTabBar view={view} onSelect={setView} />}
            sidebar={
              <SidebarContent
                view={view}
                onSelectView={setView}
                projects={filteredProjects}
                currentProjectId={currentProjectId}
                onSelectProject={(id) => setCurrentProjectId(id)}
                projectQuery={projectQuery}
                onProjectQuery={setProjectQuery}
                onRefresh={() => void qc.invalidateQueries({ queryKey: ['projects'] })}
                onNewProject={() => setShowNewProject(true)}
                onRenameProject={(p) => { setRenaming(p); setRenameText(p.name); }}
                onDeleteProject={setDeletingProject}
                aiReady={aiReady}
                theme={theme}
                themeMode={themeMode}
                onSetThemeMode={setThemeMode}
                onOpenCommand={() => setCommandOpen(true)}
                loading={loading}
              />
            }
            toolbar={
              <>
                {view === 'settings' ? (
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">设置</span>
                ) : currentProject ? (
                  <div className="flex items-center gap-1.5 text-sm min-w-0">
                    <span className="text-slate-400 truncate max-w-[100px] sm:max-w-[200px]">{currentProject.name}</span>
                    <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" aria-hidden="true" />
                    <span className="font-medium whitespace-nowrap">{VIEW_LABELS[view]}</span>
                    {view === 'writing' && writingDocTitle && (
                      <>
                        <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 shrink-0" aria-hidden="true" />
                        <span className="text-slate-500 dark:text-slate-400 truncate max-w-[120px] sm:max-w-[240px]">{writingDocTitle}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-slate-400">未选择项目</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {view !== 'settings' && currentProject && (
                    <Button variant="outline" className="text-xs px-2.5 py-1.5" onClick={() => setShowNewProject(true)}>
                      <Plus size={13} aria-hidden="true" /> 新建项目
                    </Button>
                  )}
                </div>
              </>
            }
          >
            <div key={view} className={`page-enter ${PAGE_PADDING[view] ?? 'p-3 sm:p-4 md:p-6'} h-full min-h-0`}>
              <RouteProgress view={view} />
              {error && (
                <div className="mb-4">
                  <ErrorBox message={error} />
                </div>
              )}
              {!currentProject && view !== 'settings' ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
                  <div className="text-lg">请先创建一个研究项目</div>
                  <Button onClick={() => setShowNewProject(true)}>
                    <Plus size={16} aria-hidden="true" /> 新建项目
                  </Button>
                </div>
              ) : (
                <>{PAGE_RENDERERS[view]({ project: currentProject, openDoc: (id: string) => navigate(`/writing?doc=${id}`), onNavigate: setView, initialDocId: selectedDocId })}</>
              )}
            </div>
          </AppShell>
        </div>

        {/* ============ Cmd+K 命令面板（大厂标配：搜索式快速跳转） ============ */}
        {commandOpen && <CommandPalette projectId={currentProjectId} onClose={() => setCommandOpen(false)} onNavigate={(v) => setView(v)} onNewProject={() => { setCommandOpen(false); setShowNewProject(true); }} />}

        {/* 全局 Toast 反馈 */}
        <ToastViewport items={toasts} onDone={(id) => setToasts((s) => s.filter((t) => t.id !== id))} />

        {/* 新建项目弹窗 */}
        <Modal open={showNewProject} title="新建研究项目" onClose={() => setShowNewProject(false)} width="max-w-md">
          <Input placeholder="项目名称，如：图神经网络综述" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createProject()} autoFocus />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowNewProject(false)}>
              取消
            </Button>
            <Button onClick={createProject} disabled={!newName.trim()}>
              创建
            </Button>
          </div>
        </Modal>

        {/* 重命名弹窗 */}
        <Modal open={!!renaming} title="重命名项目" onClose={() => setRenaming(null)} width="max-w-md">
          <Input placeholder="新名称" value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button onClick={renameProject} disabled={!renameText.trim()}>
              保存
            </Button>
          </div>
        </Modal>

        {/* 删除项目确认弹窗（危险操作二次确认） */}
        <ConfirmDialog
          open={!!deletingProject}
          title="删除研究项目"
          description={`确定要删除「${deletingProject?.name ?? ''}」吗？项目下的所有文档、文献与流水线记录将被一并删除，且无法恢复。`}
          confirmText="删除"
          danger
          onConfirm={confirmDeleteProject}
          onClose={() => setDeletingProject(null)}
        />
      </ToastContext.Provider>
    </ThemeContext.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════════
 * SidebarContent —— 侧栏内容（从 AppInner 抽出，便于 AppShell 复用）
 * 只负责渲染；状态与回调全部由 AppInner 传入。
 * ═══════════════════════════════════════════════════════════════════ */
function SidebarContent({
  view,
  onSelectView,
  projects,
  currentProjectId,
  onSelectProject,
  projectQuery,
  onProjectQuery,
  onRefresh,
  onNewProject,
  onRenameProject,
  onDeleteProject,
  aiReady,
  theme,
  themeMode,
  onSetThemeMode,
  onOpenCommand,
  loading,
}: {
  view: View;
  onSelectView: (v: View) => void;
  projects: Project[];
  currentProjectId: string | null;
  onSelectProject: (id: string) => void;
  projectQuery: string;
  onProjectQuery: (q: string) => void;
  onRefresh: () => void;
  onNewProject: () => void;
  onRenameProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  aiReady: boolean | null;
  theme: 'light' | 'dark';
  themeMode: ThemeMode;
  onSetThemeMode: (m: ThemeMode) => void;
  onOpenCommand: () => void;
  loading: boolean;
}) {
  const { closeSidebar } = useAppShell();
  return (
    <>
      {/* 品牌区 */}
      <div className="px-4 pb-2 pt-4">
        <BrandLockup />
      </div>

      {/* 导航 */}
      <nav className="shrink-0" aria-label="功能导航">
        {NAV_GROUPS.map((g) => (
          <ShellNavGroup key={g.label} label={g.label}>
            {g.items.map((n) => {
              const Icon = n.icon;
              return (
                <ShellNavItem key={n.key} active={view === n.key} onSelect={() => onSelectView(n.key)} icon={<Icon size={14} aria-hidden="true" />}>
                  {n.label}
                </ShellNavItem>
              );
            })}
          </ShellNavGroup>
        ))}
      </nav>

      {/* 项目区 */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100 px-3 py-1 dark:border-slate-800">
        <div className="relative pt-2">
          <Search size={13} className="absolute left-2.5 top-[13px] text-slate-400" aria-hidden="true" />
          <input
            className="w-full rounded-lg bg-slate-100 py-1.5 pl-8 pr-2 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:focus:bg-slate-700"
            placeholder="搜索项目…"
            value={projectQuery}
            onChange={(e) => onProjectQuery(e.target.value)}
            aria-label="搜索项目"
          />
        </div>
        <div className="flex items-center justify-between px-2 pb-1 pt-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">研究项目</span>
          <div className="flex items-center gap-1">
            <button className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" title="刷新项目列表" onClick={onRefresh}>
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
            <button className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" title="新建项目" onClick={onNewProject}>
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        {projects.length === 0 && <div className="px-2 py-3 text-xs text-slate-400">暂无项目，点击 + 创建</div>}
        {projects.map((p) => (
          <div
            key={p.id}
            onClick={() => {
              onSelectProject(p.id);
              // 窄屏抽屉：选中项目不改变 hash，不会触发 hashchange 自动收起，这里显式关闭
              closeSidebar();
            }}
            className={`group relative cursor-pointer rounded-md px-3 py-2 text-sm transition-colors ${
              currentProjectId === p.id
                ? 'bg-teal-50/80 text-teal-900 dark:bg-teal-900/25 dark:text-teal-100'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60'
            }`}
          >
            {currentProjectId === p.id && <span className="brand-logo absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full" />}
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{p.name}</span>
              <span className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  className="flex h-7 w-7 items-center justify-center rounded text-[11px] text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  title="重命名项目"
                  aria-label={`重命名项目 ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRenameProject(p);
                  }}
                >
                  改
                </button>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
                  title="删除项目"
                  aria-label={`删除项目 ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteProject(p);
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* 底部：设置 / 命令面板 / 主题 / AI 状态 */}
      <div className="shrink-0 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
        <ShellNavItem active={view === 'settings'} onSelect={() => onSelectView('settings')} icon={<Settings size={14} aria-hidden="true" />}>
          设置
        </ShellNavItem>
        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-slate-50 px-2.5 py-1 text-[11px] dark:bg-slate-800">
          <button onClick={onOpenCommand} className="flex flex-1 items-center gap-1.5 text-slate-500 hover:text-slate-700 dark:text-slate-300" title={`命令面板 (${MOD_KEY}+K)`}>
            <Command size={11} aria-hidden="true" /> 命令面板
            <kbd className="ml-auto rounded border border-slate-200 px-1 text-[11px] text-slate-400 dark:border-slate-700">{MOD_KEY} K</kbd>
          </button>
          <button
            onClick={() => {
              const order: ThemeMode[] = ['light', 'dark', 'system'];
              onSetThemeMode(order[(order.indexOf(themeMode) + 1) % order.length]);
            }}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            title={`外观：${THEME_OPTIONS.find((t) => t.value === themeMode)?.label ?? '跟随系统'}（点击切换 浅色/深色/跟随系统）`}
            aria-label="切换外观模式"
          >
            {themeMode === 'system' ? <Monitor size={13} aria-hidden="true" /> : theme === 'light' ? <Moon size={13} aria-hidden="true" /> : <Sun size={13} aria-hidden="true" />}
          </button>
        </div>
        <div
          className={`mt-2 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] ${
            aiReady ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300'
          }`}
          role="status"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${aiReady ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true" />
          {aiReady ? 'AI 服务已连接' : aiReady === false ? 'AI 未配置' : 'AI 状态检查中…'}
        </div>
      </div>
    </>
  );
}

/** Cmd+K 命令面板：搜索导航项 + 快捷动作 + 内容搜索（文献/知识库） */
function CommandPalette({ onClose, onNavigate, onNewProject, projectId }: { onClose: () => void; onNavigate: (v: View) => void; onNewProject: () => void; projectId: string | null }) {
  const [q, setQ] = useState('');
  const { setMode } = useContext(ThemeContext);
  // F-3.1：命令清单单一来源 lib/commands.ts（label+keywords+hotkey 声明、run 注入），过滤走 filterCommands 双通道
  const commands = useMemo(
    () => buildCommands({ onNavigate, onNewProject, setThemeMode: setMode, navGroups: NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.map((n) => ({ key: n.key, label: n.label })) })) }),
    [onNavigate, onNewProject, setMode],
  );

  const filtered = useMemo(() => filterCommands(commands, q), [commands, q]);
  const [active, setActive] = useState(0);

  /* ---- 差距#18：内容搜索（文献 references.search + 知识库 list 前端过滤） ---- */
  // 后端未暴露 knowledge.search 单端，知识库退化为 list 后按文档名前端过滤；
  // 文献走 references.search（服务端检索）。两者并行，250ms 防抖。
  const [docHits, setDocHits] = useState<Reference[]>([]);
  const [kbHits, setKbHits] = useState<KnowledgeDoc[]>([]);
  const [searching, setSearching] = useState(false);
  const qTrim = q.trim();
  const searchActive = !!projectId && qTrim.length >= 2;
  useEffect(() => {
    if (!searchActive) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      const [refRes, docRes] = await Promise.allSettled([
        api.references.search(qTrim, 6, projectId),
        api.knowledge.list(projectId),
      ]);
      if (cancelled) return;
      const refs = refRes.status === 'fulfilled' ? refRes.value : [];
      const allDocs = docRes.status === 'fulfilled' ? docRes.value : [];
      const kb = allDocs.filter((d) => d.name.toLowerCase().includes(qTrim.toLowerCase())).slice(0, 6);
      setDocHits(refs);
      setKbHits(kb);
      setSearching(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [qTrim, searchActive, projectId]);
  // 短查询/无项目时展示层派生为空（不在 effect 里强清 state）
  const shownDocHits = searchActive ? docHits : [];
  const shownKbHits = searchActive ? kbHits : [];
  const shownSearching = searchActive && searching;

  const goTo = (v: View) => {
    onNavigate(v);
    onClose();
  };

  // 键盘导航：↑↓ 移动选中，Enter 执行（与底部提示一致）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      filtered[active].run();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Search size={15} className="text-slate-400" />
          <input
            autoFocus
            className="flex-1 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
            placeholder="输入命令或页面名称…（Esc 关闭）"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="text-[11px] text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto py-2">
          {filtered.length === 0 && shownDocHits.length === 0 && shownKbHits.length === 0 && !shownSearching && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">没有匹配的命令或内容</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => { c.run(); onClose(); }}
              className={`w-full flex items-center justify-between px-4 py-2 text-left text-sm transition-colors ${i === active ? 'bg-teal-50 dark:bg-teal-900/25 text-teal-900 dark:text-teal-100 border-l-2 border-l-teal-500' : 'text-slate-600 dark:text-slate-300'}`}
            >
              <span>{c.label}</span>
              <span className="text-[11px] text-slate-400">{c.group}</span>
            </button>
          ))}

          {/* 差距#18：内容搜索结果（文献 / 知识库文档） */}
          {searching && <div className="px-4 py-2 text-[11px] text-slate-400">搜索内容…</div>}
          {!shownSearching && searchActive && (shownDocHits.length > 0 || shownKbHits.length > 0) && (
            <>
              <div className="mt-1 pt-1 border-t border-slate-100 dark:border-slate-800 px-4 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                内容
              </div>
              {shownDocHits.map((r) => (
                <button
                  key={`ref-${r.id}`}
                  onClick={() => goTo('literature')}
                  className="w-full flex items-center justify-between gap-2 px-4 py-1.5 text-left text-[13px] hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-slate-700 dark:text-slate-200 truncate block">{r.title}</span>
                    <span className="text-[11px] text-slate-400">{[r.venue, r.year].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="text-[11px] text-teal-500 shrink-0">文献 → 文献调研</span>
                </button>
              ))}
              {shownKbHits.map((d) => (
                <button
                  key={`kb-${d.id}`}
                  onClick={() => goTo('knowledge')}
                  className="w-full flex items-center justify-between gap-2 px-4 py-1.5 text-left text-[13px] hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-slate-700 dark:text-slate-200 truncate block">{d.name}</span>
                    <span className="text-[11px] text-slate-400">{d.type} · {d.chunkCount} 分块</span>
                  </span>
                  <span className="text-[11px] text-sky-500 shrink-0">知识库 → 知识库</span>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400 flex items-center gap-3">
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">↑↓</kbd> 选择</span>
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">Enter</kbd> 执行</span>
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">{MOD_KEY} N</kbd> 新建项目</span>
          <span><kbd className="border border-slate-200 dark:border-slate-700 rounded px-1">{MOD_KEY} S</kbd> 写作页保存</span>
          <span className="ml-auto flex items-center gap-1"><Monitor size={11} /> SciFlow Command</span>
        </div>
      </div>
    </div>
  );
}

/** 移动端底部导航（≤900px）：只放最高频 5 个入口，其余走侧栏抽屉 */
function MobileTabBar({ view, onSelect }: { view: View; onSelect: (v: View) => void }) {
  const items: { key: View | 'more'; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'workspace', label: '工作台', icon: LayoutDashboard },
    { key: 'writing', label: '写作', icon: BookOpen },
    { key: 'literature', label: '文献', icon: Library },
    { key: 'quality', label: '评分', icon: Gauge },
    { key: 'more', label: '更多', icon: MenuIcon },
  ];
  return (
    <nav className="mobile-tabbar" aria-label="移动端主导航">
      {items.map((it) => {
        const Icon = it.icon;
        const active = it.key === 'more' ? !items.some((x) => x.key === view) : view === it.key;
        return (
          <button
            key={it.key}
            type="button"
            className="mobile-tabbar__btn"
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (it.key === 'more') {
                window.dispatchEvent(new CustomEvent('sciflow:open-sidebar'));
              } else {
                onSelect(it.key);
              }
            }}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** 全局错误边界：页面崩溃时显示友好提示而非白屏（健壮性兜底） */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8">
          <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-900/30 flex items-center justify-center text-rose-500">
            <XCircleIcon size={22} />
          </div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">页面渲染出错</div>
          <div className="text-xs text-slate-400 dark:text-slate-500 max-w-md text-center break-all">{String(this.state.error?.message || this.state.error)}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <AppInner />
      </ErrorBoundary>
    </HashRouter>
  );
}

/** 路由切换进度条：view 变化时重挂载一次动画（纯视觉反馈，无网络语义） */
function RouteProgress({ view }: { view: string }) {
  return <div key={view} className="route-progress" aria-hidden="true" />;
}
