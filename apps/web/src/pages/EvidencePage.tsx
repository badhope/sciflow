import { lazy } from 'react';
import type { Project } from '../types';
import { LazyPage } from '../components/LazyPage';
import { TabbedPage } from '../components/TabbedPage';
import { EvidenceSummary } from '../components/EvidenceSummary';

const LiteraturePage = lazy(() => import('./LiteraturePage').then((m) => ({ default: m.LiteraturePage })));
const KnowledgePage = lazy(() => import('./KnowledgePage').then((m) => ({ default: m.KnowledgePage })));

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
                <LazyPage name="文献调研">
                  <LiteraturePage key={project.id} project={project} />
                </LazyPage>
              ),
            },
            {
              key: 'knowledge',
              label: '知识库',
              node: (
                <LazyPage name="知识库">
                  <KnowledgePage key={project.id} project={project} />
                </LazyPage>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
