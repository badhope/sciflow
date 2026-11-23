import { useContext, useEffect, useState } from 'react';
import { Database, Download, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Project } from '../../types';
import { Button, Card, ErrorBox, SectionTitle, errMsg } from '../../components/ui';
import { downloadText } from '../../components/ui';
import { ToastContext } from '../../App';

/** 数据管理：放在「用量与审计」，不新增第 10 个设置分组。 */
export function DataManagementPanel() {
  const toast = useContext(ToastContext);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.projects.list().then((rows) => { setProjects(rows); setProjectId((v) => v || rows[0]?.id || ''); }).catch((e) => setError(errMsg(e)));
  }, []);

  const exportProject = async () => {
    if (!projectId) return;
    setBusy('export'); setError('');
    try {
      const bundle = await api.projects.exportBundle(projectId, true);
      const name = projects.find((p) => p.id === projectId)?.name || 'project';
      downloadText(`${name.replace(/[\\/:*?"<>|]/g, '_')}-sciflow-export.json`, JSON.stringify(bundle, null, 2), 'application/json;charset=utf-8');
      toast('success', '项目包已导出（含运行数据）');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(''); }
  };

  const clearLocal = () => {
    if (!window.confirm('清理本机草稿、模板与已读通知缓存？服务端文档/会话不会删除。')) return;
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('sciflow:') || k.startsWith('sciflow-notify-seen:'));
    keys.forEach((k) => localStorage.removeItem(k));
    toast('success', `已清理 ${keys.length} 项本机缓存`);
  };

  return (
    <Card className="p-4">
      <SectionTitle><span className="flex items-center gap-2"><Database size={16} className="text-teal-600" /> 数据管理</span></SectionTitle>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Button size="sm" variant="outline" disabled={!projectId || !!busy} onClick={() => void exportProject()}>
          {busy === 'export' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} 导出项目包
        </Button>
        <Button size="sm" variant="ghost" onClick={clearLocal}><Trash2 size={12} /> 清理本机缓存</Button>
        <span className="text-[11px] text-slate-400">API Token 与权限仍在「扩展与工具 / 权限与角色」；这里不复制一套。</span>
      </div>
      {error && <div className="mt-2"><ErrorBox message={error} /></div>}
    </Card>
  );
}
