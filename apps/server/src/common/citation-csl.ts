/**
 * CSL-JSON 构造工具（shared：references + documents 共用）
 *
 * 将数据库 reference 行转换为 citation-js 可消费的 CSL-JSON 格式，
 * 避免在 ReferencesService 与 DocumentsService 中各自实现。
 *
 * 作者姓/名拆分改用 citation-js 官方 `@citation-js/name`：
 * 手写 `split(/\s+/)` 会把 "van der Waals, Johannes" 解析成 family="Johannes"、
 * 把 "Zhang, Wei" 解析成 family="Wei"，导致 CSL 排序与缩写全错（已实测）。
 */

import { parse as parseCslName } from '@citation-js/name';
import { parseAuthors } from './authors';

interface CslAuthor {
  family: string;
  given?: string;
  'non-dropping-particle'?: string;
}

/** 从 authors JSON 字符串生成 CSL-JSON author 数组 */
export function toCslAuthors(authorsJson: string | null): CslAuthor[] {
  const arr = parseAuthors(authorsJson);
  if (arr.length === 0) return [];
  return arr.filter(Boolean).map((name) => {
    const raw = String(name).trim();
    const parsed = parseCslName(raw) as {
      family?: string;
      given?: string;
      'non-dropping-particle'?: string;
      'dropping-particle'?: string;
    };
    if (!parsed?.family) return { family: raw };
    const out: CslAuthor = { family: parsed.family, given: parsed.given || '' };
    const particle = parsed['non-dropping-particle'] || parsed['dropping-particle'];
    if (particle) out['non-dropping-particle'] = particle;
    return out;
  });
}

/** 取作者姓（著者-年样式正文标注用）：与 CSL 解析同一来源，避免两套规则 */
export function cslSurname(author: string): string {
  const raw = String(author || '').trim();
  const parsed = parseCslName(raw) as { family?: string };
  return parsed?.family || raw;
}

/** DB reference 行 → CSL-JSON 条目（符合 citation-js Cite 输入格式） */
export function buildCslEntry(row: {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
}) {
  return {
    id: row.id,
    type: 'article-journal' as const,
    title: row.title,
    author: toCslAuthors(row.authors),
    issued: row.year ? { 'date-parts': [[row.year]] } : undefined,
    'container-title': row.venue || undefined,
    DOI: row.doi || undefined,
  };
}

/** 批量 DB reference 行 → CSL-JSON 条目数组 */
export function buildCslEntries<T extends { id: string; title: string; authors: string | null; year: number | null; venue: string | null; doi: string | null }>(rows: T[]) {
  return rows.map(buildCslEntry);
}
