import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, researchDesigns } from '../db/schema';
import { ResearchService } from './research.service';
import type { AiService } from '../ai/ai.service';

/**
 * F3 实验设计助手回归（master-plan §9 F3）：
 * 研究问题 → 结构化实验设计（变量表/对照组/样本与功效提示/流程/分析计划）+ 落库。
 * AI 层用假 complete（与 documents-integrity.spec 同模式）：这里锁的是
 * 结构化解析、校验失败降级、持久化与列表删除语义，不是模型本身。
 */

const PROJ = 'test-exp-design-001';

const MOCK_DESIGN = {
  objective: '验证时序感知聚合对动态图节点分类的增益',
  variables: {
    independent: ['邻居采样是否引入时序衰减因子'],
    dependent: ['节点分类 Macro-F1'],
    controlled: ['训练轮数=200', '隐藏维度=64', '数据集划分固定种子'],
  },
  groups: [
    { name: '实验组', role: 'treatment', description: '时序感知采样聚合' },
    { name: '对照基线', role: 'control', description: '标准 GraphSAGE 均匀采样' },
  ],
  sampleHint: '每配置 5 个随机种子，报均值±标准差；显著性用配对 t 检验（α=0.05，power≥0.8）',
  procedure: ['固定数据集与划分', '训练实验组与对照组', '汇总指标并做显著性检验'],
  analysisPlan: ['主指标 Macro-F1 对比表', '消融：去掉时序衰减因子'],
  risks: ['动态图数据集规模有限，方差可能偏大'],
};

function fakeAi(payload: unknown, fail = false): AiService {
  return {
    getCustomPrompt: () => null,
    complete: async () => {
      if (fail) throw new Error('ai down');
      return JSON.stringify(payload);
    },
    safeParse: (text: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }) => {
      try {
        const r = schema.safeParse(JSON.parse(text));
        return r.success ? (r.data as never) : null;
      } catch {
        return null;
      }
    },
  } as unknown as AiService;
}

describe('实验设计助手（F3）', () => {
  const svc = new ResearchService(fakeAi(MOCK_DESIGN));

  const cleanup = () => {
    db.delete(researchDesigns).where(eq(researchDesigns.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();
  };

  beforeEach(() => {
    cleanup();
    db.insert(projects).values({ id: PROJ, name: 'exp-design', createdAt: Date.now(), updatedAt: Date.now() }).run();
  });
  afterEach(cleanup);

  it('生成结构化设计并落库：变量表/对照组/功效提示/流程/分析计划齐全', async () => {
    const r = await svc.designExperiment(PROJ, '时序感知聚合在动态图节点分类中是否优于均匀采样？');
    expect(r.error).toBeUndefined();
    expect(r.design?.variables.independent).toHaveLength(1);
    expect(r.design?.groups).toHaveLength(2);
    expect(r.design?.groups[0].role).toBe('treatment');
    expect(r.design?.sampleHint).toContain('power');
    expect(r.design?.procedure).toHaveLength(3);
    const rows = db.select().from(researchDesigns).where(eq(researchDesigns.projectId, PROJ)).all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].design)).toMatchObject({ objective: MOCK_DESIGN.objective });
  });

  it('研究问题为空 / 项目不存在 → 400 语义错误，不落库', async () => {
    expect((await svc.designExperiment(PROJ, '   ')).error).toBeTruthy();
    expect((await svc.designExperiment('no-such-project', '有效问题')).error).toBeTruthy();
    expect(db.select().from(researchDesigns).where(eq(researchDesigns.projectId, PROJ)).all()).toHaveLength(0);
  });

  it('模型输出不合 schema → 返回解析失败错误（fail-closed），不落脏数据', async () => {
    const bad = new ResearchService(fakeAi({ objective: 123 }));
    const r = await bad.designExperiment(PROJ, '合法问题');
    expect(r.error).toContain('解析失败');
    expect(db.select().from(researchDesigns).where(eq(researchDesigns.projectId, PROJ)).all()).toHaveLength(0);
  });

  it('列表按时间倒序返回，删除单条生效', async () => {
    await svc.designExperiment(PROJ, '问题一');
    await new Promise((r) => setTimeout(r, 5));
    await svc.designExperiment(PROJ, '问题二');
    const list = svc.listDesigns(PROJ);
    expect(list).toHaveLength(2);
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
    svc.deleteDesign(list[0].id);
    expect(svc.listDesigns(PROJ)).toHaveLength(1);
  });
});
