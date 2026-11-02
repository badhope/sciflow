import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects, documents, citations, references, qualityReports } from '../db/schema';
import { QualityService } from './quality.service';
import type { AiService } from '../ai/ai.service';

/**
 * 项目内全部文档最新分总览（v1.8）。
 *
 * 契约：
 *  - 客观分对「当前正文」实时计算（确定性），空文/极短文按检查器规则给 0
 *  - LLM 分只取库里最新一条历史，没有就是 null（不冒充成 0）
 *  - 最差优先；同分按 updatedAt 倒序
 *  - passed 阈值 80（与流水线门禁同一常量语义）
 */
describe('QualityService.projectOverview', () => {
  let pid: string;
  let svc: QualityService;
  const para =
    '异配图节点分类中，残差聚合的收益随异配度上升而下降，这一现象对评估协议的设计提出了新的要求 [1]。' +
    '现有综述系统梳理了该领域的方法谱系与评测口径 [1][2]，并指出过平滑与异配度之间的耦合关系 [2]。';
  // 每个章节多段，保证总字数 > 500（检查器对「正文过短」直接判 0 分）
  const longBody = [
    '# 标题',
    '## 引言', para, para,
    '## 相关工作', para, para,
    '## 讨论', para, para,
    '## 结论', para, para,
  ].join('\n');

  beforeEach(() => {
    pid = randomUUID();
    db.insert(projects).values({ id: pid, name: '总览项目', description: '', createdAt: Date.now(), updatedAt: Date.now() }).run();
    svc = new QualityService({} as AiService);
  });

  it('多文档按客观分升序返回，并给出达标/未达标/空文计数', () => {
    const good = randomUUID();
    const empty = randomUUID();
    const now = Date.now();
    db.insert(documents).values({ id: good, projectId: pid, title: '有正文的稿', content: longBody, outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now + 2 }).run();
    db.insert(documents).values({ id: empty, projectId: pid, title: '空稿', content: '', outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now + 1 }).run();

    const out = svc.projectOverview(pid);
    expect(out.total).toBe(2);
    expect(out.items).toHaveLength(2);
    // 空稿 0 分排在最前（最差优先），且被计为 unscored
    expect(out.items[0].objectiveScore).toBe(0);
    expect(out.unscored).toBe(1);
    // 其余文档按分数单调不减
    for (let i = 1; i < out.items.length; i++) {
      expect(out.items[i].objectiveScore).toBeGreaterThanOrEqual(out.items[i - 1].objectiveScore);
    }
    const goodItem = out.items.find((i) => i.documentId === good)!;
    expect(goodItem.objectiveScore).toBeGreaterThan(0);
    expect(out.passed + out.failed).toBe(2);
  });

  it('LLM 分只取最新一条；没有历史时为 null（不冒充 0）', () => {
    const docId = randomUUID();
    const now = Date.now();
    db.insert(documents).values({ id: docId, projectId: pid, title: '有评分的稿', content: longBody, outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now }).run();
    db.insert(qualityReports).values({ id: randomUUID(), documentId: docId, totalScore: 55, scores: '{}', feedback: 'old', createdAt: now - 1000 }).run();
    db.insert(qualityReports).values({ id: randomUUID(), documentId: docId, totalScore: 81, scores: '{}', feedback: 'new', createdAt: now }).run();

    const out = svc.projectOverview(pid);
    const item = out.items.find((i) => i.documentId === docId)!;
    expect(item.llmScore).toBe(81);
    expect(item.llmScoredAt).toBe(now);

    const doc2 = randomUUID();
    db.insert(documents).values({ id: doc2, projectId: pid, title: '没评过', content: longBody, outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now }).run();
    const out2 = svc.projectOverview(pid);
    expect(out2.items.find((i) => i.documentId === doc2)!.llmScore).toBeNull();
  });

  it('引用数参与客观分口径（有 citation 行时不当成无凭证）', () => {
    const docId = randomUUID();
    const refId = randomUUID();
    const now = Date.now();
    db.insert(documents).values({ id: docId, projectId: pid, title: '有引用', content: longBody, outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now }).run();
    db.insert(references).values({ id: refId, projectId: pid, title: '参考文献', authors: 'A', year: 2024, venue: '', doi: '', abstract: '', fingerprint: refId, source: 'manual', readingStatus: 'unread', createdAt: now }).run();
    db.insert(citations).values({ id: randomUUID(), documentId: docId, referenceId: refId, location: '', context: '', format: 'pipeline', createdAt: now }).run();

    const out = svc.projectOverview(pid);
    const item = out.items.find((i) => i.documentId === docId)!;
    expect(item.hardFails.some((f) => f.includes('没有对应参考文献'))).toBe(false);
    expect(item.fingerprint).toMatch(/^q[0-9a-z]+$/);
  });

  it('空项目返回空数组与全 0 计数（不报错）', () => {
    const out = svc.projectOverview(pid);
    expect(out.total).toBe(0);
    expect(out.items).toEqual([]);
    expect(out.passed).toBe(0);
    expect(out.failed).toBe(0);
  });

  it('缺 projectId 抛 400', () => {
    expect(() => svc.projectOverview('')).toThrow(/projectId/);
  });
});
