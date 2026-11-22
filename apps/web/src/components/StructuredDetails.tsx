import { useState, type ReactNode } from 'react';

/**
 * 结构化计划/方案的渐进披露。
 *
 * 计划授权和研究协议都存的是自由结构（问题、假设、变量、步骤、风险……），
 * 后端字段名不完全统一。这里做三件事：常见字段翻成人话、数组按条展示、
 * 未知字段保留原键，避免审批时只能看到一句摘要。
 */

const KEY_LABELS: Record<string, string> = {
  question: '研究问题',
  researchQuestion: '研究问题',
  objective: '目标',
  goal: '目标',
  hypothesis: '假设',
  hypotheses: '假设',
  protocol: '研究方案',
  design: '研究方案',
  method: '方法',
  methods: '方法',
  variables: '变量',
  name: '名称',
  role: '作用',
  type: '类型',
  value: '取值',
  independentVariables: '自变量',
  dependentVariables: '因变量',
  controls: '对照与规范',
  sample: '样本',
  sampleSize: '样本量',
  data: '数据',
  dataset: '数据集',
  analysis: '分析计划',
  analysisPlan: '分析计划',
  statisticalTest: '统计检验',
  steps: '执行步骤',
  procedure: '执行流程',
  risks: '风险',
  risk: '风险',
  limitations: '局限',
  expectedOutput: '预计产出',
  expectedResult: '预期结果',
  deliverables: '交付物',
  successCriteria: '成功标准',
  stoppingRule: '停止条件',
  budget: '预算',
  timeline: '时间安排',
  literature: '参考依据',
  title: '标题',
  year: '年份',
  venue: '期刊 / 会议',
  doi: 'DOI',
  source: '来源',
  description: '说明',
};

function keyLabel(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ValueView({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-slate-400">—</span>;
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  if (typeof value === 'string' || typeof value === 'number') {
    return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">—</span>;
    return (
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="shrink-0 text-slate-400">•</span>
            <span className="min-w-0 flex-1">
              <ValueView value={item} depth={depth + 1} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length === 0) return <span className="text-slate-400">—</span>;
    if (depth >= 2) {
      let text = '';
      try {
        text = JSON.stringify(value, null, 2);
      } catch {
        text = String(value);
      }
      return <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[10.5px] dark:bg-slate-900/60">{text}</pre>;
    }
    return (
      <div className="space-y-1.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <div className="text-[10px] font-medium text-slate-400">{keyLabel(k)}</div>
            <div className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              <ValueView value={v} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

export function StructuredDetails({
  value,
  title = '查看计划详情',
  defaultOpen = false,
  className = '',
}: {
  value: Record<string, unknown> | null | undefined;
  title?: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const entries = Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return null;

  return (
    <details
      className={`rounded-md border border-slate-200/80 bg-white/50 dark:border-slate-700 dark:bg-slate-900/30 ${className}`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {title} <span className="font-normal text-slate-400">· {entries.length} 项</span>
      </summary>
      <div className="space-y-2 border-t border-slate-200/70 px-2.5 py-2 dark:border-slate-700/70">
        {entries.map(([key, val]) => (
          <div key={key}>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{keyLabel(key)}</div>
            <div className="mt-0.5 text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
              <ValueView value={val} />
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
