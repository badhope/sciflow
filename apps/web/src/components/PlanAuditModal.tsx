import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import type { PlanAuditFinding, PlanAuditResult } from '../types';
import { Modal } from './ui';

const SEVERITY_META = {
  blocker: { label: '硬门禁', icon: ShieldAlert, tone: 'text-red-600 dark:text-red-400', chip: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/60' },
  warning: { label: '警告', icon: AlertTriangle, tone: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/60' },
  info: { label: '提示', icon: Info, tone: 'text-slate-500 dark:text-slate-400', chip: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700' },
} as const;

function FindingRow({ finding }: { finding: PlanAuditFinding }) {
  const meta = SEVERITY_META[finding.severity] ?? SEVERITY_META.info;
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-[var(--card)] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Icon size={15} className={`mt-0.5 shrink-0 ${meta.tone}`} aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.chip}`}>{meta.label}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{finding.category}</span>
          </div>
          <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{finding.message}</div>
          {finding.evidence && (
            <div className="rounded bg-slate-50 px-2 py-1 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              证据：{finding.evidence}
            </div>
          )}
          <div className="text-[11px] leading-relaxed text-teal-700 dark:text-teal-300">建议：{finding.suggestion}</div>
        </div>
      </div>
    </div>
  );
}

function metricItems(result: PlanAuditResult) {
  const m = result.metrics;
  return [
    m.t1Target !== undefined ? `T1 目标 ${m.t1Target} 人` : '',
    m.pairedTarget !== undefined ? `配对目标 ${m.pairedTarget} 对` : '',
    m.attritionPct !== undefined ? `流失 ${m.attritionPct}%` : '',
    m.t1Weeks ? `T1 ${m.t1Weeks}` : '',
    m.t2Weeks ? `T2 ${m.t2Weeks}` : '',
    m.gapWeeks !== undefined ? `实际间隔 ${m.gapWeeks} 周` : '',
    m.lagWeeks !== undefined ? `设计滞后 ${m.lagWeeks} 周` : '',
  ].filter(Boolean);
}

export function PlanAuditModal({
  open,
  onClose,
  loading,
  error,
  result,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  error: string;
  result: PlanAuditResult | null;
}) {
  const blockers = result?.findings.filter((f) => f.severity === 'blocker') ?? [];
  const warnings = result?.findings.filter((f) => f.severity === 'warning') ?? [];
  const infos = result?.findings.filter((f) => f.severity === 'info') ?? [];
  const metrics = result ? metricItems(result) : [];

  return (
    <Modal open={open} title="研究计划确定性审计" onClose={onClose} width="max-w-3xl">
      {loading ? (
        <div className="flex items-center gap-3 py-12 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={18} className="animate-spin text-teal-600" aria-hidden="true" />
          正在检查样本流、周期间隔、构念同源、量表、查新、选刊与参考文献…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <XCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : result ? (
        <div className="space-y-4">
          <div className={`rounded-xl border px-4 py-3 ${result.ok ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/25' : 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/25'}`}>
            <div className="flex flex-wrap items-center gap-3">
              {result.ok ? (
                <CheckCircle2 size={22} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <ShieldAlert size={22} className="text-red-600 dark:text-red-400" aria-hidden="true" />
              )}
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {result.ok ? '通过硬门禁' : '未通过硬门禁'}
              </div>
              <div className="ml-auto flex items-baseline gap-1">
                <span className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{result.score}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>
              </div>
            </div>
            <div className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{result.summary}</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full border border-slate-200 dark:border-slate-800 px-2 py-0.5 text-slate-600 dark:text-slate-300">{result.blockers} 个 blocker</span>
              <span className="rounded-full border border-slate-200 dark:border-slate-800 px-2 py-0.5 text-slate-600 dark:text-slate-300">{result.warnings} 个警告</span>
              <span className="rounded-full border border-slate-200 dark:border-slate-800 px-2 py-0.5 text-slate-600 dark:text-slate-300">{result.chars} 字</span>
              {metrics.map((m) => (
                <span key={m} className="rounded-full border border-slate-200 dark:border-slate-800 bg-[var(--card)] px-2 py-0.5 text-slate-600 dark:text-slate-300">{m}</span>
              ))}
            </div>
          </div>

          {blockers.length > 0 && (
            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">必须先修</div>
              {blockers.map((f) => <FindingRow key={f.id} finding={f} />)}
            </section>
          )}
          {warnings.length > 0 && (
            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">投稿前关闭</div>
              {warnings.map((f) => <FindingRow key={f.id} finding={f} />)}
            </section>
          )}
          {infos.length > 0 && (
            <section className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">提示</div>
              {infos.map((f) => <FindingRow key={f.id} finding={f} />)}
            </section>
          )}
          {!result.findings.length && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
              没有发现内部一致性冲突。
            </div>
          )}

          <div className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            这是确定性规则审计，只检查计划内部是否自洽，不判断选题价值，也不会改写正文。审计的是当前编辑器内容，包含尚未保存的改动。
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
