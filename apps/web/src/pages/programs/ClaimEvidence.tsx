import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { ToastContext } from '../../App';
import type { ResearchClaim } from '../../types';
import { Badge, Button, Input, Select, Spinner, errMsg } from '../../components/ui';
import {
  CLAIM_STATUS,
  EVIDENCE_SOURCE,
  EVIDENCE_STANCE,
  labelOf,
  statusTone,
} from './labels';

const SOURCE_OPTIONS = Object.entries(EVIDENCE_SOURCE).map(([value, label]) => ({ value, label }));
const STANCE_OPTIONS = Object.entries(EVIDENCE_STANCE).map(([value, label]) => ({ value, label }));

export function ClaimEvidence({ claim, onChanged }: { claim: ResearchClaim; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [open, setOpen] = useState(false);
  const [sourceType, setSourceType] = useState('experiment');
  const [stance, setStance] = useState('supports');
  const [strength, setStrength] = useState('3');
  const [quote, setQuote] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState('');

  const evidenceQuery = useQuery({
    queryKey: ['evidence', claim.id],
    queryFn: () => api.programs.listEvidence(claim.id),
    enabled: open,
  });

  const addEvidence = async () => {
    const n = Number(strength);
    if (!Number.isFinite(n) || n < 1 || n > 5) {
      toast('error', '证据强度需为 1-5');
      return;
    }
    setBusy('add');
    try {
      await api.programs.addEvidence(claim.id, {
        sourceType,
        stance,
        strength: n,
        quote: quote.trim(),
        sourceId: sourceId.trim(),
      });
      setQuote('');
      setSourceId('');
      await qc.invalidateQueries({ queryKey: ['evidence', claim.id] });
      onChanged();
      toast('success', '已登记证据');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const verify = async (evidenceId: string, verified: boolean) => {
    setBusy(evidenceId);
    try {
      await api.programs.verifyEvidence(evidenceId, verified);
      await qc.invalidateQueries({ queryKey: ['evidence', claim.id] });
      onChanged();
      toast('success', verified ? '证据已标记为已核验' : '证据已取消核验');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const evidence = evidenceQuery.data ?? [];

  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-200">{claim.statement}</span>
        <Badge tone={statusTone(claim.status)}>{labelOf(CLAIM_STATUS, claim.status)}</Badge>
        <span className="text-[11px] text-slate-400">置信度 {claim.confidence}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_90px]">
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              来源类型
              <Select options={SOURCE_OPTIONS} value={sourceType} onChange={setSourceType} ariaLabel="证据来源类型" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              立场
              <Select options={STANCE_OPTIONS} value={stance} onChange={setStance} ariaLabel="证据立场" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              强度
              <Input type="number" min={1} max={5} value={strength} onChange={(e) => setStrength(e.target.value)} aria-label="证据强度" />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
            <Input placeholder="来源 ID（可选）" value={sourceId} onChange={(e) => setSourceId(e.target.value)} />
            <Input placeholder="证据摘录/说明" value={quote} onChange={(e) => setQuote(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" loading={busy === 'add'} onClick={() => void addEvidence()}>
              <Plus size={13} /> 登记证据
            </Button>
          </div>

          {evidenceQuery.isLoading && <Spinner label="加载证据…" />}
          {evidence.map((e) => (
            <div key={e.id} className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{labelOf(EVIDENCE_SOURCE, e.sourceType)}</span>
                <Badge tone={e.stance === 'refutes' ? 'red' : e.stance === 'supports' ? 'green' : 'amber'}>
                  {labelOf(EVIDENCE_STANCE, e.stance)}
                </Badge>
                <span className="text-slate-400">强度 {e.strength}</span>
                <span className={e.verified ? 'text-emerald-600' : 'text-slate-400'}>{e.verified ? '已核验' : '未核验'}</span>
                {!e.verified && (
                  <Button size="xs" variant="outline" loading={busy === e.id} onClick={() => void verify(e.id, true)}>
                    <Check size={11} /> 核验
                  </Button>
                )}
              </div>
              {e.quote && <p className="mt-1 text-slate-600 dark:text-slate-300">{e.quote}</p>}
              {e.sourceId && <p className="text-slate-400">来源：{e.sourceId}</p>}
            </div>
          ))}
          {!evidenceQuery.isLoading && evidence.length === 0 && (
            <div className="text-[11px] text-slate-400">还没有证据；登记支持/反驳材料后再核验。</div>
          )}
        </div>
      )}
    </div>
  );
}
