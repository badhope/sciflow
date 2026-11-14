import { useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Code2, ExternalLink, Loader2, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Project, WebProject } from '../types';
import { ToastContext } from '../App';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, SectionTitle, Select, Spinner, errMsg } from '../components/ui';

/**
 * Web 项目沙箱页：建项目 → 装依赖 → 构建 → 起预览（iframe 直接看）。
 *
 * 这是「完整 Web 项目开发」的落地形态：
 *  - 每个项目独立临时目录，npm 缓存也落在项目目录里，互不污染；
 *  - 构建产物 dist/ 由 Node 内置 http 服务托管，只监听 127.0.0.1；
 *  - 预览直接用 iframe 展示，不需要用户手动开浏览器。
 */
const STATUS_LABEL: Record<string, string> = {
  created: '待安装',
  installing: '安装中',
  installed: '已安装',
  install_failed: '安装失败',
  building: '构建中',
  built: '已构建',
  build_failed: '构建失败',
  previewing: '预览中',
  preview_failed: '预览失败',
};

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  created: 'slate',
  installing: 'amber',
  installed: 'slate',
  install_failed: 'red',
  building: 'amber',
  built: 'green',
  build_failed: 'red',
  previewing: 'green',
  preview_failed: 'red',
};

export function WebSandboxPage({ project }: { project: Project }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('static');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [log, setLog] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [selected, setSelected] = useState('');

  const templatesQuery = useQuery({ queryKey: ['web-templates'], queryFn: () => api.webProjects.templates() });
  const listQuery = useQuery({ queryKey: ['web-projects', project.id], queryFn: () => api.webProjects.list(project.id) });
  const items = listQuery.data ?? [];
  const currentId = selected || items[0]?.id || '';
  const current: WebProject | undefined = items.find((i) => i.id === currentId);

  useEffect(() => {
    if (current?.previewUrl) setPreviewUrl(current.previewUrl);
  }, [current?.previewUrl]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['web-projects', project.id] });
  };

  const create = async () => {
    if (!name.trim()) {
      toast('error', '请填写项目名');
      return;
    }
    setBusy('create');
    setError('');
    try {
      const created = await api.webProjects.create({ projectId: project.id, name: name.trim(), template });
      setName('');
      setSelected(created.id);
      await refresh();
      toast('success', '项目骨架已创建，下一步安装依赖并构建');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const step = async (kind: 'install' | 'build' | 'preview' | 'runAll' | 'stop') => {
    if (!currentId) return;
    setBusy(kind);
    setError('');
    setLog('');
    try {
      if (kind === 'stop') {
        await api.webProjects.stop(currentId);
        setPreviewUrl('');
        toast('info', '预览已停止');
      } else if (kind === 'preview') {
        const r = await api.webProjects.preview(currentId);
        setPreviewUrl(r.url);
        toast('success', `预览已启动：${r.url}`);
      } else if (kind === 'runAll') {
        const r = await api.webProjects.runAll(currentId);
        if (!r.ok) setError(`${r.stage} 阶段失败：${r.error || '未知原因'}`);
        else if (r.url) {
          setPreviewUrl(r.url);
          toast('success', '安装、构建、预览全部完成');
        }
      } else {
        const r = kind === 'install' ? await api.webProjects.install(currentId) : await api.webProjects.build(currentId);
        setLog(r.log || '');
        if (!r.ok) setError(`${kind === 'install' ? '安装' : '构建'}失败，见下方日志`);
        else toast('success', kind === 'install' ? '依赖安装完成' : '构建完成');
      }
      await refresh();
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!currentId) return;
    setBusy('remove');
    try {
      await api.webProjects.remove(currentId);
      setPreviewUrl('');
      setSelected('');
      await refresh();
      toast('success', '项目已删除（目录与预览一并清理）');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-container">
      <ErrorBox message={error} />

      <Card tone="inset" className="mb-4 p-4">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Code2 size={16} className="text-teal-600" /> Web 项目沙箱
          </span>
        </SectionTitle>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          在独立目录里创建项目、安装依赖、构建并起静态预览。npm 缓存与产物都在项目目录内，结束删除即清理。
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input placeholder="项目名，例如：landing-page" value={name} onChange={(e) => setName(e.target.value)} aria-label="项目名" />
          <Select
            className="w-full sm:w-52"
            options={(templatesQuery.data ?? []).map((t) => ({ value: t.key, label: t.label }))}
            value={template}
            onChange={(v: string) => setTemplate(v)}
          />
          <Button onClick={() => void create()} loading={busy === 'create'} disabled={!name.trim()}>
            <Plus size={14} /> 新建项目
          </Button>
        </div>
      </Card>

      {listQuery.isLoading ? (
        <Spinner label="加载 Web 项目" />
      ) : items.length === 0 ? (
        <EmptyState illustration="documents" title="还没有 Web 项目" hint="先在上面新建一个项目，然后依次安装、构建、预览" />
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select
                className="w-full sm:w-64"
                options={items.map((i) => ({ value: i.id, label: i.name }))}
                value={currentId}
                onChange={(v: string) => setSelected(v)}
              />
              {current && <Badge tone={STATUS_TONE[current.status] || 'slate'}>{STATUS_LABEL[current.status] || current.status}</Badge>}
              {current?.previewPort ? <span className="text-[11px] text-slate-400">端口 {current.previewPort}</span> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" onClick={() => void step('runAll')} loading={busy === 'runAll'}>
                <Play size={14} /> 一键跑通
              </Button>
              <Button variant="outline" onClick={() => void step('install')} loading={busy === 'install'}>
                {busy === 'install' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 安装依赖
              </Button>
              <Button variant="outline" onClick={() => void step('build')} loading={busy === 'build'}>
                构建
              </Button>
              <Button variant="outline" onClick={() => void step('preview')} loading={busy === 'preview'} disabled={!current || current.status === 'created'}>
                启动预览
              </Button>
              <Button variant="ghost" onClick={() => void step('stop')} loading={busy === 'stop'} disabled={!current?.previewUrl}>
                <Square size={14} /> 停止预览
              </Button>
              <Button variant="ghost" onClick={() => void remove()} loading={busy === 'remove'}>
                <Trash2 size={14} /> 删除项目
              </Button>
              {previewUrl && (
                <a className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline dark:text-teal-300" href={previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> 新窗口打开
                </a>
              )}
            </div>
          </Card>

          {previewUrl ? (
            <Card className="mb-4 overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <span>预览：{previewUrl}</span>
                <span>localhost 预览，仅本机可见</span>
              </div>
              <iframe title="Web 项目预览" src={previewUrl} className="h-[520px] w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-forms" />
            </Card>
          ) : null}

          {log ? (
            <Card className="p-4">
              <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">最近日志</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-200">{log}</pre>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
