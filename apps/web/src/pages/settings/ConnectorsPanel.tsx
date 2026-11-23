import { useContext, useEffect, useMemo, useState } from 'react';
import { Cable, CheckCircle2, Loader2, PlugZap, RefreshCw, Send, Unplug } from 'lucide-react';
import { api } from '../../api/client';
import type { Project } from '../../types';
import { Badge, Button, Card, ErrorBox, Input, Modal, SectionTitle, errMsg } from '../../components/ui';
import { ToastContext } from '../../App';

const TYPE_LABEL: Record<string, string> = { api: '官方 API', sdk: '官方 SDK', git: '官方 Git' };

export function ConnectorsPanel() {
  const toast = useContext(ToastContext);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [items, setItems] = useState<import('../../api/connectors').ConnectorInfo[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<import('../../api/connectors').ConnectorInfo | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    api.projects.list().then((rows) => {
      setProjects(rows);
      setProjectId((current) => current || rows[0]?.id || '');
    }).catch((e) => setError(errMsg(e)));
  }, []);

  const load = useMemo(() => async () => {
    if (!projectId) return;
    try {
      const r = await api.connectors.list(projectId);
      setItems(r.connectors);
      setError('');
    } catch (e) { setError(errMsg(e)); }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.connectors.list(projectId)
      .then((r) => { if (!cancelled) { setItems(r.connectors); setError(''); } })
      .catch((e: unknown) => { if (!cancelled) setError(errMsg(e)); });
    return () => { cancelled = true; };
  }, [projectId]);

  const run = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(id); setError('');
    try { await fn(); toast('success', success); await load(); }
    catch (e) { setError(errMsg(e)); toast('error', errMsg(e)); }
    finally { setBusy(''); }
  };

  const openConnect = (c: import('../../api/connectors').ConnectorInfo) => {
    setEditing(c);
    setForm(Object.fromEntries(c.fields.map((f) => [f.key, c.masked[f.key] === '••••••' ? '' : c.masked[f.key] || ''])));
  };

  const connect = async () => {
    if (!editing) return;
    await run(`connect-${editing.key}`, () => api.connectors.connect(projectId, editing.key, form), `${editing.name} 已保存凭据`);
    setEditing(null);
  };

  return (
    <Card className="p-4">
      <SectionTitle>
        <span className="flex items-center gap-2"><Cable size={16} className="text-teal-600" /> 连接器</span>
        <span className="ml-auto flex items-center gap-2 text-[11px] font-normal text-slate-400">
          国内平台优先 · 凭据本地加密
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
      </SectionTitle>
      <div className="mt-3 text-[11px] text-slate-400">凭据经 secret-crypto 加密存本地；测试与最近错误都会落状态，不写日志。</div>
      {error && <div className="mt-2"><ErrorBox message={error} /></div>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((c) => (
          <div key={c.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${c.connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.name}</span>
              <Badge tone="slate">{TYPE_LABEL[c.type] || c.type}</Badge>
              {c.status && <Badge tone={c.status.ok ? 'green' : 'amber'}>{c.status.ok ? '正常' : '异常'}</Badge>}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{c.description}</div>
            {c.status && <div className="mt-1 text-[10px] text-slate-400">{c.status.message} · {new Date(c.status.checkedAt).toLocaleString('zh-CN', { hour12: false })}</div>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!c.connected ? (
                <Button size="sm" variant="outline" onClick={() => openConnect(c)}><PlugZap size={12} /> 连接</Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run(`test-${c.key}`, () => api.connectors.test(projectId, c.key), `${c.name} 测试通过`)}>
                    {busy === `test-${c.key}` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} 测试
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => openConnect(c)}>改凭据</Button>
                  <Button size="sm" variant="ghost" className="text-rose-500" disabled={!!busy} onClick={() => void run(`dis-${c.key}`, () => api.connectors.disconnect(projectId, c.key), `${c.name} 已断开`)}>
                    <Unplug size={12} /> 断开
                  </Button>
                </>
              )}
              {c.key === 'zotero' && c.connected && (
                <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => void run('zotero-import', () => api.connectors.zoteroImport(projectId, 10), 'Zotero 已拉取 10 条（重复条目自动标记）')}>
                  <RefreshCw size={12} /> 拉取 10 条
                </Button>
              )}
              {c.key === 'feishu' && c.connected && (
                <>
                  <Button size="sm" variant="subtle" disabled={!!busy} onClick={() => void run('feishu-notify', () => api.connectors.feishuNotify(projectId, 'SciFlow 连接测试通知'), '飞书通知已发送')}>
                    <Send size={12} /> 发测试通知
                  </Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => {
                    const id = window.prompt('飞书文档 ID（docx token）');
                    if (id) void run('feishu-import', () => api.connectors.feishuImportDoc(projectId, id.trim()), '飞书文档已导入知识库');
                  }}>导入文档</Button>
                </>
              )}
            </div>
            {!c.connected && <div className="mt-1 text-[10px] text-slate-400">未配置凭据；连接失败会返回可读错误。</div>}
          </div>
        ))}
        {items.length === 0 && <div className="text-xs text-slate-400">加载中…</div>}
      </div>

      <Modal open={!!editing} title={`连接 ${editing?.name || ''}`} onClose={() => setEditing(null)} width="max-w-lg">
        {editing && (
          <div className="space-y-2.5">
            {editing.fields.map((f) => (
              <label key={f.key} className="block text-xs text-slate-600 dark:text-slate-300">
                <span className="mb-1 block">{f.label}</span>
                <Input type={f.secret ? 'password' : 'text'} value={form[f.key] || ''} placeholder={f.placeholder || ''} onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))} autoComplete="off" />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditing(null)}>取消</Button>
              <Button disabled={!!busy} onClick={() => void connect()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} 保存并测试</Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
