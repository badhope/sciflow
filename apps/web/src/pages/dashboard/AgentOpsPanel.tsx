import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, CheckCircle2, Clock3, ListChecks, ShieldCheck, X } from 'lucide-react';
import { api } from '../../api/client';
import { ToastContext } from '../../App';
import { Badge, Button, errMsg } from '../../components/ui';
import { HBar } from '../../components/charts';
import { useAgentInbox } from '../../lib/agent-inbox';
import { qk } from '../../lib/query-keys';

/**
 * AgentOpsPanel —— 驾驶舱里的「Agent 运行」区（P0-6 v1）。
 *
 * 为什么放在项目总览而不是新开一页：
 *  - 计划批准、审批收件箱、任务进度、成本指标都是“项目当前状态”，与阶段/质量门同属首屏决策信息；
 *  - 新开一页会让用户在两处来回跳，且与工作台已有的任务面板重复。
 *
 * 数据边界：
 *  - 工具指标与 run 指标都按项目过滤（llm_call_log 已补 project_id）；
 *  - 任何接口失败都降级为空态，不阻塞项目总览。
 */
export function AgentOpsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [busy, setBusy] = useState<string | null>(null);

  const metricsQuery = useQuery({
    queryKey: ['agent-metrics', projectId],
    queryFn: () => api.agent.metrics(projectId, 7),
    retry: 0,
    refetchInterval: 30_000,
  });
  const plansQuery = useQuery({
    queryKey: ['agent-plans', projectId],
    queryFn: () => api.agent.plans(projectId),
    retry: 0,
    refetchInterval: 15_000,
  });
  const {
    tasksQuery,
    approvalsQuery,
    decideApproval: approvalMutation,
    decidePlan: planMutation,
  } = useAgentInbox(projectId, { tasksInterval: 15_000, approvalsInterval: 15_000 });

  const metrics = metricsQuery.data;
  const recentRuns = metrics?.recentRuns ?? [];
  const tokenTrend = metrics?.byDay ?? [];
  const pendingPlans = (plansQuery.data?.plans ?? []).filter((p) => p.status === 'pending');
  // 只展示已批准计划；过期/耗尽由后端状态机标记，不在前端用 Date.now 二次推断（避免 render 不纯）。
  const activePlans = (plansQuery.data?.plans ?? []).filter((p) => p.status === 'approved');
  const approvals = approvalsQuery.data?.approvals ?? [];
  const summary = tasksQuery.data?.summary;
  const fmtInt = (n: number) => n.toLocaleString('zh-CN');
  const budgetText = (p: { budgetTokens: number; usedTokens: number }) =>
    p.budgetTokens > 0 ? `${fmtInt(p.usedTokens)} / ${fmtInt(p.budgetTokens)} tokens` : '不限';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.agentPlans(projectId) });
    void qc.invalidateQueries({ queryKey: qk.agentApprovals(projectId) });
    void qc.invalidateQueries({ queryKey: qk.agentMetrics(projectId) });
  };

  const decidePlan = async (id: string, approved: boolean) => {
    setBusy(id);
    try {
      await planMutation.mutateAsync({ id, approved });
      toast('success', approved ? '计划已批准：计划内工具将自动放行' : '计划已拒绝');
      refresh();
    } catch (e: unknown) {
      toast('error', errMsg(e) || '计划操作失败');
    } finally {
      setBusy(null);
    }
  };

  const decideApproval = async (id: string, approved: boolean) => {
    setBusy(id);
    try {
      await approvalMutation.mutateAsync({ id, approved });
      toast('success', approved ? '已批准本次工具调用' : '已拒绝本次工具调用');
      refresh();
    } catch (e: unknown) {
      toast('error', errMsg(e) || '审批操作失败');
    } finally {
      setBusy(null);
    }
  };

  const allFailed = metricsQuery.isError && plansQuery.isError && approvalsQuery.isError && tasksQuery.isError;
  if (allFailed) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-400 dark:border-slate-700">
        Agent 运行数据暂不可用（后端未就绪或网络异常），不影响其他功能。
      </div>
    );
  }

  const stat = (label: string, value: string, hint?: string) => (
    <div className="rounded-lg border border-slate-200/80 bg-white/60 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="v2-numeric mt-0.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-slate-400">{hint}</div>}
    </div>
  );

  return (
    <div className="mt-4 border-t border-slate-200/80 pt-3 dark:border-slate-700/80" aria-label="Agent 运行">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Activity size={14} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Agent 运行</span>
        <span className="text-[11px] text-slate-400">近 7 天</span>
        {(pendingPlans.length > 0 || approvals.length > 0) && (
          <Badge tone="amber">{pendingPlans.length + approvals.length} 项待批</Badge>
        )}
        <button type="button" className="ml-auto text-[11px] text-teal-700 hover:underline dark:text-teal-300" onClick={refresh}>
          刷新
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stat('工具调用', metrics ? String(metrics.toolCalls.total) : '—', metrics ? `${metrics.toolCalls.fail} 次失败` : '加载中')}
        {stat('成功率', metrics ? `${metrics.toolCalls.successRate}%` : '—', metrics ? `P95 ${metrics.toolCalls.p95Ms}ms` : '加载中')}
        {stat('运行次数', metrics ? String(metrics.runs.total) : '—', metrics ? `${metrics.runs.error} 次异常` : '加载中')}
        {stat('Token', metrics ? String(metrics.runs.totalTokens) : '—', '仅 run 记录')}
      </div>

      {(recentRuns.length > 0 || tokenTrend.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {recentRuns.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">最近执行</div>
              <ul className="space-y-1">
                {recentRuns.slice(0, 4).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded border border-slate-100 bg-white/60 px-2 py-1 text-[11px] dark:border-slate-800 dark:bg-slate-900/40">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.status === 'done' ? 'bg-emerald-500' : r.status === 'error' ? 'bg-rose-500' : r.status === 'running' ? 'bg-amber-500' : 'bg-slate-400'}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.source}</span>
                    <span className="v2-numeric shrink-0 text-slate-400">{r.tokens ? `${(r.tokens / 1000).toFixed(1)}k` : `${Math.round(r.durationMs / 1000)}s`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tokenTrend.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">Token 用量（近 7 天）</div>
              <HBar
                items={tokenTrend.map((t) => ({ label: t.date.slice(5), value: t.tokens }))}
                formatValue={(v) => `${(v / 1000).toFixed(1)}k`}
              />
            </div>
          )}
        </div>
      )}

      {summary && summary.total > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <ListChecks size={13} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <span>任务清单 {summary.completed}/{summary.total}</span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <span className="block h-full rounded-full bg-teal-500 transition-[width]" style={{ width: `${summary.percent}%` }} />
          </span>
          <span className="v2-numeric">{summary.percent}%</span>
        </div>
      )}

      {activePlans.length > 0 && (
        <div className="mt-3 space-y-2">
          {activePlans.slice(0, 2).map((p) => (
            <div key={p.id} className="rounded-lg border border-teal-200 bg-teal-50/40 p-2.5 dark:border-teal-800 dark:bg-teal-950/20">
              <div className="flex flex-wrap items-center gap-1.5">
                <ShieldCheck size={13} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{p.title}</span>
                <Badge tone="green">生效中</Badge>
                <span className="text-[10px] text-slate-400">步数 {p.usedSteps}/{p.maxSteps}</span>
                <span className="text-[10px] text-slate-400">预算 {budgetText(p)}</span>
              </div>
              {p.budgetTokens > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-900/40">
                    <span
                      className="block h-full rounded-full bg-teal-500 transition-[width]"
                      style={{ width: `${Math.min(100, Math.round((p.usedTokens / p.budgetTokens) * 100))}%` }}
                    />
                  </span>
                  <span className="v2-numeric text-[10px] text-slate-400">
                    {Math.min(100, Math.round((p.usedTokens / p.budgetTokens) * 100))}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pendingPlans.length > 0 && (
        <div className="mt-3 space-y-2">
          {pendingPlans.slice(0, 3).map((p) => (
            <div key={p.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex flex-wrap items-center gap-1.5">
                <ShieldCheck size={13} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{p.title}</span>
                <Badge tone="amber">待批准</Badge>
                <span className="text-[10px] text-slate-400">{p.usedSteps}/{p.maxSteps} 步</span>
                <span className="text-[10px] text-slate-400">预算 {budgetText(p)}</span>
              </div>
              {p.summary && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{p.summary}</p>}
              <div className="mt-1 flex flex-wrap gap-1">
                {p.allowedTools.slice(0, 4).map((t) => (
                  <span key={t} className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                    {t}
                  </span>
                ))}
                {p.allowedTools.length > 4 && <span className="text-[10px] text-slate-400">+{p.allowedTools.length - 4}</span>}
              </div>
              <div className="mt-2 flex gap-1.5">
                <Button className="h-7 px-2 text-[11px]" onClick={() => void decidePlan(p.id, true)} disabled={busy === p.id}>
                  <Check size={12} aria-hidden="true" /> 批准计划
                </Button>
                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void decidePlan(p.id, false)} disabled={busy === p.id}>
                  <X size={12} aria-hidden="true" /> 拒绝
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {approvals.length > 0 && (
        <div className="mt-3 space-y-2">
          {approvals.slice(0, 3).map((a) => (
            <div key={a.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-700 dark:bg-slate-900/30">
              <div className="flex flex-wrap items-center gap-1.5">
                <Clock3 size={13} className="text-slate-400" aria-hidden="true" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{a.toolName}</span>
                <Badge tone="slate">单次审批</Badge>
              </div>
              {a.reason && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{a.reason}</p>}
              <div className="mt-2 flex gap-1.5">
                <Button className="h-7 px-2 text-[11px]" onClick={() => void decideApproval(a.id, true)} disabled={busy === a.id}>
                  <CheckCircle2 size={12} aria-hidden="true" /> 批准
                </Button>
                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void decideApproval(a.id, false)} disabled={busy === a.id}>
                  <X size={12} aria-hidden="true" /> 拒绝
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingPlans.length === 0 && approvals.length === 0 && (
        <div className="mt-2 text-[11px] text-slate-400">
          无待批计划或审批。Agent 在执行写操作前会先申请计划级/单次授权。
        </div>
      )}
    </div>
  );
}
