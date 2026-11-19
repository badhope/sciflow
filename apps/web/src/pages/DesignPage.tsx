import { lazy, Suspense } from 'react';
import type { Project } from '../types';
import { PageErrorBoundary } from '../components/PageErrorBoundary';
import { TabbedPage } from '../components/TabbedPage';

const ResearchProgramsPage = lazy(() => import('./ResearchProgramsPage').then((m) => ({ default: m.ResearchProgramsPage })));
const PipelinePage = lazy(() => import('./PipelinePage').then((m) => ({ default: m.PipelinePage })));

const Fallback = ({ name }: { name: string }) => (
  <div className="flex h-full items-center justify-center p-6 text-xs text-slate-400" role="status" aria-live="polite">
    {name}加载中…
  </div>
);

/**
 * 研究设计入口：把 Program/Cycle 研究与全自动流水线收进同一个页面壳。
 *
 * 两个 Tab 的取数仍由各自页面负责：Program 走 program/cycle/claim/run，
 * Pipeline 走 pipeline task，不能为了“合并”硬共用一条查询。
 */
/**
 * 研究设计统一概览：两个 Tab 不是两套系统，而是两种推进方式。
 * 计划模式强调可干预/可追溯，流水线模式强调一个主题跑完整链路。
 */
export function DesignPage({
  project,
  openDoc,
  tab,
  onTabChange,
}: {
  project: Project;
  openDoc: (id: string) => void;
  tab?: string | null;
  onTabChange: (tab: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 px-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        <b className="text-slate-600 dark:text-slate-300">研究计划</b>按 Program → Cycle → Question → Claim/Run 逐步推进，可随时干预；
        <b className="ml-2 text-slate-600 dark:text-slate-300">全自动流水线</b>输入一个主题，按步骤跑到成稿。
      </p>
      <div className="min-h-0 flex-1">
        <TabbedPage
          name="研究设计"
          activeKey={tab ?? undefined}
          onChange={onTabChange}
          tabs={[
            {
              key: 'programs',
              label: '研究计划',
              node: (
                <PageErrorBoundary pageName="研究计划">
                  <Suspense fallback={<Fallback name="研究计划" />}>
                    <ResearchProgramsPage key={project.id} project={project} />
                  </Suspense>
                </PageErrorBoundary>
              ),
            },
            {
              key: 'pipeline',
              label: '全自动流水线',
              node: (
                <PageErrorBoundary pageName="全自动流水线">
                  <Suspense fallback={<Fallback name="全自动流水线" />}>
                    <PipelinePage key={project.id} project={project} onOpenDoc={openDoc} />
                  </Suspense>
                </PageErrorBoundary>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
