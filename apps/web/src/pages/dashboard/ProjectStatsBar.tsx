import { BookOpen, FileText, FlaskConical, Workflow } from 'lucide-react';
import { Card } from '../../components/ui';

/**
 * 项目体征条：把原来四张并排的 MetricCard 收成一行。
 *
 * 数据全部来自调用方已有的查询/overview，不新增请求；
 * `bar` 用于驾驶舱首屏，`line` 用于工作台顶部的项目上下文提示。
 */
export function ProjectStatsBar({
  docCount,
  refCount,
  knowledgeCount,
  pipelineCount,
  experimentCount,
  variant = 'bar',
  className = '',
}: {
  docCount?: number;
  refCount?: number;
  knowledgeCount?: number;
  pipelineCount?: number;
  experimentCount?: number;
  variant?: 'bar' | 'line';
  className?: string;
}) {
  const format = (value: number | undefined) => (value === undefined ? '—' : String(value));
  const items = [
    { label: '论文草稿', value: docCount, icon: FileText },
    { label: '参考文献', value: refCount, icon: BookOpen },
    { label: '知识库资料', value: knowledgeCount, icon: BookOpen },
    { label: '流水线任务', value: pipelineCount, icon: Workflow },
    { label: '实验记录', value: experimentCount, icon: FlaskConical },
  ].filter((item) => item.label !== '实验记录' || item.value !== undefined);
  const visible = variant === 'line' ? items.filter((item) => item.value !== undefined) : items;

  if (variant === 'line') {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 ${className}`}>
        <span className="font-medium text-slate-600 dark:text-slate-300">项目上下文</span>
        {visible.map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            {item.label}
            <b className="font-medium text-slate-700 dark:text-slate-200">{format(item.value)}</b>
          </span>
        ))}
      </div>
    );
  }

  return (
    <Card tone="inset" className={`mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2 ${className}`}>
      {visible.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <item.icon size={12} className="text-teal-600 dark:text-teal-300" aria-hidden="true" />
          {item.label}
          <b className="text-sm font-medium text-slate-800 dark:text-slate-100">{format(item.value)}</b>
        </span>
      ))}
    </Card>
  );
}
