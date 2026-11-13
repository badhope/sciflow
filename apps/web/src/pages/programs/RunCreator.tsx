import { useContext, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Play, Plus, X } from 'lucide-react';
import { api } from '../../api/client';
import { ToastContext } from '../../App';
import type { ResearchProtocol, ResearchRun } from '../../types';
import { Badge, Button, Input, Select, Textarea, errMsg } from '../../components/ui';
import { RUN_STATUS, labelOf, statusTone } from './labels';

const DEFAULT_MANIFEST = `{
  "environment": "",
  "seed": 42,
  "inputs": []
}`;

export function RunCreator({
  programId,
  protocols,
  runs,
  onChanged,
}: {
  programId: string;
  protocols: ResearchProtocol[];
  runs: ResearchRun[];
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [protocolId, setProtocolId] = useState('');
  const [manifest, setManifest] = useState(DEFAULT_MANIFEST);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState('');

  const approved = useMemo(() => protocols.filter((p) => p.status === 'approved'), [protocols]);
  const protocolOptions = approved.map((p) => ({
    value: p.id,
    label: `方案 v${p.version} · ${p.approvedAt ? new Date(p.approvedAt).toLocaleDateString('zh-CN') : '已批准'}`,
  }));

  const createRun = async () => {
    if (!protocolId) {
      toast('error', '请选择已批准的研究协议');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifest);
    } catch {
      toast('error', 'manifest 不是合法 JSON');
      return;
    }
    setBusy('create');
    try {
      await api.programs.createRun(programId, {
        protocolId,
        manifest: parsed,
        summary: summary.trim(),
        status: 'pending',
      });
      setSummary('');
      await qc.invalidateQueries({ queryKey: ['program-runs', programId] });
      onChanged();
      toast('success', '已创建研究运行（待开始）');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const setStatus = async (runId: string, status: string) => {
    setBusy(runId);
    try {
      await api.programs.updateRun(runId, { status });
      await qc.invalidateQueries({ queryKey: ['program-runs', programId] });
      onChanged();
      toast('success', status === 'running' ? '运行已开始' : status === 'completed' ? '运行已完成' : '运行已更新');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-3">
      {approved.length === 0 ? (
        <div className="rounded border border-dashed border-slate-200 px-2.5 py-2 text-[11px] text-slate-400 dark:border-slate-700">
          还没有已批准协议。先在“研究问题 → 假设 → 方案”里批准一个方案，才能创建运行。
        </div>
      ) : (
        <div className="space-y-2 rounded border border-slate-200 p-2 dark:border-slate-700">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.2fr]">
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              已批准协议
              <Select options={protocolOptions} value={protocolId} onChange={setProtocolId} ariaLabel="已批准协议" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              运行摘要（可选）
              <Input placeholder="例如：基线复现，seed=42" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            Run Manifest（JSON）
            <Textarea className="text-[11px]" rows={4} value={manifest} onChange={(e) => setManifest(e.target.value)} aria-label="Run Manifest JSON" />
          </label>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" loading={busy === 'create'} onClick={() => void createRun()}>
              <Plus size={13} /> 创建运行
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {runs.map((r) => (
          <div key={r.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">运行 {r.id.slice(0, 8)}</span>
                <Badge tone={statusTone(r.status)}>{labelOf(RUN_STATUS, r.status)}</Badge>
                <span className="text-[11px] text-slate-400">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—'} →{' '}
                  {r.endedAt ? new Date(r.endedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}
                </span>
                <span className="text-[11px] text-slate-400">manifest {Object.keys(r.manifest || {}).length} 项</span>
              </div>
              <div className="flex gap-1">
                {r.status === 'pending' && (
                  <Button size="xs" variant="outline" loading={busy === r.id} onClick={() => void setStatus(r.id, 'running')}>
                    <Play size={11} /> 开始
                  </Button>
                )}
                {r.status === 'running' && (
                  <>
                    <Button size="xs" variant="outline" loading={busy === r.id} onClick={() => void setStatus(r.id, 'completed')}>
                      <Check size={11} /> 完成
                    </Button>
                    <Button size="xs" variant="ghost" loading={busy === r.id} onClick={() => void setStatus(r.id, 'failed')}>
                      <X size={11} /> 失败
                    </Button>
                  </>
                )}
              </div>
            </div>
            {r.summary && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{r.summary}</p>}
            {r.protocolId && <p className="mt-1 text-[11px] text-slate-400">协议 {r.protocolId.slice(0, 8)}</p>}
          </div>
        ))}
        {runs.length === 0 && <div className="py-2 text-center text-[11px] text-slate-400">还没有研究运行</div>}
      </div>
    </div>
  );
}
