import { describe, expect, it } from 'vitest';
import { auditCitations, extractAnchorNumbers, splitBodyForAudit, type AuditCitationRow, type AuditReferenceMeta } from './citation-audit';

/**
 * 引用体检回归（纯函数）。
 *
 * 覆盖四类历史「假绿」：
 *  1. 正文用 [Ref:n] / 【n】 时 anchorTotal=0 → 误判满分
 *  2. 0 锚点直接 100 分 → 用户以为体检通过
 *  3. 文献表里有但正文从未引用（凑数）此前完全不检查
 *  4. 同一个 DOI 重复录入导致文献表出现两条
 */

const ref = (id: string, over: Partial<AuditReferenceMeta> = {}): AuditReferenceMeta => ({
  id,
  title: `Title ${id}`,
  doi: `10.1000/${id}`,
  year: 2024,
  authors: '["A"]',
  ...over,
});

const cit = (id: string, referenceId: string, over: Partial<AuditCitationRow> = {}): AuditCitationRow => ({
  id,
  referenceId,
  verified: 1,
  ...over,
});

describe('splitBodyForAudit / extractAnchorNumbers', () => {
  it('尾部块（参考文献/图表/研究资料）不计入正文锚点', () => {
    const content = '## 引言\n正文 [1]。\n\n## 参考文献\n[1] A. \n[2] B.';
    const body = splitBodyForAudit(content);
    expect(body).not.toContain('## 参考文献');
    expect(extractAnchorNumbers(content)).toEqual([1]);
  });

  it('兼容 [n] / [Ref:n] / 【n】 三种锚点写法（历史缺陷只认 [n]）', () => {
    expect(extractAnchorNumbers('a [1] b [Ref:2] c 【3】')).toEqual([1, 2, 3]);
  });

  it('忽略非正数与超过三位的伪锚点', () => {
    expect(extractAnchorNumbers('x [0] y [1234] z [2]')).toEqual([2]);
  });
});

describe('auditCitations', () => {
  it('幽灵引用：3 锚点 0 落库 → ghost=3 且分数封顶到 40', () => {
    const r = auditCitations({ content: '结论 [1][2][3]', citations: [], references: [] });
    expect(r.anchorTotal).toBe(3);
    expect(r.ghost).toBe(3);
    expect(r.score).toBeLessThanOrEqual(40);
  });

  it('无锚点不再给满分（封顶 60 且带提示）', () => {
    const r = auditCitations({ content: '## 引言\n没有任何引用。', citations: [], references: [] });
    expect(r.anchorTotal).toBe(0);
    expect(r.score).toBeLessThanOrEqual(60);
    expect(r.issues.some((s) => s.includes('未检测到引用'))).toBe(true);
  });

  it('未引用条目：落库 3 条但正文只引 1 个编号 → 报黄牌并扣分', () => {
    const r = auditCitations({
      content: '正文 [1]',
      citations: [cit('c1', 'r1'), cit('c2', 'r2'), cit('c3', 'r3')],
      references: [ref('r1'), ref('r2'), ref('r3')],
    });
    expect(r.uncitedCount).toBe(2);
    expect(r.issues.some((s) => s.includes('未引用') || s.includes('正文无对应锚点'))).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it('锚点断号：正文 [1][3] → missingAnchors=[2]', () => {
    const r = auditCitations({
      content: '正文 [1] 和 [3]',
      citations: [cit('c1', 'r1'), cit('c2', 'r2'), cit('c3', 'r3')],
      references: [ref('r1'), ref('r2'), ref('r3')],
    });
    expect(r.missingAnchors).toEqual([2]);
    expect(r.issues.some((s) => s.includes('断号'))).toBe(true);
  });

  it('重复 DOI：同一 DOI 两条引用 → duplicateDoi 命中且扣分', () => {
    const same = { doi: '10.1000/SAME' };
    const r = auditCitations({
      content: '正文 [1][2]',
      citations: [cit('c1', 'r1'), cit('c2', 'r2')],
      references: [ref('r1', same), ref('r2', { ...same, title: 'Other title' })],
    });
    expect(r.duplicateDoi).toEqual(['10.1000/same']);
    expect(r.issues.some((s) => s.includes('重复引用'))).toBe(true);
    // 同 DOI 不同标题 → 元数据冲突也应报出
    expect(r.issues.some((s) => s.includes('元数据冲突'))).toBe(true);
  });

  it('孤儿引用：citation 指向已删除文献 → 红牌', () => {
    const r = auditCitations({
      content: '正文 [1]',
      citations: [cit('c1', 'missing-ref')],
      references: [],
    });
    expect(r.issues.some((s) => s.includes('孤儿引用'))).toBe(true);
  });

  it('完全健康的稿子：全绿且 100 分', () => {
    const r = auditCitations({
      content: '正文 [1] 与 [2]',
      citations: [cit('c1', 'r1'), cit('c2', 'r2')],
      references: [ref('r1'), ref('r2')],
    });
    expect(r.ghost).toBe(0);
    expect(r.uncitedCount).toBe(0);
    expect(r.duplicateDoi).toEqual([]);
    expect(r.score).toBe(100);
    expect(r.issues.some((s) => s.includes('绿牌'))).toBe(true);
  });

  it('结构化明细与文案同源（details[].message === issues[]）', () => {
    const r = auditCitations({ content: '正文 [1]', citations: [], references: [] });
    expect(r.details.map((d) => d.message)).toEqual(r.issues);
  });
});
