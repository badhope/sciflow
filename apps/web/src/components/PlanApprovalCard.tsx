import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { api } from '../api/client';
import type { AgentPlanItem } from '../api/agent';
import { Button, errMsg } from './ui';
import { StructuredDetails } from './StructuredDetails';
import { qk } from '../lib/query-keys';

/**
 * 研究计划批准卡：把计划审批放回对话入口。
 *
 * 后端 request_research_plan 会挂起等待 decide()；用户在这里点「批准并继续」后，
 * 正在流式输出的 Agent 会立刻恢复，不需要离开工作台去驾驶舱，也不需要再发一句“继续”。
 * 如果对话已经结束（等待超时），则由父组件自动发起一次续跑。
 */
export function PlanApprovalCard({
  projectId,
  streaming,
  onApproved,
}: {
  projectId: string;
  streaming: boolean;
  onApproved?: (plan: AgentPlanItem, wasStreaming: boolean) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const plansQuery = useQuery({
    queryKey: qk.agentPlans(projectId),
    queryFn: () => api.agent.plans(projectId),
    retry: 0,
    // 计划是在流式过程中才创建的；轮询让卡片在 2 秒内出现，而不是等整轮结束。
    refetchInterval: 2_000,
  });

  const pending = (plansQuery.data?.plans ?? []).filter((p) => p.status === 'pending');
  if (!pending.length) return null;

  const decide = async (plan: AgentPlanItem, approved: boolean) => {
    setBusy(plan.id);
    setError('');
    try {
      await api.agent.decidePlan(plan.id, approved);
      void qc.invalidateQueries({ queryKey: qk.agentPlans(projectId) });
      if (approved) onApproved?.(plan, streaming);
    } catch (e: unknown) {
      setError(errMsg(e) || '计划操作失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="region"
      aria-label="研究计划待批准"
      className="rounded-xl border border-amber-300/80 bg-amber-50/70 px-3 py-2.5 shrink-0 dark:border-amber-700/70 dark:bg-amber-950/20"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={14} className="text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <span className="text-[11px] font-semibold tracking-wide text-amber-800 dark:text-amber-200">
          研究计划待批准 · {pending.length} 项
        </span>
        <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80">
          {streaming ? 'Agent 正在等待，批准后自动继续' : '对话已结束，批准后自动续跑'}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {pending.map((plan) => (
          <div key={plan.id} className="rounded-lg border border-amber-200/80 bg-white/70 px-2.5 py-2 dark:border-amber-800/60 dark:bg-slate-900/40">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{plan.title}</div>
                {plan.summary && (
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{plan.summary}</div>
                )}
                {plan.plan && Object.keys(plan.plan).length > 0 && (
                  <StructuredDetails value={plan.plan} className="mt-1.5" />
                )}
                <div className="mt-1 flex flex-wrap gap-1">
                  {plan.allowedTools.slice(0, 5).map((t) => (
                    <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {t}
                    </span>
                  ))}
                  {plan.allowedTools.length > 5 && (
                    <span className="text-[10px] text-slate-400">+{plan.allowedTools.length - 5}</span>
                  )}
                  <span className="text-[10px] text-slate-400">最多 {plan.maxSteps} 步</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="xs"
                  variant="success"
                  loading={busy === plan.id}
                  disabled={!!busy && busy !== plan.id}
                  onClick={() => void decide(plan, true)}
                  title="批准后 Agent 立即继续执行"
                >
                  <Check size={12} /> 批准并继续
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void decide(plan, false)}
                  title="拒绝这份计划"
                >
                  <X size={12} /> 拒绝
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-300">
          {error}
        </div>
      )}
      {busy && (
        <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300" role="status">
          <Loader2 size={11} className="animate-spin" /> 正在提交计划决定…
        </div>
      )}
    </div>
  );
}
