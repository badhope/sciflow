import { useState, type ReactNode } from 'react';

/**
 * 一级入口内的二级 Tab：只做“壳”，不重写页面。
 * 旧页面各自保留完整的加载/错误边界；切换 Tab 时卸载，避免同屏跑两套重查询。
 */
export function TabbedPage({
  name,
  tabs,
  initialKey,
}: {
  name: string;
  tabs: { key: string; label: string; node: ReactNode }[];
  initialKey?: string;
}) {
  const [active, setActive] = useState(initialKey ?? tabs[0]?.key ?? '');
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
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
            onClick={() => setActive(t.key)}
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
      <div className="min-h-0 flex-1">{current?.node}</div>
    </div>
  );
}
