import { describe, expect, it } from 'vitest';
import { auditCitations, extractAnchorNumbers, extractResidualAnchors, splitBodyForAudit, type AuditCitationRow, type AuditReferenceMeta } from './citation-audit';

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

  /**
   * 残留未渲染标记（v1.9.1 新增判定）。
   * 背景：citation-renderer 对越界锚点的降级产物是 [文献N]；此前 audit 只认
   * [n]/[Ref:n]/【n】，把「引用全断」误报成「没有引用」（60 分假绿），
   * 客观质量检查器也只在 >5000 字时才因零锚点报硬伤。
   */
  it('残留 [文献N] 被识别为红牌（渲染器自己的降级产物不再隐形）', () => {
    const r = auditCitations({ content: '正文 [文献1] 与 [文献2]', citations: [], references: [] });
    expect(r.anchorTotal).toBe(0);
    expect(r.residualAnchors).toBe(2);
    expect(r.score).toBeLessThanOrEqual(40); // 残留标记每处 −10 且上不封顶：2 处 ×2 种口径合计应远低于及格线
    expect(r.issues.some((s) => s.includes('未渲染的引用标记'))).toBe(true);
    expect(r.details.find((d) => d.code === 'residual-anchor')?.level).toBe('red');
  });

  it('正文未渲染的 [Ref:N] / [补充文献] 同样计入残留', () => {
    const residuals = extractResidualAnchors('a [Ref:3] b [补充Ref:2] c [文献1] d [1] e [补充文献]');
    expect(residuals).toContain('[Ref:3]');
    expect(residuals).toContain('[补充Ref:2]');
    expect(residuals).toContain('[文献1]');
    expect(residuals).toContain('[补充文献]');
    // 尾部块里的标记不计入（参考文献列表本身可能含 [N] 前缀样式，但 [文献N] 形态只出现在正文）
    expect(extractResidualAnchors('正文 [文献1]\n\n## 参考文献\n[1] Foo')).toEqual(['[文献1]']);
  });

  it('有真实锚点 + 残留混合时：两种判定并列，分数双重惩罚', () => {
    const r = auditCitations({
      content: '正文 [1] 也提到 [文献3]',
      citations: [cit('c1', 'r1')],
      references: [ref('r1')],
    });
    expect(r.anchorTotal).toBe(1);
    expect(r.residualAnchors).toBe(1);
    expect(r.score).toBe(90); // 100 − 残留 10
  });
});
