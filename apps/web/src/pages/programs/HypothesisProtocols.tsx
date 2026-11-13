import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { ToastContext } from '../../App';
import type { ResearchHypothesis, ResearchQuestion } from '../../types';
import { Badge, Button, Input, Spinner, Textarea, errMsg } from '../../components/ui';
import {
  HYPOTHESIS_STATUS,
  PROTOCOL_STATUS,
  QUESTION_STATUS,
  labelOf,
  statusTone,
} from './labels';

const EMPTY_DESIGN = `{
  "variables": [],
  "controls": [],
  "analysis": ""
}`;

export function QuestionBlock({ question, onChanged }: { question: ResearchQuestion; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState('');

  const hypothesesQuery = useQuery({
    queryKey: ['hypotheses', question.id],
    queryFn: () => api.programs.listHypotheses(question.id),
    enabled: open,
  });

  const createHypothesis = async () => {
    if (!statement.trim()) {
      toast('error', '假设陈述不能为空');
      return;
    }
    setBusy('hypothesis');
    try {
      await api.programs.createHypothesis(question.id, {
        statement: statement.trim(),
        rationale: rationale.trim(),
      });
      setStatement('');
      setRationale('');
      await qc.invalidateQueries({ queryKey: ['hypotheses', question.id] });
      onChanged();
      toast('success', '已创建研究假设');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const hypotheses = hypothesesQuery.data ?? [];

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1 text-xs text-slate-700 dark:text-slate-200">{question.question}</span>
        <Badge tone={statusTone(question.status)}>{labelOf(QUESTION_STATUS, question.status)}</Badge>
        {open && <span className="text-[11px] text-slate-400">{hypotheses.length} 假设</span>}
      </button>

      {open && (
        <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-2 dark:border-slate-800">
          <div className="grid gap-2">
            <Input placeholder="假设陈述（可证伪）" value={statement} onChange={(e) => setStatement(e.target.value)} />
            <Input placeholder="理由/机制（可选）" value={rationale} onChange={(e) => setRationale(e.target.value)} />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" loading={busy === 'hypothesis'} onClick={() => void createHypothesis()}>
                <Plus size={13} /> 添加假设
              </Button>
            </div>
          </div>
          {hypothesesQuery.isLoading && <Spinner label="加载假设…" />}
          {hypotheses.map((h) => (
            <HypothesisRow key={h.id} hypothesis={h} onChanged={onChanged} />
          ))}
          {!hypothesesQuery.isLoading && hypotheses.length === 0 && (
            <div className="px-1 py-1 text-[11px] text-slate-400">还没有假设；先提出一个可证伪的陈述。</div>
          )}
        </div>
      )}
    </div>
  );
}

function HypothesisRow({ hypothesis, onChanged }: { hypothesis: ResearchHypothesis; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [open, setOpen] = useState(false);
  const [design, setDesign] = useState(EMPTY_DESIGN);
  const [busy, setBusy] = useState('');

  const protocolsQuery = useQuery({
    queryKey: ['protocols', hypothesis.id],
    queryFn: () => api.programs.listProtocols(hypothesis.id),
    enabled: open,
  });

  const createProtocol = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(design);
    } catch {
      toast('error', '方案 design 不是合法 JSON');
      return;
    }
    setBusy('protocol');
    try {
      await api.programs.createProtocol(hypothesis.id, { design: parsed });
      await qc.invalidateQueries({ queryKey: ['protocols', hypothesis.id] });
      await qc.invalidateQueries({ queryKey: ['program-protocols'] });
      onChanged();
      toast('success', '已创建协议草稿');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const approve = async (protocolId: string) => {
    setBusy(protocolId);
    try {
      await api.programs.approveProtocol(protocolId);
      await qc.invalidateQueries({ queryKey: ['protocols', hypothesis.id] });
      await qc.invalidateQueries({ queryKey: ['program-protocols'] });
      onChanged();
      toast('success', '协议已批准，可创建运行');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const protocols = protocolsQuery.data ?? [];

  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/40">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-slate-400" />}
        <span className="min-w-0 flex-1 text-xs">{hypothesis.statement}</span>
        <Badge tone={statusTone(hypothesis.status)}>{labelOf(HYPOTHESIS_STATUS, hypothesis.status)}</Badge>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-slate-200/70 pt-2 dark:border-slate-700">
          {hypothesis.rationale && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hypothesis.rationale}</p>}
          <Textarea className="text-[11px]" rows={5} value={design} onChange={(e) => setDesign(e.target.value)} aria-label="协议 design JSON" />
          <div className="flex justify-end">
            <Button size="sm" variant="outline" loading={busy === 'protocol'} onClick={() => void createProtocol()}>
              <Plus size={13} /> 添加协议版本
            </Button>
          </div>
          {protocolsQuery.isLoading && <Spinner label="加载协议…" />}
          {protocols.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900">
              <span className="font-medium">方案 v{p.version}</span>
              <Badge tone={statusTone(p.status)}>{labelOf(PROTOCOL_STATUS, p.status)}</Badge>
              <span className="text-slate-400">{p.approvedAt ? new Date(p.approvedAt).toLocaleString('zh-CN', { hour12: false }) : '未审批'}</span>
              {p.status === 'draft' && (
                <Button size="xs" variant="outline" loading={busy === p.id} onClick={() => void approve(p.id)}>
                  <Check size={12} /> 批准
                </Button>
              )}
            </div>
          ))}
          {!protocolsQuery.isLoading && protocols.length === 0 && <div className="text-[11px] text-slate-400">还没有协议版本。</div>}
        </div>
      )}
    </div>
  );
}
