import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, CircleAlert, Cpu, Download, HardDrive, Loader2, RefreshCw,
  Terminal, Trash2, XCircle, Zap,
} from 'lucide-react';
import { api } from '../../api/client';
import type { LocalModelInfo, LocalModelInstallResult, OllamaStatus } from '../../types';
import { Badge, Button, Card, SectionTitle, errMsg } from '../../components/ui';
import { useSettings } from './settings-context';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function formatSpeed(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${formatBytes(n)}/s`;
}

/** 下载进度条：只在 downloading/verifying 时出现，避免已安装卡片长期显示 100% 进度 */
function DownloadProgress({ model }: { model: LocalModelInfo }) {
  const pct = model.status === 'verifying'
    ? 100
    : model.downloadedBytes > 0 && model.sizeBytes > 0
      ? Math.min(100, Math.round((model.downloadedBytes / model.sizeBytes) * 100))
      : 0;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
        <span>{model.status === 'verifying' ? '校验 SHA256…' : `下载中 ${pct}%`}</span>
        <span>{formatBytes(model.downloadedBytes)} / {formatBytes(model.sizeBytes)} {formatSpeed(model.speedBps)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function LocalModels() {
  const { load, toast } = useSettings();
  const [models, setModels] = useState<LocalModelInfo[]>([]);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [installMsg, setInstallMsg] = useState<Record<string, LocalModelInstallResult>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [list, ollamaStatus] = await Promise.all([api.settings.localModels.list(), api.settings.localModels.ollama()]);
      setModels(list);
      setOllama(ollamaStatus);
      setError('');
    } catch (e: unknown) {
      if (!silent) setError(errMsg(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // 首次进入主动拉取一次；refresh 内部是异步请求，这里只是触发，不是同步派生 state
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  // 有任务在下载时轮询；没有下载就停止，不常驻请求
  useEffect(() => {
    const active = models.some((m) => m.status === 'downloading' || m.status === 'verifying');
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    if (!active) return;
    timer.current = setInterval(() => { void refresh(true); }, 1200);
    return () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [models, refresh]);

  const download = async (id: string) => {
    setBusyId(id);
    setInstallMsg((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    try {
      const updated = await api.settings.localModels.download(id);
      setModels((list) => list.map((m) => (m.id === id ? updated : m)));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusyId('');
    }
  };

  const cancel = async (id: string) => {
    setBusyId(id);
    try {
      const updated = await api.settings.localModels.cancel(id);
      setModels((list) => list.map((m) => (m.id === id ? { ...m, ...updated } : m)));
      toast('info', '已取消下载');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusyId('');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('删除本地模型文件？已创建的 Ollama 模型不会自动删除。')) return;
    setBusyId(id);
    try {
      await api.settings.localModels.remove(id);
      await refresh(true);
      toast('success', '模型文件已删除');
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusyId('');
    }
  };

  const install = async (id: string) => {
    setBusyId(id);
    setInstallMsg((m) => ({ ...m, [id]: { ok: true, message: '正在导入 Ollama…' } }));
    try {
      const result = await api.settings.localModels.install(id);
      setInstallMsg((m) => ({ ...m, [id]: result }));
      if (result.ok) {
        toast('success', '已导入 Ollama；未自动切换默认模型');
        await load();
      }
      await refresh(true);
    } catch (e: unknown) {
      const result: LocalModelInstallResult = { ok: false, message: errMsg(e) };
      setInstallMsg((m) => ({ ...m, [id]: result }));
    } finally {
      setBusyId('');
    }
  };

  return (
    <Card className="p-5 mb-4">
      <SectionTitle
        extra={
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 刷新
          </Button>
        }
      >
        <span className="flex items-center gap-2">
          <HardDrive size={16} className="text-teal-600" /> 本地模型（可选下载）
        </span>
      </SectionTitle>

      <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        这里只是可选清单：下载后校验 SHA256，再导入本机 Ollama 并登记为 OpenAI-compatible 厂商，但不会替你切换默认模型。用哪个本地模型，由你在模型列表里自己选。
      </div>

      {ollama && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-xs flex items-start gap-2 ${
          ollama.ok
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/15 dark:text-emerald-300'
            : 'border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/15 dark:text-amber-200'
        }`}>
          {ollama.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <CircleAlert size={14} className="mt-0.5 shrink-0" />}
          <div>
            {ollama.ok
              ? `已检测到本机 Ollama${ollama.models != null ? `（${ollama.models} 个模型）` : ''}，下载完成后可一键导入；不会替你切换默认模型。`
              : '未检测到本机 Ollama。请先安装并启动 Ollama，再回来点「导入 Ollama」；也可用 LM Studio / llama.cpp 手动加载下载好的 GGUF。'}
            <p className="mt-1 text-[11px] leading-5 text-amber-700/80 dark:text-amber-200/70">
              手动加载请使用 GGUF 自带 chat template 并保留 BOS；MiniCPM5-1B 若用裸 ChatML 且缺 BOS，会输出连续的 <code>****</code> 退化文本，不是模型损坏。
            </p>
            {!ollama.ok && (
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-amber-800/80 dark:text-amber-200/80">
                <Terminal size={12} /> ollama serve
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className="mb-3 text-xs text-rose-500">{error}</div>}

      {loading && models.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-4"><Loader2 size={14} className="animate-spin" /> 读取本地模型目录…</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {models.map((m) => {
            const busy = busyId === m.id;
            const pct = m.sizeBytes > 0 ? Math.min(100, Math.round((m.downloadedBytes / m.sizeBytes) * 100)) : 0;
            const result = installMsg[m.id];
            return (
              <div key={m.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{m.name}</span>
                      {m.toolCalling && <Badge tone="green">工具调用</Badge>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{m.vendor} · {m.params} · {m.quantization}</div>
                  </div>
                  <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
                    <div className="font-mono">{formatBytes(m.sizeBytes)}</div>
                    <div>{m.license}</div>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="slate">原生上下文 {Math.round(m.contextWindow / 1024)}K</Badge>
                  <Badge tone="slate">本地运行 {Math.round(m.runtimeContextWindow / 1024)}K</Badge>
                  {m.highlights.slice(0, 3).map((h) => <Badge key={h} tone="slate">{h}</Badge>)}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{m.description}</p>
                {m.note && (
                  <div className="mt-2 rounded-md bg-amber-50/60 dark:bg-amber-900/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                    {m.note}
                  </div>
                )}

                {(m.status === 'downloading' || m.status === 'verifying') && <DownloadProgress model={m} />}
                {m.status === 'error' && <div className="mt-2 text-[11px] text-rose-500">下载失败：{m.error || '未知错误'}</div>}

                {m.installed && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={13} /> 已下载并校验 · <span className="font-mono truncate">{m.filePath}</span>
                  </div>
                )}

                <div className="mt-auto pt-3 flex flex-wrap items-center gap-2">
                  {m.installed ? (
                    <>
                      <Button
                        variant="success"
                        size="sm"
                        disabled={busy || !ollama?.ok}
                        onClick={() => void install(m.id)}
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} 导入 Ollama（不切换）
                      </Button>
                      <Button variant="ghost" size="sm" className="text-rose-500" disabled={busy} onClick={() => void remove(m.id)}>
                        <Trash2 size={13} /> 删除文件
                      </Button>
                    </>
                  ) : m.status === 'downloading' || m.status === 'verifying' ? (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void cancel(m.id)}>
                      <XCircle size={13} /> 取消下载
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void download(m.id)}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                      {m.status === 'error' || m.status === 'cancelled' ? '重新下载' : `下载 · ${formatBytes(m.sizeBytes)}`}
                    </Button>
                  )}
                  {m.installed && m.providerName && (
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">已建厂商：{m.providerName}</span>
                  )}
                  {!m.installed && pct > 0 && m.status !== 'downloading' && (
                    <span className="text-[11px] text-slate-400">已下载 {pct}%</span>
                  )}
                </div>

                {result && !result.ok && (
                  <div className="mt-2 rounded-md border border-rose-200 bg-rose-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-rose-600 dark:border-rose-900/50 dark:bg-rose-900/10 dark:text-rose-300">
                    {result.message || '导入失败'}
                  </div>
                )}
                {result?.ok && result.message && (
                  <div className="mt-2 text-[11px] text-teal-600 dark:text-teal-400">{result.message}</div>
                )}
                {result?.ok && result.ollamaModel && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <Cpu size={12} /> Ollama 模型：<span className="font-mono">{result.ollamaModel}</span> · 已导入，未自动切换
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
