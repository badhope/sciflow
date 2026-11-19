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
  );
}
