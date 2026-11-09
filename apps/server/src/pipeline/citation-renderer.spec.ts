import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { citations, documents, projects, references } from '../db/schema';
import { CitationRenderer } from './citation-renderer';

/**
 * 引用渲染器回归（v0.6）。
 *
 * 契约：
 *  1. `[Ref:N]` 锚点按「正文首次出现顺序」重编号为 [1]/[2]/…，未使用的池条目不得占号
 *  2. 不再向正文内嵌参考文献列表（列表由前端按 CSL 样式渲染）
 *  3. 知识库命中写进独立的「## 研究资料」块
 *  4. 引用行回填到 citations 表，且 createdAt 严格递增（保证列表顺序 = 正文顺序）
 *  5. 幂等：重复渲染不产生重复引用行
 */

const PROJ = 'test-proj-citation-renderer';

function makeRef(title: string, year: number) {
  return {
    id: `ref-${title}`,
    projectId: PROJ,
    title,
    authors: JSON.stringify(['Alice Zhang']),
    year,
    venue: 'Test Journal',
    doi: '10.1234/test',
    url: '',
    abstract: '',
    source: 'manual' as const,
    tags: '[]',
    citationCount: 0,
    readingStatus: 'unread',
    fingerprint: '',
    isDuplicateOf: '',
    notes: '',
    createdAt: Date.now(),
  };
}

