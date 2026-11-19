import { createContext, useContext, type ReactNode } from 'react';

/** 当前页面是否处于前台 Tab（非 TabbedPage 场景默认为 true） */
const TabVisibilityContext = createContext(true);

export function TabVisibilityProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <TabVisibilityContext.Provider value={active}>{children}</TabVisibilityContext.Provider>;
}

export function useTabActive(): boolean {
  return useContext(TabVisibilityContext);
}
