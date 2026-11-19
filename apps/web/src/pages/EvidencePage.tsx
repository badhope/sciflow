import { lazy, Suspense } from 'react';
import type { Project } from '../types';
import { PageErrorBoundary } from '../components/PageErrorBoundary';
import { TabbedPage } from '../components/TabbedPage';
import { EvidenceSummary } from '../components/EvidenceSummary';

const LiteraturePage = lazy(() => import('./LiteraturePage').then((m) => ({ default: m.LiteraturePage })));
const KnowledgePage = lazy(() => import('./KnowledgePage').then((m) => ({ default: m.KnowledgePage })));

const Fallback = ({ name }: { name: string }) => (
  <div className="flex h-full items-center justify-center p-6 text-xs text-slate-400" role="status" aria-live="polite">
    {name}加载中…
  </div>
);

/**
 * 证据库入口：总览计数 + 文献/资料两个 Tab。
 *
 * 总览只读共享 React Query 缓存（enabled:false），不额外请求；
 * 两个 Tab 的页面各自管理列表与导入，保留独立错误边界。
 */
export function EvidencePage({
  project,
  tab,
  onTabChange,
}: {
  project: Project;
  tab?: string | null;
  onTabChange: (tab: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EvidenceSummary project={project} />
      <div className="min-h-0 flex-1">
        <TabbedPage
          name="证据库"
          activeKey={tab ?? undefined}
          onChange={onTabChange}
          tabs={[
            {
              key: 'literature',
              label: '文献库',
              node: (
                <PageErrorBoundary pageName="文献调研">
                  <Suspense fallback={<Fallback name="文献调研" />}>
                    <LiteraturePage key={project.id} project={project} />
                  </Suspense>
                </PageErrorBoundary>
              ),
            },
            {
              key: 'knowledge',
              label: '知识库',
              node: (
                <PageErrorBoundary pageName="知识库">
                  <Suspense fallback={<Fallback name="知识库" />}>
                    <KnowledgePage key={project.id} project={project} />
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
