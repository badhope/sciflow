import { useState } from 'react';
import { Check, Circle, CircleDot, Loader2, ListChecks, X } from 'lucide-react';

/**
 * Agent 任务清单面板（harness 界面）。
 *
 * 价值：模型做多步任务时，进度从"黑盒"变成"可核对的清单"。
 * 用户能一眼看出：做到哪一步、卡在哪、还剩几项。
 *
 * 交互取舍：默认折叠成一行进度条，展开才看完整清单——
 * 常驻展开会挤占对话区，而多数时候用户只需要知道"到哪了"。
 */

export interface AgentTask {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  seq: number;
}

interface TaskListPanelProps {
  tasks: AgentTask[];
  summary?: { total: number; completed: number; inProgress: number; percent: number };
  defaultOpen?: boolean;
}

const PRIORITY_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };

function StatusIcon({ status }: { status: AgentTask['status'] }) {
  if (status === 'completed') return <Check size={14} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
  if (status === 'in_progress') return <Loader2 size={14} className="animate-spin text-teal-600 dark:text-teal-400" aria-hidden="true" />;
  if (status === 'cancelled') return <X size={14} className="text-slate-400" aria-hidden="true" />;
  return <Circle size={14} className="text-slate-300 dark:text-slate-600" aria-hidden="true" />;
}

export function TaskListPanel({ tasks, summary, defaultOpen = false }: TaskListPanelProps) {
  // 用户显式折叠过就尊重用户选择；否则只要出现"进行中"就自动展开一次。
  // 用「用户是否干预过」作为开关，避免在 effect 里 setState 造成级联渲染。
  const [userToggled, setUserToggled] = useState(false);
  const [openState, setOpenState] = useState(defaultOpen);
  const hasRunning = tasks.some((t) => t.status === 'in_progress');
  const open = userToggled ? openState : defaultOpen || hasRunning;

  const toggle = () => {
    setUserToggled(true);
    setOpenState(!open);
  };

  if (tasks.length === 0) return null;

  const done = summary?.completed ?? tasks.filter((t) => t.status === 'completed').length;
  const total = summary?.total ?? tasks.filter((t) => t.status !== 'cancelled').length;
  const percent = summary?.percent ?? (total === 0 ? 0 : Math.round((done / total) * 100));
  const running = tasks.find((t) => t.status === 'in_progress');

  return (
    <div className="v2-surface overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="v2-focusable flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_40%,transparent)]"
      >
        <ListChecks size={14} className="shrink-0 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <span className="text-[13px] font-medium">任务进度</span>
        <span className="v2-numeric text-[12px] text-[var(--muted-foreground)]">
          {done}/{total}
        </span>
        {/* 进度条：用品牌渐变表达"进行中"，不用纯色块 */}
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[var(--muted)] sm:block">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${percent}%`, background: 'var(--brand-grad)' }}
            />
          </span>
          <span className="v2-numeric text-[11px] text-[var(--muted-foreground)]">{percent}%</span>
        </span>
      </button>

      {!open && running && (
        <div className="flex items-center gap-2 border-t border-[var(--border)] px-3 py-1.5">
          <span className="v2-live-dot" aria-hidden="true" />
          <span className="truncate text-[12px] text-[var(--muted-foreground)]">{running.content}</span>
        </div>
      )}

      {open && (
        <ol className="v2-stagger max-h-64 space-y-0.5 overflow-y-auto border-t border-[var(--border)] p-1.5">
          {tasks.map((t, i) => (
            <li
              key={t.id}
              style={{ ['--i' as string]: i }}
              className={`flex items-start gap-2 rounded-[var(--r-sm)] px-2 py-1.5 ${
                t.status === 'completed' ? 'opacity-60' : ''
              } ${t.status === 'in_progress' ? 'bg-[var(--accent)]' : ''}`}
            >
              <span className="mt-0.5 shrink-0">
                <StatusIcon status={t.status} />
              </span>
              <span
                className={`flex-1 text-[12.5px] leading-snug ${
                  t.status === 'completed' ? 'line-through' : ''
                }`}
              >
                {t.content}
              </span>
              {t.priority === 'high' && t.status !== 'completed' && (
                <span className="shrink-0 rounded px-1 py-px text-[10px] font-medium text-rose-600 ring-1 ring-rose-200 dark:text-rose-400 dark:ring-rose-900">
                  {PRIORITY_LABEL[t.priority]}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 紧凑进度指示：嵌在页头或状态栏里，不占额外空间 */
export function TaskProgressPill({ summary }: { summary: { total: number; completed: number; inProgress: number; percent: number } }) {
  if (!summary || summary.total === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-foreground)]">
      {summary.inProgress > 0 ? (
        <Loader2 size={11} className="animate-spin" aria-hidden="true" />
      ) : (
        <CircleDot size={11} aria-hidden="true" />
      )}
      <span className="v2-numeric">
        {summary.completed}/{summary.total}
      </span>
    </span>
  );
}
