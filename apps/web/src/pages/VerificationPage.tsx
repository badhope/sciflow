import { lazy } from 'react';
import type { Project } from '../types';
import { LazyPage } from '../components/LazyPage';
import { TabbedPage } from '../components/TabbedPage';

const ExperimentsPage = lazy(() => import('./ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })));
const WebSandboxPage = lazy(() => import('./WebSandboxPage').then((m) => ({ default: m.WebSandboxPage })));
const BrowserPage = lazy(() => import('./BrowserPage').then((m) => ({ default: m.BrowserPage })));

/**
 * 实验与验证入口：本机实验、Web 项目、内置浏览器收进同一个页面壳。
 *
 * 三件事都属于“验证产出”，但数据和生命周期不同，Tab 内部仍各管各的：
 *  - 实验记录：Python 沙箱与图表留存；
 *  - Web 项目：建项目 → 装依赖 → 构建 → 预览；
 *  - 内置浏览器：真实 Chromium 会话，截图/取文本/点元素。
 */
export function VerificationPage({
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
      <p className="mb-2 shrink-0 px-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        <b className="text-slate-600 dark:text-slate-300">实验记录</b>跑本机 Python 并留存图表；
        <b className="ml-2 text-slate-600 dark:text-slate-300">Web 项目</b>验证前端构建与预览；
        <b className="ml-2 text-slate-600 dark:text-slate-300">内置浏览器</b>做真实页面交互。
      </p>
      <div className="min-h-0 flex-1">
        <TabbedPage
          name="实验与验证"
          activeKey={tab ?? undefined}
          onChange={onTabChange}
          tabs={[
            {
              key: 'experiments',
              label: '实验记录',
              node: (
                <LazyPage name="实验记录">
                  <ExperimentsPage key={project.id} project={project} />
                </LazyPage>
              ),
            },
            {
              key: 'web',
              label: 'Web 项目',
              node: (
                <LazyPage name="Web 项目">
                  <WebSandboxPage key={project.id} project={project} />
                </LazyPage>
              ),
            },
            {
              key: 'browser',
              label: '内置浏览器',
              node: (
                <LazyPage name="内置浏览器">
                  <BrowserPage />
                </LazyPage>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
