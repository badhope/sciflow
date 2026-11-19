import { lazy, Suspense, useEffect, useState } from 'react';
import type { Project } from '../types';
import { PageErrorBoundary } from '../components/PageErrorBoundary';
import { TabbedPage } from '../components/TabbedPage';
import { useProjectDocs } from '../lib/queries';

const WritingPage = lazy(() => import('./WritingPage').then((m) => ({ default: m.WritingPage })));
const QualityPage = lazy(() => import('./QualityPage').then((m) => ({ default: m.QualityPage })));

const PageFallback = ({ name }: { name: string }) => (
  <div className="flex h-full items-center justify-center p-6 text-xs text-slate-400" role="status" aria-live="polite">
    {name}加载中…
  </div>
);

/**
 * 写作与评审合并页：两个 Tab 共享一个当前文档。
 *
 * 文档状态由本页持有，WritingPage / QualityPage 通过受控 props 读写；
 * 这样在写作页选中的稿子，切到质量页会直接评审同一篇，不再各自维护一套选择。
 */
export function WriteReviewPage({
  project,
  initialDocId,
  tab,
  onTabChange,
}: {
  project: Project;
  initialDocId: string | null;
  tab?: string | null;
  onTabChange: (tab: string) => void;
}) {
  const docsQuery = useProjectDocs(project.id);
  const docs = docsQuery.data ?? [];
  const [docId, setDocId] = useState<string | null>(initialDocId);

  // URL ?doc= 优先；从工作台/总览点「完整编辑器」时同步过来。
  useEffect(() => {
    if (initialDocId) setDocId(initialDocId);
  }, [initialDocId]);

  // 没有 URL 指定时默认选最新一篇；列表按 updatedAt 升序，取最后一条。
  useEffect(() => {
    if (!docId && docs.length > 0) setDocId(docs[docs.length - 1].id);
  }, [docId, docs]);

  return (
    <TabbedPage
      name="写作与评审"
      activeKey={tab ?? undefined}
      onChange={onTabChange}
      tabs={[
        {
          key: 'writing',
          label: '论文写作',
          node: (
            <PageErrorBoundary pageName="论文写作">
              <Suspense fallback={<PageFallback name="论文写作" />}>
                <WritingPage key={project.id} project={project} initialDocId={initialDocId} docId={docId} onDocChange={setDocId} />
              </Suspense>
            </PageErrorBoundary>
          ),
        },
        {
          key: 'quality',
          label: '质量评审',
          node: (
            <PageErrorBoundary pageName="质量评分">
              <Suspense fallback={<PageFallback name="质量评分" />}>
                <QualityPage key={project.id} project={project} docId={docId} onDocChange={setDocId} />
              </Suspense>
            </PageErrorBoundary>
          ),
        },
      ]}
    />
  );
}
