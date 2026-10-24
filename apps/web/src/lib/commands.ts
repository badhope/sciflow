import type { View } from '../App';

/**
 * ⌘K 命令面板注册表（F-3.1 单一事实源）
 *
 * 历史问题：命令列表散在 CommandPalette 组件里，label 之外的模糊匹配（关键词/拼音首字母）
 * 与快捷键提示无处挂靠。现在：label + keywords + group + hotkey 都在这里声明，
 * run 由 App 层注入（注册表不持有副作用实现）；单测遍历本表保证 id 唯一、导航完备。
 */

export interface CommandDeps {
  onNavigate: (v: View) => void;
  onNewProject: () => void;
  setThemeMode: (m: 'light' | 'dark' | 'system') => void;
  /** 导航分组与标签（App.tsx 的 NAV_GROUPS/VIEW_LABELS 传入，避免循环依赖） */
  navGroups: { label: string; items: { key: View; label: string }[] }[];
}

export interface CommandItem {
  id: string;
  label: string;
  /** 模糊匹配关键词（中文别名/英文/缩写），命中即可被搜到 */
  keywords?: string[];
  group: string;
  /** 关联快捷键展示（与 lib/hotkeys-docs 对应；纯展示） */
  hotkey?: string;
  run: () => void;
}

export function buildCommands(deps: CommandDeps): CommandItem[] {
  const nav = deps.navGroups.flatMap((g) =>
    g.items.map((n) => ({ id: `nav-${n.key}`, label: n.label, keywords: [`go ${n.key}`, '跳转', '打开'], group: g.label, run: () => deps.onNavigate(n.key) })),
  );
  return [
    ...nav,
    { id: 'new-project', label: '新建研究项目', keywords: ['create project', '项目', '建项目'], group: '项目', hotkey: 'mod+n', run: deps.onNewProject },
    { id: 'theme-light', label: '外观：浅色', keywords: ['theme light', '亮色'], group: '外观', run: () => deps.setThemeMode('light') },
    { id: 'theme-dark', label: '外观：深色', keywords: ['theme dark', '暗色', '夜间'], group: '外观', run: () => deps.setThemeMode('dark') },
    { id: 'theme-system', label: '外观：跟随系统', keywords: ['theme system', '自动'], group: '外观', run: () => deps.setThemeMode('system') },
  ];
}

/** 面板过滤：label + keywords 双通道（大小写不敏感；空查询返回全量） */
export function filterCommands(commands: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((c) => c.label.toLowerCase().includes(q) || (c.keywords || []).some((k) => k.toLowerCase().includes(q)));
}
