import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import { buildCslEntries } from './citation-csl';

export interface BibtexReferenceRow {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
}

/**
 * 项目文献 → BibTeX（citation-js 标准输出）。
 *
 * citation-js 会为大写保护词加 `{Graph}` 花括号，下载/交换场景普遍期望明文标题；
 * 这里按历史契约解包单词级保护括号，同时用负向后行断言保留 `\textbf{...}` 等 LaTeX 命令参数。
 */
export function buildBibtex(rows: BibtexReferenceRow[]): string {
  if (!rows.length) return '% SciFlow: 项目文献库为空\n';
  const raw = new Cite(buildCslEntries(rows)).format('bibtex');
  return raw.replace(/(?<!\\)\{([A-Za-z0-9][A-Za-z0-9_-]*)\}/g, '$1');
}
