/**
 * 文本匹配分词（单一来源）：拉丁词 ≥2 字符 + 中文二元组。
 *
 * 用于选题新颖性预检、候选文献相关性门禁、起草池排序等场景。
 * 保持纯函数、无依赖，确保各调用方口径一致。
 */
export function tokenizeForMatch(text: string): string[] {
  const low = (text || '').toLowerCase();
  const out: string[] = [];
  for (const m of low.matchAll(/[a-z][a-z0-9_-]{1,}/g)) out.push(m[0]);
  const cn = low.replace(/[^一-龥]/g, '');
  for (let i = 0; i < cn.length - 1; i++) out.push(cn.slice(i, i + 2));
  return out;
}
