import { useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CalendarClock, Check, CheckCircle2, ChevronRight, Clock3, ListChecks, Play, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import { api } from '../../api/client';
import { openSse } from '../../api/core';
import { ToastContext } from '../../App';
import { Badge, Button, Modal, Spinner, errMsg } from '../../components/ui';
import { StructuredDetails } from '../../components/StructuredDetails';
import { HBar } from '../../components/charts';
import { useAgentInbox } from '../../lib/agent-inbox';
import { useBrowserNotifications, requestBrowserNotifyPermission } from '../../lib/browser-notify';
import { BellRing } from 'lucide-react';
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
/** 计划工具白名单标签：待批与生效计划共用，避免两套切片/溢出逻辑。 */
function ToolChips({ tools }: { tools: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tools.slice(0, 4).map((t) => (
        <span key={t} className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
          {t}
        </span>
      ))}
      {tools.length > 4 && <span className="text-[10px] text-slate-400">+{tools.length - 4}</span>}
    </div>
  );
}

/** 绝对有效期展示：不在 render 里调用 Date.now，避免 React 纯渲染规则与时间抖动。 */
function formatExpiry(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AgentOpsPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const toast = useContext(ToastContext);
  const [busy, setBusy] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [bgMessage, setBgMessage] = useState('');
  const [bgBusy, setBgBusy] = useState(false);
  const [schedName, setSchedName] = useState('每日科研简报');
  const [schedMessage, setSchedMessage] = useState('检索本领域最新文献，给出 3 条值得读的论文和一句话理由。');
  const [schedCadence, setSchedCadence] = useState<'daily' | 'hourly' | 'weekly'>('daily');
  const [schedHour, setSchedHour] = useState(9);
  const [schedMinute, setSchedMinute] = useState(0);
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedTrigger, setSchedTrigger] = useState<'time' | 'reference.created' | 'pipeline.completed' | 'quality.threshold' | 'experiment.failed'>('time');
  const [schedThreshold, setSchedThreshold] = useState(80);
  const [schedFeishu, setSchedFeishu] = useState(false);
  const [schedWebhook, setSchedWebhook] = useState('');
  const [notifyPermission, setNotifyPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

  const metricsQuery = useQuery({
    queryKey: qk.agentMetrics(projectId),
    queryFn: () => api.agent.metrics(projectId, 7),
    retry: 0,
    refetchInterval: 30_000,
  });
  const executionsQuery = useQuery({
    queryKey: qk.agentExecutions(projectId),
    queryFn: () => api.agent.executions(projectId, 10),
    retry: 0,
    refetchInterval: 30_000,
  });
  const runQuery = useQuery({
    queryKey: qk.agentRun(runId ?? ''),
    queryFn: () => api.agent.getRun(runId as string),
    enabled: Boolean(runId),
    retry: 0,
  });
  const backgroundQuery = useQuery({
    queryKey: ['agent-background', projectId],
    queryFn: () => api.agent.backgroundJobs(projectId, 10),
    retry: 0,
    refetchInterval: 15_000,
  });
  const schedulesQuery = useQuery({
    queryKey: ['agent-schedules', projectId],
    queryFn: () => api.agent.schedules(projectId),
    retry: 0,
    refetchInterval: 30_000,
  });
  const plansQuery = useQuery({
    queryKey: qk.agentPlans(projectId),
    queryFn: () => api.agent.plans(projectId),
    retry: 0,
    refetchInterval: 15_000,
  });
  const {
    tasksQuery,
    approvalsQuery,
    decideApproval: approvalMutation,
    decidePlan: planMutation,
    notificationsQuery,
    markNotificationRead,
    markAllNotificationsRead,
    retryNotification,
  } = useAgentInbox(projectId, { tasksInterval: 15_000, approvalsInterval: 15_000, notificationsInterval: 5_000 });

  // Agent 任务 SSE：有变化时统一失效查询；15s 轮询保留为断线降级。
  const [live, setLive] = useState(false);
  const notifications = notificationsQuery.data?.notifications ?? [];
  useBrowserNotifications(notifications, `sciflow-notify-seen:${projectId}`);
  useEffect(() => {
    const close = openSse<{ tasks: unknown[]; summary: unknown; approvals: unknown[]; plans: unknown[] }>(
      `/api/agent/events?projectId=${encodeURIComponent(projectId)}`,
      {
        onOpen: () => setLive(true),
        onData: () => {
          void qc.invalidateQueries({ queryKey: qk.agentTasks(projectId) });
          void qc.invalidateQueries({ queryKey: qk.agentApprovals(projectId) });
          void qc.invalidateQueries({ queryKey: qk.agentPlans(projectId) });
        },
        onError: () => setLive(false),
      },
    );
    return () => {
      setLive(false);
      close();
    };
  }, [projectId, qc]);

  const metrics = metricsQuery.data;
  const executions = executionsQuery.data?.executions;
  const recentRuns = executions
    ? executions.map((e) => ({
        id: e.id,
        source: e.source,
        status: e.status,
        durationMs: e.durationMs,
        tokens: e.totalTokens,
        createdAt: e.createdAt,
      }))
    : metrics?.recentRuns ?? [];
  const tokenTrend = metrics?.byDay ?? [];
  const runDetail = runQuery.data && Array.isArray(runQuery.data.steps) ? runQuery.data : undefined;
  const runLoadError = runQuery.error
    ? errMsg(runQuery.error)
    : runQuery.data && !Array.isArray(runQuery.data.steps)
      ? '服务端未返回这次执行的详情'
      : '';
  const pendingPlans = (plansQuery.data?.plans ?? []).filter((p) => p.status === 'pending');
  // 只展示已批准计划；过期/耗尽由后端状态机标记，不在前端用 Date.now 二次推断（避免 render 不纯）。
  const activePlans = (plansQuery.data?.plans ?? []).filter((p) => p.status === 'approved');
  const approvals = approvalsQuery.data?.approvals ?? [];
  const summary = tasksQuery.data?.summary;
  const fmtInt = (n: number) => n.toLocaleString('zh-CN');
  const budgetText = (p: { budgetTokens: number; usedTokens: number }) =>
    p.budgetTokens > 0 ? `${fmtInt(p.usedTokens)} / ${fmtInt(p.budgetTokens)} tokens` : '不限';
  const fmtTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });
  const runStatus = (status: string) => {
    if (status === 'done') return { label: '完成', tone: 'green' as const };
    if (status === 'error') return { label: '异常', tone: 'red' as const };
    if (status === 'running') return { label: '运行中', tone: 'amber' as const };
    if (status === 'cancelled') return { label: '已中止', tone: 'slate' as const };
    return { label: status || '未知', tone: 'slate' as const };
  };
  const stepKind = (kind: string) =>
    ({ llm: '模型', tool: '工具', search: '检索', retrieve: '召回', thinking: '思考' })[kind] ?? kind;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.agentPlans(projectId) });
    void qc.invalidateQueries({ queryKey: qk.agentApprovals(projectId) });
    void qc.invalidateQueries({ queryKey: qk.agentMetrics(projectId) });
  };

  const decidePlan = async (id: string, approved: boolean) => {
    setBusy(id);
    try {
      await planMutation.mutateAsync({ id, approved });
      toast('success', approved ? '计划已批准：Agent 将自动继续，计划内工具自动放行' : '计划已拒绝');
      refresh();
    } catch (e: unknown) {
      toast('error', errMsg(e) || '计划操作失败');
    } finally {
      setBusy(null);
    }
  };

  const startBackground = async () => {
    const message = bgMessage.trim();
    if (!message) return;
    setBgBusy(true);
    try {
      await api.agent.startBackground({ projectId, message });
      setBgMessage('');
      toast('success', '后台任务已入队，完成后可在下方查看结果');
      void qc.invalidateQueries({ queryKey: ['agent-background', projectId] });
    } catch (e: unknown) {
      toast('error', errMsg(e) || '后台任务入队失败');
    } finally {
      setBgBusy(false);
    }
  };

  const cancelBackground = async (id: string) => {
    try {
      await api.agent.cancelBackground(id);
      toast('success', '已取消后台任务');
      void qc.invalidateQueries({ queryKey: ['agent-background', projectId] });
    } catch (e: unknown) {
      toast('error', errMsg(e) || '取消失败');
    }
  };

  const createSchedule = async () => {
    if (!schedMessage.trim() || schedBusy) return;
    setSchedBusy(true);
    try {
      await api.agent.createSchedule({
        projectId,
        name: schedName.trim() || '自动化任务',
        cadence: schedCadence,
        message: schedMessage.trim(),
        hourOfDay: schedHour,
        minuteOfHour: schedMinute,
        triggerType: schedTrigger,
        triggerConfig: schedTrigger === 'quality.threshold' ? { threshold: schedThreshold } : {},
        notifyChannels: ['inapp', 'browser', ...(schedFeishu ? ['feishu' as const] : [])],
        notifyTarget: schedFeishu ? schedWebhook.trim() : '',
      });
      toast('success', '自动化任务已创建');
      void qc.invalidateQueries({ queryKey: ['agent-schedules', projectId] });
    } catch (e: unknown) {
      toast('error', errMsg(e) || '自动化任务创建失败');
    } finally {
      setSchedBusy(false);
    }
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    try {
      await api.agent.updateSchedule(id, projectId, { enabled });
      void qc.invalidateQueries({ queryKey: ['agent-schedules', projectId] });
    } catch (e: unknown) {
      toast('error', errMsg(e) || '自动化任务更新失败');
    }
  };

  const runScheduleNow = async (id: string) => {
    try {
      await api.agent.runSchedule(id, projectId);
      toast('success', '已立即触发，后台任务可在上方查看');
      void qc.invalidateQueries({ queryKey: ['agent-schedules', projectId] });
      void qc.invalidateQueries({ queryKey: ['agent-background', projectId] });
    } catch (e: unknown) {
      toast('error', errMsg(e) || '触发失败');
    }
  };

  const removeSchedule = async (id: string) => {
    try {
      await api.agent.deleteSchedule(id, projectId);
      toast('success', '自动化任务已删除');
      void qc.invalidateQueries({ queryKey: ['agent-schedules', projectId] });
    } catch (e: unknown) {
      toast('error', errMsg(e) || '删除失败');
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
        <span className={`live-pill ${live ? 'is-live' : 'is-polling'}`} title={live ? 'SSE 实时推送中' : 'SSE 未连接，已降级为 15 秒轮询'}>
          <span className="live-pill__dot" aria-hidden="true" />
          {live ? '实时' : '轮询'}
        </span>
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
                {recentRuns.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setRunId(r.id)}
                      className="flex w-full items-center gap-2 rounded border border-slate-100 bg-white/60 px-2 py-1 text-left text-[11px] transition-colors hover:border-teal-300 hover:bg-teal-50/40 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-teal-700 dark:hover:bg-teal-950/20"
                      title={`查看 ${r.source} 的步骤链`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.status === 'done' ? 'bg-emerald-500' : r.status === 'error' ? 'bg-rose-500' : r.status === 'running' ? 'bg-amber-500' : 'bg-slate-400'}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{r.source}</span>
                      <span className="v2-numeric shrink-0 text-slate-400">{r.tokens ? `${(r.tokens / 1000).toFixed(1)}k` : `${Math.round(r.durationMs / 1000)}s`}</span>
                      <ChevronRight size={11} className="shrink-0 text-slate-400" aria-hidden="true" />
                    </button>
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

      <div className="mt-3 rounded-lg border border-slate-200/80 bg-white/40 p-2.5 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Play size={13} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">后台任务</span>
          <span className="text-[10px] text-slate-400">独立会话，关掉页也会继续跑</span>
        </div>
        <div className="flex gap-1.5">
          <input
            value={bgMessage}
            onChange={(e) => setBgMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void startBackground(); } }}
            placeholder="交给后台执行的研究任务…"
            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
          <Button className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void startBackground()} disabled={bgBusy || !bgMessage.trim()}>
            {bgBusy ? '提交中…' : '入队'}
          </Button>
        </div>
        {(backgroundQuery.data?.jobs ?? []).length > 0 && (
          <ul className="mt-2 space-y-1">
            {(backgroundQuery.data?.jobs ?? []).slice(0, 5).map((j) => (
              <li key={j.id} className="rounded border border-slate-100 bg-white/60 px-2 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${j.status === 'done' ? 'bg-emerald-500' : j.status === 'error' ? 'bg-rose-500' : j.status === 'running' ? 'bg-amber-500' : 'bg-slate-400'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{j.message}</span>
                  <span className="text-slate-400">{j.status === 'queued' ? '排队中' : j.status === 'running' ? '运行中' : j.status === 'done' ? '完成' : j.status === 'error' ? '异常' : '已取消'}</span>
                  {(j.status === 'queued' || j.status === 'running') && (
                    <button type="button" className="text-rose-600 hover:underline dark:text-rose-300" onClick={() => void cancelBackground(j.id)} title="取消">
                      <Square size={10} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {(j.output || j.error) && (
                  <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] leading-relaxed text-slate-400">
                    {j.error || j.output}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-slate-200/80 bg-white/40 p-2.5 dark:border-slate-700 dark:bg-slate-900/30">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <CalendarClock size={13} className="text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">自动化</span>
          <span className="text-[10px] text-slate-400">按时间或事件自动入队，可推送到站内信 / 浏览器 / 飞书</span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-[1fr_auto_auto]">
          <input value={schedName} onChange={(e) => setSchedName(e.target.value)} placeholder="任务名称" className="min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
          <select value={schedTrigger} onChange={(e) => setSchedTrigger(e.target.value as typeof schedTrigger)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" aria-label="触发方式">
            <option value="time">按时间</option>
            <option value="reference.created">新文献入库</option>
            <option value="pipeline.completed">流水线完成</option>
            <option value="quality.threshold">质量分低于阈值</option>
            <option value="experiment.failed">实验失败</option>
          </select>
          <select value={schedCadence} disabled={schedTrigger !== 'time'} onChange={(e) => setSchedCadence(e.target.value as typeof schedCadence)} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
            <option value="hourly">每小时</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
          </select>
        </div>
        {schedTrigger === 'quality.threshold' && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>低于</span>
            <input type="number" min={0} max={100} value={schedThreshold} onChange={(e) => setSchedThreshold(Number(e.target.value))} className="w-14 rounded border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
            <span>分触发</span>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
          <label className="flex items-center gap-1"><input type="checkbox" checked={schedFeishu} onChange={(e) => setSchedFeishu(e.target.checked)} /> 飞书 Webhook</label>
          {schedFeishu && <input value={schedWebhook} onChange={(e) => setSchedWebhook(e.target.value)} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/…" className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />}
          {notifyPermission !== 'granted' && notifyPermission !== 'unsupported' && (
            <button type="button" className="text-teal-600 hover:underline dark:text-teal-300" onClick={() => void requestBrowserNotifyPermission().then((ok) => setNotifyPermission(ok ? 'granted' : Notification.permission))}>开启浏览器通知</button>
          )}
          {notifyPermission === 'granted' && <span className="text-emerald-600 dark:text-emerald-400">浏览器通知已开启</span>}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input value={schedMessage} onChange={(e) => setSchedMessage(e.target.value)} placeholder="到点后要 Agent 做什么…" className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-teal-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200" />
          {schedCadence !== 'hourly' && (
            <select value={schedHour} onChange={(e) => setSchedHour(Number(e.target.value))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:{String(schedMinute).padStart(2, '0')}</option>)}
            </select>
          )}
          {schedCadence === 'hourly' && (
            <select value={schedMinute} onChange={(e) => setSchedMinute(Number(e.target.value))} className="rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>每小时第 {m} 分</option>)}
            </select>
          )}
          <Button className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void createSchedule()} disabled={schedBusy || !schedMessage.trim()}>
            {schedBusy ? '创建中…' : '创建'}
          </Button>
        </div>
        {(schedulesQuery.data?.schedules ?? []).length > 0 && (
          <ul className="mt-2 space-y-1">
            {(schedulesQuery.data?.schedules ?? []).slice(0, 5).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-1.5 rounded border border-slate-100 bg-white/60 px-2 py-1.5 text-[11px] dark:border-slate-800 dark:bg-slate-900/40">
                <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{s.name}</span>
                <span className="text-slate-400">{s.cadence === 'once' ? '一次' : s.cadence === 'hourly' ? `每小时 :${String(s.minuteOfHour).padStart(2, '0')}` : s.cadence === 'daily' ? `每天 ${String(s.hourOfDay).padStart(2, '0')}:${String(s.minuteOfHour).padStart(2, '0')}` : `每周 ${s.weekday} ${String(s.hourOfDay).padStart(2, '0')}:${String(s.minuteOfHour).padStart(2, '0')}`}</span>
                <span className="text-slate-400">下次 {fmtTime(s.nextRunAt)}</span>
                <button type="button" className="text-teal-600 hover:underline dark:text-teal-300" onClick={() => void runScheduleNow(s.id)} title="立即运行"><Play size={10} /></button>
                <button type="button" className="text-amber-600 hover:underline dark:text-amber-300" onClick={() => void toggleSchedule(s.id, !s.enabled)} title={s.enabled ? '暂停' : '启用'}>{s.enabled ? '暂停' : '启用'}</button>
                <button type="button" className="text-rose-600 hover:underline dark:text-rose-300" onClick={() => void removeSchedule(s.id)} title="删除"><Trash2 size={10} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(notifications.length > 0 || (notificationsQuery.data?.unread ?? 0) > 0) && (
        <div className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50/60 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="mb-1.5 flex items-center gap-1.5">
            <BellRing size={13} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">自动化通知</span>
            {(notificationsQuery.data?.unread ?? 0) > 0 && <Badge tone="amber">{notificationsQuery.data?.unread}</Badge>}
            {(notificationsQuery.data?.unread ?? 0) > 0 && <button type="button" className="ml-auto text-[10px] text-slate-500 hover:underline" onClick={() => void markAllNotificationsRead.mutateAsync()}>全部已读</button>}
          </div>
          <ul className="space-y-1">
            {notifications.slice(0, 5).map((n) => (
              <li key={n.id} className={`flex flex-wrap items-center gap-1.5 rounded border px-2 py-1.5 text-[11px] ${n.read ? 'border-slate-100 bg-white/40 dark:border-slate-800 dark:bg-slate-900/30' : 'border-amber-200 bg-white/80 dark:border-amber-900/50 dark:bg-slate-900/60'}`}>
                {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />}
                <span className="min-w-0 flex-1"><span className="font-medium text-slate-700 dark:text-slate-200">{n.title}</span>{n.body && <span className="ml-1 text-slate-400">{n.body}</span>}</span>
                {n.link && <a href={n.link} className="text-teal-600 hover:underline dark:text-teal-300" onClick={() => void markNotificationRead.mutateAsync(n.id).catch(() => undefined)}>打开</a>}
                {n.kind === 'system' && n.body?.includes('飞书') && <button type="button" className="text-amber-600 hover:underline" onClick={() => void retryNotification.mutateAsync(n.id).catch(() => undefined)}>重试</button>}
                {!n.read && <button type="button" className="text-slate-500 hover:underline" onClick={() => void markNotificationRead.mutateAsync(n.id).catch(() => undefined)}>已读</button>}
              </li>
            ))}
          </ul>
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
                {p.expiresAt ? <span className="text-[10px] text-slate-400">有效至 {formatExpiry(p.expiresAt)}</span> : null}
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
              <ToolChips tools={p.allowedTools} />
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
              {p.plan && Object.keys(p.plan).length > 0 && <StructuredDetails value={p.plan} className="mt-1.5" />}
              <ToolChips tools={p.allowedTools} />
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

      <Modal open={Boolean(runId)} title="执行详情" onClose={() => setRunId(null)} width="max-w-3xl">
        {runQuery.isLoading ? (
          <Spinner label="读取执行步骤…" />
        ) : runLoadError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {runLoadError}
          </div>
        ) : runDetail ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Badge tone={runStatus(runDetail.status).tone}>{runStatus(runDetail.status).label}</Badge>
              <span className="font-medium text-slate-700 dark:text-slate-200">{runDetail.source}</span>
              <span>{runDetail.model || '未知模型'}</span>
              <span>{fmtTime(runDetail.createdAt)}</span>
              <span>{runDetail.durationMs ? `${(runDetail.durationMs / 1000).toFixed(1)}s` : '耗时未记录'}</span>
              <span>{fmtInt(runDetail.totalTokens)} tokens</span>
            </div>

            {runDetail.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                失败原因：{runDetail.error}
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">输入</div>
                <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {runDetail.input || '—'}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">输出摘要</div>
                <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  {runDetail.outputSummary || '—'}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                步骤链 · {runDetail.steps.length} 步
              </div>
              {runDetail.steps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-400 dark:border-slate-700">
                  这次执行还没有落步骤记录。
                </div>
              ) : (
                <ol className="space-y-1.5">
                  {[...runDetail.steps].sort((a, b) => a.seq - b.seq).map((step) => (
                    <li key={step.id} className="rounded-lg border border-slate-200 bg-white/60 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${step.status === 'error' || step.error ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300'}`} aria-hidden="true">
                          {step.status === 'error' || step.error ? '!' : '✓'}
                        </span>
                        <span className="v2-numeric text-slate-400">#{step.seq}</span>
                        <Badge tone="slate">{stepKind(step.kind)}</Badge>
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">{step.title || step.toolName || '步骤'}</span>
                        {step.durationMs ? <span className="v2-numeric text-slate-400">{step.durationMs}ms</span> : null}
                        {step.tokens ? <span className="v2-numeric text-slate-400">{fmtInt(step.tokens)} tok</span> : null}
                      </div>
                      {step.error && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">{step.error}</div>}
                      {(step.input || step.output) && (
                        <details className="mt-1.5 rounded bg-slate-50/80 px-2 py-1 dark:bg-slate-950/30">
                          <summary className="cursor-pointer select-none text-[10px] font-medium text-slate-400">输入 / 输出</summary>
                          {step.input && (
                            <div className="mt-1">
                              <div className="text-[9px] uppercase tracking-wider text-slate-400">输入</div>
                              <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400">{step.input}</pre>
                            </div>
                          )}
                          {step.output && (
                            <div className="mt-1">
                              <div className="text-[9px] uppercase tracking-wider text-slate-400">输出</div>
                              <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-[10.5px] leading-relaxed text-slate-500 dark:text-slate-400">{step.output}</pre>
                            </div>
                          )}
                        </details>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
