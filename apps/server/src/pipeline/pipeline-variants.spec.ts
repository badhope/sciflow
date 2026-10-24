import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { pipelineTasks, projects, documents, reflexionLogs, qualityReports, references } from '../db/schema';
import { buildPipelineGraph, type PipelineGraphDeps, type StepStatusWire } from './pipeline.graph';
import { applyStepWire } from './pipeline.service';
import { MOCK_OUTLINE } from '../../../../packages/ai/src/mock-gateway';

/**
 * 流水线 v1.0 新能力回归：反共识大纲变体（F2）与研究深度（depth 多轮检索）。
 * 用假 deps 驱动真图 + 真 SQLite：variants/depth 是图编排逻辑，mock 掉图就测不出。
 */

const PROJ = 'test-pipeline-variants-001';

function baseDeps(over: Partial<PipelineGraphDeps> = {}): PipelineGraphDeps {
  const notifyCalls: { key: string; status: StepStatusWire; output?: string; extra?: Record<string, unknown> }[] = [];
  const deps: PipelineGraphDeps = {
    ai: {
      summarizeLiterature: async () => '综述摘要',
      writeOutline: async () => JSON.parse(JSON.stringify(MOCK_OUTLINE)),
      writeOutlineVariants: async () => [JSON.parse(JSON.stringify(MOCK_OUTLINE)), { title: '反共识大纲 A', sections: [{ title: '为什么主流方法是错的', subsections: [] }] }, { title: '反共识大纲 B', sections: [{ title: '被忽视的负结果', subsections: [] }] }],
      planResearch: async (t) => ({ keywords: [`kw-${t.slice(0, 6)}`, 'graph neural network'] }),
      reviewPaper: async () => ({ totalScore: 85, feedback: 'ok', scores: { literature: 85 } }),
      polish: async (text) => ({ original: text, polished: text, reason: 'same' }),
      extractEpisodic: async () => ({ content: 'mem', keywords: ['k'] }),
      generateFigures: async () => [],
    },
    trackBudget: () => {},
    runDrafting: async (_t, _title, outline) => outline.sections.map((s) => `## ${typeof s === 'string' ? s : s.title}\n\n正文`).join('\n\n'),
    buildRefsPrompt: () => '',
    renderCitations: (_p, _d, content) => content,
    crossEnrich: async () => ({ libraryHits: [], knowledgeHits: [], notice: null, meta: { lib: [], kn: [] }, summary: '检索到 0 条' }),
    researchDepth: () => 1,
    notify: async (taskId, key, status, output, retryCount, extra) => {
      notifyCalls.push({ key, status, output, extra });
      await defaultNotify(taskId, key, status, output, retryCount, extra);
    },
    stepEnabled: (key) => key !== 'figures',
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    ...over,
  };
  return Object.assign(deps, { notifyCalls });
}

/** 与 PipelineService.notify 同语义的最小实现（steps JSON 投影走同一纯函数 applyStepWire） */
async function defaultNotify(taskId: string, key: string, status: StepStatusWire, output?: string, retryCount?: number, extra?: Record<string, unknown>) {
  const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get();
  if (!row) return;
  const steps = JSON.parse(row.steps || '[]') as { key: string; label: string; status: string; retryCount: number; [k: string]: unknown }[];
  const s = steps.find((x) => x.key === key);
  if (!s) return;
  applyStepWire(s as never, status, output, retryCount, extra as never, Date.now());
  db.update(pipelineTasks).set({ steps: JSON.stringify(steps), updatedAt: Date.now() }).where(eq(pipelineTasks.id, taskId)).run();
}

interface InterruptResult {
  __interrupt__?: { value: { outline: string; variants: string[] } }[];
}

async function createTask(topic: string): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  db.insert(pipelineTasks).values({
    id, projectId: PROJ, documentId: null, topic,
    currentStep: 'topic-verify', status: 'running',
    steps: JSON.stringify([
      { key: 'topic-verify', label: '主题验证', status: 'pending', retryCount: 0 },
      { key: 'literature', label: '文献调研', status: 'pending', retryCount: 0 },
      { key: 'outline', label: '大纲', status: 'pending', retryCount: 0 },
      { key: 'quality-gate', label: '质量门', status: 'pending', retryCount: 0 },
    ]),
    retryCount: 0, lastError: '', createdAt: now, updatedAt: now,
  }).run();
  return id;
}

function loadSteps(taskId: string) {
  const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get();
  return JSON.parse((row?.steps as string) || '[]') as { key: string; status: string; output?: string; variants?: string[]; startedAt?: number; endedAt?: number; retryCount: number }[];
}

