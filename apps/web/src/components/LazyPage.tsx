import { Suspense, type ReactNode } from 'react';
import { PageErrorBoundary } from './PageErrorBoundary';

/** 页面级骨架：懒加载 chunk 下载期间给出结构占位，避免整屏空白与布局跳动。 */
export function PageSkeleton({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4" role="status" aria-live="polite" aria-label={`${name}加载中`}>
      <div className="skeleton h-7 w-48 rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="skeleton h-64 rounded-xl" />
      <span className="sr-only">{name}加载中…</span>
    </div>
  );
}

/**
 * 页面加载壳：错误边界 + Suspense + 骨架屏的唯一实现。
 * 路由页和二级 Tab 都走这里，避免每个入口重复写三件套。
 */
export function LazyPage({ name, children }: { name: string; children: ReactNode }) {
  return (
    <PageErrorBoundary pageName={name}>
      <Suspense fallback={<PageSkeleton name={name} />}>{children}</Suspense>
    </PageErrorBoundary>
  );
}
