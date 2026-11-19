import type { View } from '../App';

/**
 * 旧深链 → 6 个一级入口的别名。
 *
 * 这不是删除页面，而是把「计划/流水线」「文献/知识库」「写作/质量」
 * 这些已被合并的页面从可导航入口降级为兼容深链：
 * 旧 URL 仍可用，但会 replace 到对应的合并页，避免用户在两套界面之间来回跳。
 */
export interface ViewAlias {
  view: View;
  tab?: string;
  /** 写作/质量旧深链携带 ?doc=，重定向时保留当前稿件。 */
  keepDoc?: boolean;
}

export const LEGACY_VIEW_ALIAS: Partial<Record<View, ViewAlias>> = {
  programs: { view: 'design', tab: 'programs' },
  pipeline: { view: 'design', tab: 'pipeline' },
  literature: { view: 'evidence', tab: 'literature' },
  knowledge: { view: 'evidence', tab: 'knowledge' },
  writing: { view: 'write-review', tab: 'writing', keepDoc: true },
  quality: { view: 'write-review', tab: 'quality', keepDoc: true },
};

/**
 * 返回旧路由对应的合并页 href；本身就是一级入口时返回 null。
 * 用 replace 跳转，避免在浏览器历史里留下一条“旧页面”记录。
 */
export function canonicalHref(
  view: View,
  tab: string | null | undefined,
  doc: string | null | undefined,
): string | null {
  const alias = LEGACY_VIEW_ALIAS[view];
  if (!alias) return null;
  const params = new URLSearchParams();
  const nextTab = alias.tab ?? tab;
  if (nextTab) params.set('tab', nextTab);
  if (alias.keepDoc && doc) params.set('doc', doc);
  const query = params.toString();
  return `/${alias.view}${query ? `?${query}` : ''}`;
}
