import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FlaskConical, Play, RefreshCw, X } from 'lucide-react';
import { api } from '../../api/client';
import type { ResearchCycleStatus } from '../../api/research-cycles';
import { ToastContext } from '../../App';
import { Badge, Button, Card, ErrorBox, Input, Spinner, errMsg } from '../../components/ui';
import { StructuredDetails } from '../../components/StructuredDetails';
import { useTabActive } from '../../lib/tab-visibility';
import { CYCLE_STATE, CLAIM_STATUS, RUN_STATUS, labelOf, statusTone } from './labels';

/**
 * 自主研究循环面板（阶段 3+）。
 *
 * 服务端 LangGraph 负责编排（PI→审批→实验→评审→修订回边），
 * 这里只做四件事：发起循环、轮询进度、审批协议、恢复/终止。
 * 轮次、结论、运行都读服务端对象，不在前端另存一份状态。
 */
export function ResearchCycleRunner({
  programId,
  programTitle,
  autonomyLevel,
  onChanged,
}: {
  programId: string;
  programTitle: string;
  autonomyLevel: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const tabActive = useTabActive();
  const toast = useContext(ToastContext);
  const [question, setQuestion] = useState('');
  /** 门禁模式：默认为人工审批（保守）；选择全自动时由独立 AI 专家审批 */
  const [approvalMode, setApprovalMode] = useState<'human' | 'ai'>('human');
  const [busy, setBusy] = useState('');
  const [activeCycleId, setActiveCycleId] = useState('');

  const cyclesQuery = useQuery({
    queryKey: ['research-cycles', programId],
    queryFn: () => api.researchCycles.list(programId),
  });
  const cycles = cyclesQuery.data ?? [];
  // 默认展示最近一轮：listCycles 按 seq 升序，末尾才是最新（取 [0] 会停在最老一轮）
  const cycleId = activeCycleId || cycles[cycles.length - 1]?.id || '';

  const statusQuery = useQuery({
    queryKey: ['research-cycle-status', cycleId],
    queryFn: () => api.researchCycles.status(cycleId),
    enabled: !!cycleId,
    // 循环在服务端跑，前端按固定节奏轮询（自主循环可能持续数分钟）
    refetchInterval: (q) => {
      const s = q.state.data as ResearchCycleStatus | undefined;
      const running = s && !['stopped', 'synthesize', 'blocked'].includes(s.state);
      return tabActive && running ? 3000 : false;
    },
  });
  const status = statusQuery.data;

  const refreshAll = async () => {
    await qc.invalidateQueries({ queryKey: ['research-cycles', programId] });
    await qc.invalidateQueries({ queryKey: ['research-cycle-status', cycleId] });
    onChanged();
  };

  const start = async () => {
    if (!question.trim()) {
      toast('error', '请填写研究问题');
      return;
    }
    setBusy('start');
    try {
      const created = await api.researchCycles.start(programId, { question: question.trim(), approvalMode });
      setQuestion('');
      setActiveCycleId(created.id);
      await refreshAll();
      toast('success', '研究循环已启动');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const resume = async (approved: boolean) => {
    if (!cycleId) return;
    setBusy(approved ? 'approve' : 'reject');
    try {
      await api.researchCycles.resume(cycleId, { approved });
      await refreshAll();
      toast('success', approved ? '已批准方案，循环继续' : '已驳回方案，本轮终止');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const approveProtocol = async (protocolId: string) => {
    setBusy(protocolId);
    try {
      await api.programs.approveProtocol(protocolId);
      await resume(true);
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const recover = async () => {
    if (!cycleId) return;
    setBusy('recover');
    try {
      await api.researchCycles.recover(cycleId);
      await refreshAll();
      toast('success', '已从断点恢复循环');
    } catch (e) {
      toast('error', errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const pendingProtocol = status?.protocols?.find((p) => p.status === 'draft');

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">自主研究循环</h3>
        <span className="text-[11px] text-slate-400">PI → 方案审批 → 实验 → 评审 → 修订（多轮回边）</span>
      </div>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            placeholder="研究问题，例如：X 是否显著提升 Y？"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-label="研究问题"
          />
          <Button size="sm" loading={busy === 'start'} onClick={() => void start()}>
            <Play size={13} /> {approvalMode === 'ai' ? '全自动启动' : '启动循环'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-slate-400">协议审批方式</span>
          <Button
            size="xs"
            variant={approvalMode === 'human' ? 'primary' : 'ghost'}
            aria-pressed={approvalMode === 'human'}
            onClick={() => setApprovalMode('human')}
          >
            人工审批
          </Button>
          <Button
            size="xs"
            variant={approvalMode === 'ai' ? 'primary' : 'ghost'}
            aria-pressed={approvalMode === 'ai'}
            onClick={() => setApprovalMode('ai')}
          >
            全自动（AI 专家审批）
          </Button>
        </div>
        <p className="text-[11px] text-slate-400">
          当前计划「{programTitle}」· 自主等级 {autonomyLevel}。
          {approvalMode === 'human'
            ? '人工审批：每个研究方案都会挂起，等你批准后才会执行实验。'
            : '全自动：不等待人工，由独立 AI 专家审批方案；专家驳回或不可用时本轮终止，不会默认放行。'}
        </p>

        {statusQuery.error ? <ErrorBox message={errMsg(statusQuery.error)} /> : null}

        {status ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Badge tone={statusTone(status.state)}>{labelOf(CYCLE_STATE, status.state)}</Badge>
              <span className="text-slate-400">循环 {status.id.slice(0, 8)}</span>
              <span className="text-slate-400">轮次 {status.seq}</span>
              <span className="text-slate-400">{status.budget?.approvalMode === 'ai' ? 'AI 专家审批' : '人工审批'}</span>
              <span className="text-slate-400">token {status.tokensSpent}</span>
              <Button size="xs" variant="ghost" onClick={() => void refreshAll()}>
                <RefreshCw size={11} /> 刷新
              </Button>
            </div>
            {status.summary ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{status.summary}</p> : null}

            {status.state === 'awaiting_approval' ? (
              <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  循环停在方案审批门禁：方案批准后才会执行实验。请先核对下面的变量、样本、分析方案与风险。
                </p>
                {pendingProtocol ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-amber-700/80 dark:text-amber-300/80">
                      <span>协议 v{pendingProtocol.version}</span>
                      <span className="font-mono">{pendingProtocol.id.slice(0, 8)}</span>
                      <Badge tone="amber">待批</Badge>
                    </div>
                    {pendingProtocol.design && Object.keys(pendingProtocol.design).length > 0 ? (
                      <StructuredDetails value={pendingProtocol.design} title="待批研究方案" defaultOpen />
                    ) : (
                      <div className="rounded border border-amber-200 bg-white/60 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-slate-900/40 dark:text-amber-300">
                        服务端没有返回方案正文，建议先刷新；仍然为空时不要盲目批准。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded border border-amber-200 bg-white/60 px-2.5 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-slate-900/40 dark:text-amber-300">
                    当前没有待批协议对象；继续会按服务端已存方案恢复。
                  </div>
                )}
                <div className="flex gap-1">
                  <Button
                    size="xs"
                    loading={busy === 'approve'}
                    onClick={() => (pendingProtocol ? void approveProtocol(pendingProtocol.id) : void resume(true))}
                  >
                    <Check size={11} /> 批准并继续
                  </Button>
                  <Button size="xs" variant="ghost" loading={busy === 'reject'} onClick={() => void resume(false)}>
                    <X size={11} /> 驳回并终止
                  </Button>
                </div>
              </div>
            ) : null}

            {status.state === 'blocked' ? (
              <div className="space-y-2 rounded border border-rose-300 bg-rose-50 p-2 dark:border-rose-800 dark:bg-rose-950/30">
                <p className="text-[11px] text-rose-800 dark:text-rose-300">
                  循环已停止：可能是智能体失败、看门狗超时或服务重启。若断点仍在，可从断点继续；断点已清理时会提示重新启动。
                </p>
                <Button size="xs" variant="ghost" loading={busy === 'recover'} onClick={() => void recover()}>
                  <RefreshCw size={11} /> 从断点恢复
                </Button>
              </div>
            ) : null}

            {status.claims.length > 0 ? (
              <div className="space-y-1">
                {status.claims.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700"
                  >
                    <Badge tone={statusTone(c.status)}>{labelOf(CLAIM_STATUS, c.status)}</Badge>
                    <span className="min-w-0 flex-1 truncate">{c.statement}</span>
                    <span className="text-slate-400">置信度 {c.confidence}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {status.runs.length > 0 ? (
              <div className="space-y-1">
                {status.runs.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-2 py-1 text-[11px] dark:border-slate-700"
                  >
                    <Badge tone={statusTone(r.status)}>{labelOf(RUN_STATUS, r.status)}</Badge>
                    <span className="text-slate-400">运行 {r.id.slice(0, 8)}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{r.summary}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : cycles.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-[11px] text-slate-400">
            <FlaskConical size={12} /> 还没有研究循环。填一个问题启动第一轮。
          </div>
        ) : (
          <Spinner label="加载循环状态" />
        )}
      </div>
    </Card>
  );
}
