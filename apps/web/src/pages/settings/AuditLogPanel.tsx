import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldX, RefreshCw, Activity } from 'lucide-react';
import { api } from '../../api/client';
import type { AuditEntry } from '../../api/platform';
import { Card, EmptyState, Spinner, errMsg } from '../../components/ui';

/**
 * 安全与审计面板。
 *
 * 企业部署的两个刚需，之前只有 API 没有界面：
 *  1. 审计流水：谁（actor）在哪个类别做了什么、被拒绝的操作与原因——合规回溯的原始凭证；
 *  2. 运行指标：直接展示 /api/metrics 的关键值，运维不必另开 Prometheus 才能确认服务状态。
 * 只读展示，不提供编辑入口（审计表设计上只追加）。
 */
export function AuditLogPanel() {
  const [filter, setFilter] = useState<'all' | 'denied'>('all');
  const [tick, setTick] = useState(0);

  const auditQuery = useQuery({
    queryKey: ['config-audit', tick],
    queryFn: () => api.config.auditLog(200),
    retry: 0,
  });

  const metricsQuery = useQuery({
    queryKey: ['metrics-text', tick],
    queryFn: () => api.config.metricsText() as Promise<string>,
    retry: 0,
  });

  // 每 30s 自动刷新指标（审计流水靠手动刷新，避免盯屏时列表跳动）
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const entries = (auditQuery.data ?? []).filter((e: AuditEntry) => (filter === 'all' ? true : e.allowed === 0));
  const metrics = parseMetrics(metricsQuery.data ?? '');

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity size={15} className="text-teal-600" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">运行指标</span>
          <span className="text-[11px] text-slate-400">/api/metrics · 每 30 秒刷新</span>
          <button
            type="button"
            className="ml-auto flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={() => setTick((v) => v + 1)}
          >
            <RefreshCw size={11} /> 刷新
          </button>
        </div>
        {metricsQuery.isLoading ? (
          <Spinner />
        ) : metricsQuery.error ? (
          <EmptyState compact title="指标读取失败" hint={errMsg(metricsQuery.error)} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {metrics.map((m) => (
              <div key={m.name} className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700">
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400" title={m.label}>{m.label}</div>
                <div className="text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{m.value}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={15} className="text-sky-600" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">配置与权限审计</span>
          <div className="ml-auto flex items-center gap-1">
            {(['all', 'denied'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`rounded px-2 py-0.5 text-[11px] ${filter === k ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}
                onClick={() => setFilter(k)}
              >
                {k === 'all' ? '全部' : '仅被拒绝'}
              </button>
            ))}
          </div>
        </div>
        {auditQuery.isLoading ? (
          <Spinner />
        ) : auditQuery.error ? (
          <EmptyState compact title="审计流水读取失败" hint={errMsg(auditQuery.error)} />
        ) : entries.length === 0 ? (
          <EmptyState compact title="暂无审计记录" hint="修改角色、约束、钩子或权限档后，这里会留下可回溯的流水。" />
        ) : (
          <div className="max-h-80 space-y-1 overflow-auto">
            {entries.map((e) => (
              <div key={e.id} className="flex items-start gap-2 rounded border border-slate-100 px-2 py-1.5 text-[11px] dark:border-slate-800">
                <span className={`mt-0.5 shrink-0 ${e.allowed === 1 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {e.allowed === 1 ? <ShieldCheck size={12} /> : <ShieldX size={12} />}
                </span>
                <span className="shrink-0 font-mono text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
                <span className="shrink-0 rounded bg-slate-100 px-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{e.category || 'general'}</span>
                <span className="shrink-0 font-medium text-slate-700 dark:text-slate-200">{e.action}</span>
                {e.target && <span className="truncate text-slate-500 dark:text-slate-400">{e.target}</span>}
                <span className="ml-auto shrink-0 text-slate-400">{e.actor}</span>
                {e.allowed === 0 && e.reason && <span className="basis-full text-rose-600 dark:text-rose-400">拒绝原因：{e.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const METRIC_LABELS: Record<string, string> = {
  sciflow_up: '服务状态 (1=正常)',
  sciflow_db_latency_ms: '数据库延迟 (ms)',
  sciflow_process_uptime_seconds: '运行时长 (s)',
  sciflow_process_resident_memory_bytes: '内存占用 (bytes)',
  sciflow_projects_total: '项目数',
  sciflow_documents_total: '文档数',
  sciflow_references_total: '文献数',
  sciflow_knowledge_chunks_total: '知识块数',
  sciflow_llm_calls_total: '模型调用数',
  sciflow_agent_runs_total: 'Agent 运行数',
  sciflow_quality_reports_total: '质量报告数',
};

/** 解析 Prometheus 文本格式（只取我们关心的 gauge/counter 样本，忽略注释与 build_info） */
export function parseMetrics(text: string): { name: string; label: string; value: string }[] {
  const out: { name: string; label: string; value: string }[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(sciflow_[a-z0-9_]+)(\{[^}]*\})?\s+(-?\d+(?:\.\d+)?)$/);
    if (!m) continue;
    const name = m[1];
    if (name === 'sciflow_build_info') continue;
    const label = METRIC_LABELS[name];
    if (!label) continue;
    out.push({ name, label, value: m[3] });
  }
  return out;
}
