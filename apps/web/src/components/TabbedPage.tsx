import { useEffect, useState, type ReactNode } from 'react';
import { TabVisibilityProvider } from '../lib/tab-visibility';

/**
 * 一级入口内的二级 Tab：只做“壳”，不重写页面。
 * 旧页面各自保留完整的加载/错误边界；首次访问才挂载，之后隐藏保活，避免首屏同跑两套重查询。
 */
export function TabbedPage({
  name,
  tabs,
  initialKey,
  activeKey,
  onChange,
}: {
  name: string;
  tabs: { key: string; label: string; node: ReactNode }[];
  initialKey?: string;
  /** 受控模式：由路由 ?tab= 决定当前页；非法值回落到第一个 Tab */
  activeKey?: string;
  onChange?: (key: string) => void;
}) {
  const [local, setLocal] = useState(initialKey ?? tabs[0]?.key ?? '');
  const controlled = activeKey && tabs.some((t) => t.key === activeKey) ? activeKey : undefined;
  const active = controlled ?? local;

  /**
   * 保活挂载：只挂载“访问过”的 Tab，之后用 hidden 隐藏而不是卸载。
   * 首屏不会同时拉起两个重页面；用户从写作切到评审再切回，文档/编辑器状态仍在。
   */
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([active]));
  useEffect(() => {
    setMounted((prev) => (prev.has(active) ? prev : new Set(prev).add(active)));
  }, [active]);
  const visible = mounted.has(active) ? mounted : new Set([...mounted, active]);

  const select = (key: string) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setLocal(key);
    onChange?.(key);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label={`${name}子导航`}
        className="mb-2 flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200/70 pb-1 dark:border-slate-800"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => select(t.key)}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
              active === t.key
                ? 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tabs
          .filter((t) => visible.has(t.key))
          .map((t) => (
            <div key={t.key} hidden={t.key !== active} aria-hidden={t.key !== active}>
              <TabVisibilityProvider active={t.key === active}>{t.node}</TabVisibilityProvider>
            </div>
          ))}
      </div>
    </div>
  );
}
