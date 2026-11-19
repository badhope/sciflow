import { BookOpen, Library, Link2 } from 'lucide-react';
import type { Project } from '../types';
import { useProjectKnowledge, useProjectRefs } from '../lib/queries';
import { Card } from './ui';

/**
 * 证据库总览：文献库与知识库共用一个项目上下文。
 *
 * 两个 Tab 各自页面只关心自己的列表；这里只读同一份 React Query 缓存，
 * 不新增后端请求，也不做第三套「统计接口」。
 */
export function EvidenceSummary({ project }: { project: Project }) {
  // 只读缓存：enabled=false 不发起请求；对应 Tab 页面自己拉取后，这里随缓存更新。
  const refsQuery = useProjectRefs(project.id, { retry: 0, enabled: false });
  const knowledgeQuery = useProjectKnowledge(project.id, { retry: 0, enabled: false });
  const refs = refsQuery.data;
  const knowledge = knowledgeQuery.data;
  const count = (n: number | undefined) => (n === undefined ? '—' : String(n));

  return (
    <Card tone="inset" className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
        <Library size={14} className="text-teal-600 dark:text-teal-300" aria-hidden="true" /> 证据库总览
      </span>
      <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        <BookOpen size={12} aria-hidden="true" /> 文献 <b className="text-slate-700 dark:text-slate-200">{count(refs?.length)}</b> 篇
      </span>
      <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        <BookOpen size={12} aria-hidden="true" /> 资料 <b className="text-slate-700 dark:text-slate-200">{count(knowledge?.length)}</b> 份
      </span>
      <span className="ml-auto hidden items-center gap-1 text-[11px] text-slate-400 sm:flex">
        <Link2 size={11} aria-hidden="true" /> 文献与资料共用同一项目上下文
      </span>
    </Card>
  );
}
