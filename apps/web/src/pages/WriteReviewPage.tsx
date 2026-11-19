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
  onDocChange,
}: {
  project: Project;
  initialDocId: string | null;
  tab?: string | null;
  onTabChange: (tab: string) => void;
  /** 文档选择同步回 URL；刷新/分享仍停在同一篇。 */
  onDocChange?: (id: string | null) => void;
}) {
  const docsQuery = useProjectDocs(project.id);
  const docs = docsQuery.data ?? [];
  const latestDocId = docs.length > 0 ? docs[docs.length - 1].id : null;
  const [pickedDocId, setPickedDocId] = useState<string | null>(null);

  // URL ?doc= 是唯一外部来源；没有 URL 时用本地选择/最新一篇兜底。
  // 不再用 effect 把 URL 写回 state，避免切换 Tab 时多一轮渲染和状态分叉。
  const docId = initialDocId ?? pickedDocId ?? latestDocId;

  // 默认选最新一篇时把 URL 回填（App replace，不堆历史）；只导航，不写 state。
  useEffect(() => {
    if (!initialDocId && latestDocId) onDocChange?.(latestDocId);
  }, [initialDocId, latestDocId, onDocChange]);

  const selectDoc = (id: string | null) => {
    setPickedDocId(id);
    onDocChange?.(id);
  };

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
                <WritingPage key={project.id} project={project} initialDocId={initialDocId} docId={docId} onDocChange={selectDoc} />
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
                <QualityPage key={project.id} project={project} docId={docId} onDocChange={selectDoc} />
              </Suspense>
            </PageErrorBoundary>
          ),
        },
      ]}
    />
  );
}