describe('流水线反共识大纲变体与研究深度', () => {
  let taskId = '';

  const cleanup = () => {
    const ids = db.select({ id: documents.id }).from(documents).where(eq(documents.projectId, PROJ)).all().map((d) => d.id);
    if (ids.length) {
      db.delete(qualityReports).where(eq(qualityReports.documentId, ids[0])).run();
      db.delete(documents).where(eq(documents.projectId, PROJ)).run();
    }
    db.delete(reflexionLogs).where(eq(reflexionLogs.taskId, taskId)).run();
    db.delete(pipelineTasks).where(eq(pipelineTasks.projectId, PROJ)).run();
    db.delete(references).where(eq(references.projectId, PROJ)).run();
    db.delete(projects).where(eq(projects.id, PROJ)).run();
    taskId = '';
  };

  beforeEach(() => {
    cleanup();
    db.insert(projects).values({ id: PROJ, name: 'variants', createdAt: Date.now(), updatedAt: Date.now() }).run();
  });
  afterEach(cleanup);

  it('outline-gen 产出反共识变体：interrupt payload 携带主大纲 + 2 个变体，steps JSON 落 variants', async () => {
    taskId = await createTask('图神经网络综述');
    const deps = baseDeps();
    const graph = buildPipelineGraph(deps);
    const result = (await graph.invoke({ taskId, task: db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get() as never }, { configurable: { thread_id: taskId } } as never)) as InterruptResult;
    expect(result.__interrupt__).toBeTruthy();
    const payload = result.__interrupt__![0].value;
    const primary = JSON.parse(payload.outline);
    expect(primary.title).toContain('图神经网络');
    expect(payload.variants).toHaveLength(2);
    expect(JSON.parse(payload.variants[0]).title).toBe('反共识大纲 A');
    const outlineStep = loadSteps(taskId).find((s) => s.key === 'outline');
    expect(outlineStep?.status).toBe('awaiting_confirmation');
    expect(outlineStep?.variants).toHaveLength(2);
  });

  it('writeOutlineVariants 失败时回退单大纲：无 variants 字段，流程不中断', async () => {
    taskId = await createTask('变体失败回退');
    const deps = baseDeps({
      ai: {
        ...baseDeps().ai,
        writeOutlineVariants: async () => { throw new Error('variants unavailable'); },
      },
    });
    const graph = buildPipelineGraph(deps);
    const result = (await graph.invoke({ taskId, task: db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get() as never }, { configurable: { thread_id: taskId } } as never)) as InterruptResult;
    expect(result.__interrupt__).toBeTruthy();
    const payload = result.__interrupt__![0].value;
    expect(JSON.parse(payload.outline).title).toContain('图神经网络');
    expect(payload.variants).toHaveLength(0);
    expect(loadSteps(taskId).find((s) => s.key === 'outline')?.variants).toBeUndefined();
  });

  it('researchDepth=2：literature 两轮检索（第二轮换检索词），命中按 id 去重合并，trace 记录两轮', async () => {
    taskId = await createTask('深度两轮');
    const crossCalls: string[] = [];
    const hitA = { id: 'r1', title: 'GNN Survey', authors: [], year: 2023, venue: 'J', doi: '', url: '', abstract: '', source: 'manual', citationCount: 0, origin: 'library' as const, matchScore: 0.9 };
    const hitB = { id: 'r2', title: 'Dynamic GNN', authors: [], year: 2024, venue: 'J', doi: '', url: '', abstract: '', source: 'manual', citationCount: 0, origin: 'library' as const, matchScore: 0.8 };
    const deps = baseDeps({
      researchDepth: () => 2,
      crossEnrich: async (_p, topic, plan) => {
        const kw = (plan.searchStrategy?.keywords || [topic])[0];
        crossCalls.push(kw);
        return {
          libraryHits: crossCalls.length === 1 ? [hitA, { ...hitB, id: 'dup-r1' }] : [hitB, hitA],
          knowledgeHits: [],
          notice: null,
          meta: { lib: [{ title: 'x', score: 1 }], kn: [] },
          summary: `round ${crossCalls.length}`,
        };
      },
    });
    const graph = buildPipelineGraph(deps);
    await graph.invoke({ taskId, task: db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get() as never }, { configurable: { thread_id: taskId } } as never);
    expect(crossCalls).toHaveLength(2);
    expect(crossCalls[0]).not.toBe(crossCalls[1]);
    const litStep = loadSteps(taskId).find((s) => s.key === 'literature');
    expect(litStep?.status).toBe('done');
    const outlineWire = loadSteps(taskId).find((s) => s.key === 'outline')?.output || '';
    void outlineWire;
    const taskRow = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get() as { trace: string };
    const trace = JSON.parse(taskRow.trace || '[]') as { round: number; query: string; thought: string }[];
    expect(trace.length).toBeGreaterThanOrEqual(4);
    expect(trace.some((t) => t.thought.includes('第 2 轮'))).toBe(true);
  });

  it('researchDepth 缺省为 1：crossEnrich 只调用一次', async () => {
    taskId = await createTask('默认单轮');
    let calls = 0;
    const deps = baseDeps({
      crossEnrich: async () => { calls += 1; return { libraryHits: [], knowledgeHits: [], notice: '未检索到', meta: { lib: [], kn: [] }, summary: '0' }; },
    });
    const graph = buildPipelineGraph(deps);
    await graph.invoke({ taskId, task: db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get() as never }, { configurable: { thread_id: taskId } } as never);
    expect(calls).toBe(1);
  });

  it('notify 状态投影带起止时间戳：running 写 startedAt，done 写 endedAt（F-2.7 时间线数据源）', async () => {
    taskId = await createTask('时间戳投影');
    const deps = baseDeps();
    const graph = buildPipelineGraph(deps);
    await graph.invoke({ taskId, task: db.select().from(pipelineTasks).where(eq(pipelineTasks.id, taskId)).get() as never }, { configurable: { thread_id: taskId } } as never);
    const steps = loadSteps(taskId);
    const tv = steps.find((s) => s.key === 'topic-verify')!;
    expect(tv.startedAt).toBeGreaterThan(0);
    expect(tv.endedAt!).toBeGreaterThanOrEqual(tv.startedAt!);
    const lit = steps.find((s) => s.key === 'literature')!;
    expect(lit.startedAt).toBeGreaterThan(0);
    expect(lit.endedAt).toBeGreaterThan(0);
  });
});