describe('CitationRenderer', () => {
  const renderer = new CitationRenderer(db as never);
  let docId = '';
  const pool = [makeRef('Paper A', 2020), makeRef('Paper B', 2021), makeRef('Paper C', 2022)];

  beforeEach(() => {
    db.delete(citations).where(eq(citations.documentId, docId || '__none__')).run();
    db.delete(documents).where(eq(documents.projectId, PROJ)).run();
    db.delete(references).where(eq(references.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();

    db.insert(projects).values({ id: PROJ, name: 'cite-render', createdAt: Date.now(), updatedAt: Date.now() }).run();
    const doc = { id: 'doc-r1', projectId: PROJ, title: 'T', content: '', outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: Date.now(), updatedAt: Date.now() };
    db.insert(documents).values(doc).run();
    docId = doc.id;
    for (const r of pool) db.insert(references).values(r).run();
  });

  afterEach(() => {
    db.delete(citations).where(eq(citations.documentId, docId || '__none__')).run();
    db.delete(documents).where(eq(documents.projectId, PROJ)).run();
    db.delete(references).where(eq(references.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();
  });

  it('顺序编码制：按池顺序连续编号（不是按正文出现顺序重排）', () => {
    // 顺序编码制（IEEE/GB-T）契约：正文 [n] 对应参考文献列表第 n 条，
    // 编号按「文献池顺序」分配，未使用的池条目不占号。
    // 因此先引 B(池下标1) 再引 A(池下标0) 时：A=1、B=2，正文保持各自编号。
    const content = '## 引言\n\n先引 B[Ref:2]，再引 A[Ref:1]。';
    const out = renderer.render(docId, content, pool);
    expect(out).toContain('先引 B[2]');
    expect(out).toContain('再引 A[1]');
  });

  it('同一篇多次引用复用同一编号', () => {
    const content = 'A 出现两次[Ref:1]，中间 B[Ref:2]，再来 A[Ref:1]。';
    const out = renderer.render(docId, content, pool);
    // A(1) 出现两次，B 一次 → 编号集合应为 {1,2}，且 A 两次都是同一个号
    expect(out).toContain('A 出现两次[1]');
    expect(out).toContain('A[1]');
    expect(out).toContain('B[2]');
  });

  it('未使用的池条目不占号', () => {
    const content = '只引第三篇[Ref:3]。';
    const out = renderer.render(docId, content, pool);
    expect(out).toContain('[1]');
    expect(out).not.toContain('[2]');
    expect(out).not.toContain('[3]');
  });

  it('不再向正文内嵌参考文献列表', () => {
    const content = '正文[Ref:1]。';
    const out = renderer.render(docId, content, pool);
    expect(out).not.toContain('## 参考文献');
    expect(out).not.toContain('Paper A[J]');
  });

  it('知识库命中写入「## 研究资料」块', () => {
    const content = '正文[Ref:1]。';
    const kn = [{ title: 'GNN 笔记', authors: [], year: null, venue: '知识库', doi: '', url: '', abstract: '图神经网络摘要', source: 'manual' as const, citationCount: 0, matchScore: 0.9 }];
    const out = renderer.render(docId, content, pool, [], [], kn);
    expect(out).toContain('## 研究资料');
    expect(out).toContain('GNN 笔记');
    expect(out).not.toContain('## 参考文献');
  });

  it('引用行回填到 citations 表，且顺序/数量/时间戳严格正确', () => {
    renderer.render(docId, 'B[Ref:2] A[Ref:1] C[Ref:3]', pool);
    const rows = db.select().from(citations).where(eq(citations.documentId, docId)).all();
    // 精确断言：3 条、按池下标顺序 A→B→C（原断言用结果过滤结果，永远为真；且少写一条也全绿）
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.referenceId)).toEqual(['ref-Paper A', 'ref-Paper B', 'ref-Paper C']);
    // 回填字段完整（location 在无 spot 时为空串，这里断言格式与 DOI 已写入）
    expect(rows.every((r) => r.format === 'pipeline')).toBe(true);
    expect(rows.every((r) => r.referenceId && r.documentId === docId)).toBe(true);
    const stamps = rows.map((r) => r.createdAt);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
  });

  it('幂等：重复渲染不产生重复引用行', () => {
    renderer.render(docId, '正文[Ref:1]', pool);
    renderer.render(docId, '正文[Ref:1]', pool);
    const rows = db.select().from(citations).where(eq(citations.documentId, docId)).all();
    expect(rows).toHaveLength(1);
  });

  it('越界锚点降级为「[文献N]」而不是静默丢弃', () => {
    const out = renderer.render(docId, '引用不存在的池[Ref:99]。', pool);
    expect(out).toContain('[文献99]');
  });
});

/**
 * 标题行内锚点回归。
 *
 * 缺陷：scanCitationSpots 的标题分支用 `[^\n]+` 贪婪吃到行尾，把同行锚点整个吞掉，
 * 导致 poolSpot 缺该 idx → backfillCitations 写入的 citations 行 location/context 为空串。
 * render() 的编号走独立正则、不受影响，所以「编号对、文献对、就是没有出处」，静默残缺。
 */
describe('scanCitationSpots：标题行内的锚点不得被标题吞掉', () => {
  const renderer = new CitationRenderer({} as never);

  it('锚点写在标题行上时仍能取到 location 与 context', () => {
    const content = '## 引言\n铺垫一句。\n\n## 结论 [Ref:1]\n收尾。\n\n## 讨论 [补充Ref:2]\n补充说明。';
    const { poolSpot, suppSpot } = renderer.scanCitationSpots(content, 3, 3);
    expect(poolSpot.get(0)?.location).toBe('结论');
    expect(poolSpot.get(0)?.context).toContain('结论');
    expect(suppSpot.get(1)?.location).toBe('讨论');
  });

  it('标题名不再把锚点文本当成自己的一部分', () => {
    const { poolSpot } = renderer.scanCitationSpots('## 方法 [Ref:2] 与后续', 5, 0);
    expect(poolSpot.get(1)?.location).toBe('方法');
  });

  it('普通行内锚点与多锚点行为不回归', () => {
    const content = '## 引言\n如文献 [Ref:1] 与 [Ref:2] 所述。\n\n## 方法\n再次引用 [Ref:1]，并首引 [Ref:3]。';
    const { poolSpot } = renderer.scanCitationSpots(content, 5, 0);
    expect(poolSpot.get(0)?.location).toBe('引言');
    expect(poolSpot.get(1)?.location).toBe('引言');
    // 首次出现的位置优先（!poolSpot.has(idx) 语义保持不变）：[Ref:1] 在「方法」里再次出现不覆盖
    expect(poolSpot.get(0)?.location).not.toBe('方法');
    // 只在「方法」出现的锚点归属正确
    expect(poolSpot.get(2)?.location).toBe('方法');
    expect(poolSpot.size).toBe(3);
  });

  it('无标题时 location 为空串而非崩溃', () => {
    const { poolSpot } = renderer.scanCitationSpots('正文 [Ref:1] 直接开始。', 2, 0);
    expect(poolSpot.get(0)?.location).toBe('');
  });
});
