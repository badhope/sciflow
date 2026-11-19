import { BookOpen, FileText, FlaskConical, Workflow } from 'lucide-react';
import { Card } from '../../components/ui';

/**
 * 项目体征条：把原来四张并排的 MetricCard 收成一行。
 *
 * 数据全部来自 Dashboard 已有 props / overview，不新增请求；
 * 只是把「论文/文献/资料/流水线/实验」五个计数从四张卡片的视觉权重降到一条辅助信息。
 */
export function ProjectStatsBar({
  docCount,
  refCount,
  knowledgeCount,
  pipelineCount,
  experimentCount,
}: {
  docCount: number;
  refCount: number;
  knowledgeCount: number;
  pipelineCount: number;
  experimentCount: number;
}) {
  const items = [
    { label: '论文草稿', value: docCount, icon: FileText },
    { label: '参考文献', value: refCount, icon: BookOpen },
    { label: '知识库资料', value: knowledgeCount, icon: BookOpen },
    { label: '流水线任务', value: pipelineCount, icon: Workflow },
    { label: '实验记录', value: experimentCount, icon: FlaskConical },
  ];
  return (
    <Card tone="inset" className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <item.icon size={12} className="text-teal-600 dark:text-teal-300" aria-hidden="true" />
          {item.label}
          <b className="text-sm font-medium text-slate-800 dark:text-slate-100">{item.value}</b>
        </span>
      ))}
    </Card>
  );
}
