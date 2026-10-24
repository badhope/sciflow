import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode, useRef } from 'react';
import { Menu, X } from 'lucide-react';

/**
 * AppShell —— 全站布局契约。
 *
 * 设计目标（对应本轮重构的核心问题）：
 *  1. `min-w-0` / 滚动归属 / 断点策略只在这里定义一次，页面不再各自防御，
 *     从根本上消除「五栏挤一行、编辑器被压到 2px」这类问题。
 *  2. 侧栏在窄屏自动变抽屉；主区永远独占剩余宽度。
 *  3. 提供 Toolbar / Content / Aside 三个插槽，页面只管内容。
 *
 * 用法：
 *   <AppShell sidebar={<Sidebar/>} toolbar={<Toolbar/>}>
 *     <PageContent/>
 *   </AppShell>
 */
interface AppShellProps {
  sidebar: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  /** 侧栏宽度（桌面态） */
  sidebarWidth?: number;
  /** 当前视图名：用于渲染唯一的 h1（视觉隐藏，供读屏与文档大纲） */
  toolbarTitle?: string;
  /** 阶段条插槽（渲染在工具栏下方，内容之上） */
  stageBar?: ReactNode;
  /** 移动端底部导航插槽（≤900px 显示） */
  mobileTabbar?: ReactNode;
}

const ShellCtx = createContext<{ openSidebar: () => void; closeSidebar: () => void; sidebarOpen: boolean }>({
  openSidebar: () => undefined,
  closeSidebar: () => undefined,
  sidebarOpen: false,
});

export const useAppShell = () => useContext(ShellCtx);

export function AppShell({ sidebar, toolbar, children, sidebarWidth = 224, toolbarTitle, stageBar, mobileTabbar }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // 路由变化时自动收起抽屉：监听 hashchange（本应用用 hash 路由）
  useEffect(() => {
    const onHash = () => setSidebarOpen(false);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // 移动端底部「更多」通过自定义事件打开侧栏抽屉（避免 prop drilling）
  useEffect(() => {
    const open = () => setSidebarOpen(true);
    window.addEventListener('sciflow:open-sidebar', open);
    return () => window.removeEventListener('sciflow:open-sidebar', open);
  }, []);

  // 抽屉打开时锁滚动 + Esc 关闭
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const ctx = useMemo(() => ({ openSidebar, closeSidebar, sidebarOpen }), [openSidebar, closeSidebar, sidebarOpen]);
  const contentId = useId();

  return (
    <ShellCtx.Provider value={ctx}>
      <div className="app-shell" style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}>
        {sidebarOpen && <div className="app-shell__backdrop" onClick={closeSidebar} aria-hidden="true" />}
        <aside className={`app-shell__sidebar ${sidebarOpen ? 'is-open' : ''}`} aria-label="主导航">
          {sidebar}
        </aside>
        <div className="app-shell__main">
          {toolbar !== undefined && (
            <header className="app-shell__toolbar">
              <button className="shell-menu-btn" onClick={openSidebar} aria-label="打开导航" aria-expanded={sidebarOpen}>
                <Menu size={18} aria-hidden="true" />
              </button>
              {toolbar}
            </header>
          )}
          {stageBar}
          <div className="app-shell__body">
            {/* 每个视图必须有一个 h1（屏幕阅读器/SEO/大纲导航）；页面级标题由 toolbar 提供语义 */}
            <h1 className="sr-only">{toolbarTitle || 'SciFlow 工作台'}</h1>
            <main id={contentId} className="app-shell__content">
              {children}
            </main>
          </div>
          {mobileTabbar}
        </div>
      </div>
    </ShellCtx.Provider>
  );
}

/** 侧栏内的分组标题 */
export function ShellNavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="shell-nav-group">
      <div className="shell-nav-group__label">{label}</div>
      {children}
    </div>
  );
}

/** 侧栏导航项 */
export function ShellNavItem({
  active,
  onSelect,
  icon,
  children,
  badge,
}: {
  active?: boolean;
  onSelect: () => void;
  icon?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <button type="button" className={`shell-nav-item ${active ? 'is-active' : ''}`} onClick={onSelect} aria-current={active ? 'page' : undefined}>
      {icon && <span className="shell-nav-item__icon">{icon}</span>}
      <span className="shell-nav-item__label">{children}</span>
      {badge}
    </button>
  );
}

/** 抽屉式右侧栏（写作页 AI 助手等） */
export function ShellDrawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** 打开前的焦点元素：关闭时归还，避免键盘用户丢失位置 */
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // 焦点陷阱：Tab 在抽屉内循环，避免键盘焦点跑到被遮罩的页面上
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // 打开时把焦点移入抽屉
    const raf = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>('button, textarea, input, a[href]');
      first?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      // 归还焦点（元素可能已被卸载，做存在性检查）
      const back = restoreRef.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="app-shell__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="drawer__header">
          <span className="drawer__title">{title}</span>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__footer">{footer}</div>}
      </div>
    </>
  );
}

/** 底部 Tab 容器（写作页把次要面板收在这里） */
export function BottomTabs<T extends string>({
  tabs,
  active,
  onChange,
  children,
}: {
  tabs: { key: T; label: string; icon?: ReactNode }[];
  active: T;
  onChange: (k: T) => void;
  children: ReactNode;
}) {
  return (
    <div className="bottom-tabs-wrap">
      <div className="bottom-tabs" role="tablist" aria-label="工具面板">
        {tabs.map((t) => (
          <button
            key={t.key}
            id={`tab-${t.key}`}
            type="button"
            role="tab"
            className="bottom-tabs__btn"
            aria-selected={active === t.key}
            aria-controls="bottom-tabs-panel"
            // 非活动 tab 的面板不渲染，但 aria-controls 仍需指向一个存在的 id：
            // 统一渲染所有面板容器、用 hidden 控制可见性，避免指向不存在的元素。
            tabIndex={active === t.key ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => {
              // WAI-ARIA tabs 键盘漫游：←/→ 切换并聚焦，Home/End 跳首尾
              const idx = tabs.findIndex((x) => x.key === t.key);
              if (idx < 0) return;
              let nextIdx = -1;
              if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
              else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
              else if (e.key === 'Home') nextIdx = 0;
              else if (e.key === 'End') nextIdx = tabs.length - 1;
              if (nextIdx < 0) return;
              e.preventDefault();
              const nextKey = tabs[nextIdx].key;
              onChange(nextKey);
              requestAnimationFrame(() => document.getElementById(`tab-${nextKey}`)?.focus());
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="bottom-tabs-panel"
        id="bottom-tabs-panel"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
      >
        {children}
      </div>
    </div>
  );
}
