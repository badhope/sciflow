import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, documents, qualityReports } from '../db/schema';
import { QualityService } from './quality.service';
import type { AiService } from '../ai/ai.service';

/**
 * 质量报告分数来源隔离（回归）：
 *  - 客观分（门禁）与 LLM 参考分必须各写各的列，不能混进同一个 total_score
 *  - total_score 兼容列写客观分；scores 兼容列继续写 LLM 七维
 *  - 拆分前的老行（objective_score/llm_score 均为 null）读取时按老语义回填 LLM 分
 */
describe('QualityService 分数来源拆分', () => {
  const content = [
    '# 异配图节点分类的评估协议',
    '## 引言',
    '异配图节点分类中，残差聚合的收益随异配度上升而下降，这一现象对评估协议的设计提出了新的要求 [1]。',
    '现有综述系统梳理了该领域的方法谱系与评测口径 [1][2]，并指出过平滑与异配度之间的耦合关系 [2]。',
    '## 方法',
    '我们比较三种聚合器在五个异配基准上的表现，并固定随机种子与划分协议，保证结果可复现 [1]。',
    '## 结果',
    '实验显示残差连接在高中介异配度下收益衰减，误差棒来自五次重复实验 [2]。',
    '## 讨论',
    '该结果提示评估协议需要同时报告同配度与异配度分层指标 [1][2]。',
  ].join('\n');

  let pid: string;
  let docId: string;

  beforeEach(() => {
    pid = randomUUID();
    docId = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: '分数拆分项目', description: '', createdAt: now, updatedAt: now }).run();
    db.insert(documents)
      .values({ id: docId, projectId: pid, title: '分数拆分稿', content, outline: '[]', version: 1, versions: '[]', status: 'draft', createdAt: now, updatedAt: now })
      .run();
  });

  it('LLM 分与客观分分列落库，兼容列保持门禁口径', async () => {
    const llmScores = { literature: 88, logic: 91, citation: 84, language: 90, novelty: 86, figures: 82, format: 89 };
    const svc = new QualityService({
      reviewPaper: async () => ({ totalScore: 93, feedback: '结构清晰，可补充消融实验', scores: llmScores }),
    } as unknown as AiService);

    const report = await svc.review(docId, '分数拆分稿', content);

    expect(report.llmScore).toBe(93);
    expect(report.llmScores).toEqual(llmScores);
    expect(report.scoreSource).toBe('split');
    expect(typeof report.objectiveScore).toBe('number');
    expect(report.objectiveDimensions.length).toBeGreaterThan(0);
    // 门禁分 = 客观分，不采用 LLM 分
    expect(report.totalScore).toBe(report.objectiveScore);
    // 兼容字段 scores 仍是 LLM 七维（旧客户端画雷达图不受影响）
    expect(report.scores).toEqual(llmScores);

    const stored = db.select().from(qualityReports).where(eq(qualityReports.id, report.id)).get()!;
    expect(stored.totalScore).toBe(stored.objectiveScore);
    expect(stored.llmScore).toBe(93);
    expect(JSON.parse(stored.llmScores || '{}')).toEqual(llmScores);
    expect(stored.expertStatus).toBe('unreviewed');

    const latest = svc.latest(docId)!;
    expect(latest.llmScore).toBe(93);
    expect(latest.objectiveScore).toBe(report.objectiveScore);
    expect(latest.scoreSource).toBe('split');
  });

  it('拆分前老行读取时回填 LLM 分，不冒充客观分', () => {
    const id = randomUUID();
    const now = Date.now();
    db.insert(qualityReports)
      .values({ id, documentId: docId, totalScore: 71, scores: '{"logic":71}', feedback: '老报告', createdAt: now })
      .run();
    const svc = new QualityService({} as AiService);

    const latest = svc.latest(docId)!;
    expect(latest.totalScore).toBe(71);
    expect(latest.llmScore).toBe(71);
    expect(latest.llmScores).toEqual({ logic: 71 });
    expect(latest.objectiveScore).toBeNull();
    expect(latest.scoreSource).toBe('llm-legacy');
  });
});
