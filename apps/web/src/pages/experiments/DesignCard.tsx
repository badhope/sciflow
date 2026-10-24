import { useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { ToastContext } from '../../App';
import type { ExperimentDesign, ExperimentDesignRecord, Project } from '../../types';
import { Button, Card, Empty, Input, SectionTitle, errMsg } from '../../components/ui';

/**
 * F3 实验设计助手（master-plan §9 F3）：研究问题 → 结构化实验设计稿。
 * 变量表（自/因/控）+ 对照组 + 样本与功效提示 + 流程 + 分析计划；设计稿落库可复看可删除。
 */
export function ExperimentDesignCard({ project }: { project: Project }) {
  const [question, setQuestion] = useState('');
  const [designing, setDesigning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toast = useContext(ToastContext);
  const qc = useQueryClient();

  const designsQuery = useQuery({
    queryKey: ['research-designs', project.id],
    queryFn: () => api.research.listDesigns(project.id).catch(() => [] as ExperimentDesignRecord[]),
  });
  const designs: ExperimentDesignRecord[] = designsQuery.data ?? [];

  const design = async () => {
    const q = question.trim();
    if (!q || designing) return;
    setDesigning(true);
    try {
      const r = await api.research.designExperiment(project.id, q);
      if (r?.error) {
        toast('error', r.error);
      } else {
        setQuestion('');
        setExpanded(r.id);
        toast('success', '实验设计稿已生成并保存');
        await qc.invalidateQueries({ queryKey: ['research-designs', project.id] });
      }
    } catch (e: unknown) {
      toast('error', '生成失败：' + errMsg(e));
    } finally {
      setDesigning(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.research.removeDesign(id);
      await qc.invalidateQueries({ queryKey: ['research-designs', project.id] });
      if (expanded === id) setExpanded(null);
      toast('info', '设计稿已删除');
    } catch (e: unknown) {
      toast('error', '删除失败：' + errMsg(e));
    }
  };

  return (
    <Card className="p-4 sm:p-5 h-fit">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <ClipboardList size={16} className="text-teal-600" /> 实验设计助手
        </span>
      </SectionTitle>
      <div className="space-y-2.5">
        <Input
          placeholder="输入研究问题，如：时序感知聚合在动态图节点分类中是否优于均匀采样？"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && design()}
        />
        <Button onClick={design} loading={designing} disabled={!question.trim()} className="w-full">
          {designing ? <Loader2 size={15} className="animate-spin" /> : <ClipboardList size={15} />} 生成实验设计稿
        </Button>
        <div className="text-[11px] text-slate-400 leading-relaxed">
          产出可直接执行的变量表（自变量/因变量/控制变量）、对照组设置、样本量与统计功效提示、实验流程与分析计划；设计稿自动保存。
        </div>
        {designs.length === 0 ? (
          <Empty text="还没有实验设计稿" hint="输入研究问题生成第一份设计稿" />
        ) : (
          <div className="space-y-2">
            {designs.map((d) => (
              <div key={d.id} className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900/50">
                  <button
                    className="flex-1 min-w-0 text-left text-xs text-slate-700 dark:text-slate-200 truncate"
                    onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                    aria-expanded={expanded === d.id}
                    title={d.question}
                  >
                    {d.question}
                  </button>
                  <button onClick={() => remove(d.id)} aria-label="删除设计稿" className="text-slate-300 hover:text-rose-500 transition-colors shrink-0">
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
                {expanded === d.id && <DesignDetail design={d.design} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** 渲染一个非空字符串列表（模块级组件：React Compiler 禁止渲染期建组件） */
function DesignSection({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</div>
      <ul className="text-xs text-slate-700 dark:text-slate-200 space-y-0.5 list-disc ml-4">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function DesignDetail({ design }: { design: ExperimentDesign }) {
  return (
    <div className="px-3 py-2.5 space-y-2.5 border-t border-slate-100 dark:border-slate-800">
      <div className="text-xs text-slate-600 dark:text-slate-300">
        <span className="text-slate-400 dark:text-slate-500">目标：</span>
        {design.objective}
      </div>
      <div className="grid sm:grid-cols-3 gap-2.5">
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 px-2.5 py-2">
          <DesignSection label="自变量" items={design.variables.independent} />
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 px-2.5 py-2">
          <DesignSection label="因变量" items={design.variables.dependent} />
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 px-2.5 py-2">
          <DesignSection label="控制变量" items={design.variables.controlled} />
        </div>
      </div>
      <div>
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">分组设计</div>
        <div className="flex flex-wrap gap-1.5">
          {design.groups.map((g, i) => (
            <span
              key={i}
              title={g.description}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${
                g.role === 'treatment'
                  ? 'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/25 text-teal-700 dark:text-teal-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {g.name}：{g.description}
            </span>
          ))}
        </div>
      </div>
      <div className="text-xs text-slate-600 dark:text-slate-300">
        <span className="text-slate-400 dark:text-slate-500">样本与功效：</span>
        {design.sampleHint}
      </div>
      <DesignSection label="实验流程" items={design.procedure} />
      <DesignSection label="分析计划" items={design.analysisPlan} />
      <DesignSection label="风险与效度威胁" items={design.risks} />
    </div>
  );
}
