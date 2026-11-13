import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, references } from '../db/schema';
import { ReferencesService } from './references.service';
import type { AiService } from '../ai/ai.service';

/**
 * 本地文献检索语义：多词查询必须能命中「只含部分词」的论文。
 * 历史实现整串 LIKE，导致「heterophilic graph residual」在库里有相关论文时仍返回 0 条。
 */
const fakeAi = { configured: false, config: { model: 'stub' } } as unknown as AiService;

describe('ReferencesService.search 多词检索', () => {
  let pid: string;
  let svc: ReferencesService;

  beforeEach(() => {
    pid = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: '检索测试', description: '', createdAt: now, updatedAt: now }).run();
    svc = new ReferencesService(fakeAi);
    const rows = [
      { title: 'Heterophilic Graph Residual Aggregation for Node Classification', abstract: 'residual connections reduce over-smoothing', citationCount: 50 },
      { title: 'Over-smoothing in Deep Graph Networks', abstract: 'depth degrades representation', citationCount: 5 },
      { title: 'Clinical Care Pathways After Surgery', abstract: 'patient outcomes', citationCount: 2 },
    ];
    for (const r of rows) {
      svc.create(pid, { title: r.title, authors: ['Zhang, Wei'], year: 2023, abstract: r.abstract, citationCount: r.citationCount });
    }
  });

  afterEach(() => {
    db.delete(references).where(eq(references.projectId, pid)).run();
    db.delete(projects).where(eq(projects.id, pid)).run();
  });

  it('单词命中', () => {
    expect(svc.search('residual', 8, pid).length).toBeGreaterThan(0);
  });

  it('多词 OR 命中，且标题命中排前', () => {
    const hits = svc.search('heterophilic graph residual', 8, pid);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toContain('Heterophilic Graph Residual');
  });

  it('只命中部分词的论文也能返回', () => {
    const hits = svc.search('graph over-smoothing', 8, pid);
    expect(hits.map((h) => h.title)).toContain('Over-smoothing in Deep Graph Networks');
  });

  it('完全不相关的词返回空，不返回全库', () => {
    expect(svc.search('quantum chromodynamics', 8, pid)).toHaveLength(0);
  });

  it('按项目隔离', () => {
    const other = randomUUID();
    db.insert(projects).values({ id: other, name: '他人项目', description: '', createdAt: Date.now(), updatedAt: Date.now() }).run();
    expect(svc.search('heterophilic', 8, other)).toHaveLength(0);
    db.delete(projects).where(eq(projects.id, other)).run();
  });

  it('LIKE 通配符按字面匹配（% 不全命中）', () => {
    expect(svc.search('%', 8, pid)).toHaveLength(0);
  });
});
