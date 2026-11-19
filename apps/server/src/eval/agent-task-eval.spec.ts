import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, memoryLogs, researchBriefs } from '../db/schema';
import { ResearchBriefService } from '../research-brief/research-brief.service';
import { planWithPi } from '../research-cycle/agents/pi.agent';
import { MemoryService } from '../memory/memory.service';
import { ApprovalService } from '../agent/approval.service';
import { AGENT_TOOL_PROFILES, profileAllowsTool } from '../agent/agent-tool-profiles';
import { toVectorBlob } from '../knowledge/embedding.service';

const PID = 'agent-task-eval-project';
const NOW = Date.now();

/**
 * 任务级 eval 基线：不是测单个函数，而是测「Agent 完成一类科研任务所依赖的契约」。
 * 这些任务在真实模型接入后仍应通过；若某天 Brief 不再进 PI、记忆又退回纯时间排序、
 * 或写契约绕过审批，这里会直接红。
 */
describe('Agent 任务级 eval', () => {
  const brief = new ResearchBriefService();

  beforeEach(() => {
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
    db.delete(researchBriefs).where(eq(researchBriefs.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
    db.insert(projects).values({ id: PID, name: '任务级 eval', description: '', status: 'active', createdAt: NOW, updatedAt: NOW }).run();
  });

  afterEach(() => {
    db.delete(memoryLogs).where(eq(memoryLogs.projectId, PID)).run();
    db.delete(researchBriefs).where(eq(researchBriefs.projectId, PID)).run();
    db.delete(projects).where(eq(projects.id, PID)).run();
  });

  it('任务：给项目制定研究计划时，必须带上 Brief 的约束与成功标准', async () => {
    brief.upsert(PID, {
      question: '低资源中文文本分类是否适合 GNN？',
      constraints: '单卡 24G，两周内完成',
      successCriteria: 'F1 相对微调提升 2 个点',
    });
    const completeStructured = vi.fn().mockResolvedValue({ questionEcho: 'q' });
    const ai = { completeStructured } as never;

    await planWithPi(ai, {
      question: '低资源中文文本分类',
      iteration: 0,
      brief: brief.render(PID),
    });

    const messages = completeStructured.mock.calls[0][0] as { role: string; content: string }[];
    const prompt = messages.find((m) => m.role === 'user')!.content;
    expect(prompt).toContain('单卡 24G');
    expect(prompt).toContain('F1 相对微调提升 2 个点');
  });

  it('任务：从失败经验里召回相关记忆，而不是只拿最近四条', async () => {
    const vec = (dim: number) => {
      const v = new Array(384).fill(0);
      v[dim] = 1;
      return v;
    };
    const embedding = {
      embed: vi.fn(async (text: string) => toVectorBlob(text.includes('alpha') ? vec(0) : vec(1))),
      embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => toVectorBlob(t.includes('alpha') ? vec(0) : vec(1)))),
    };
    const memory = new MemoryService(embedding as never);
    memory.add('episodic', 'alpha 实验失败：样本太少导致方差过大', PID);
    memory.add('episodic', 'beta 投稿经验：格式审查', PID);

    const hits = await memory.recall(PID, 'alpha 样本方差', 3);
    expect(hits[0].content).toContain('alpha');
    expect(hits[0].match).toMatch(/semantic|hybrid/);
  });

  it('任务：Agent 修改研究契约前必须审批，读契约不需要', () => {
    const approvals = new ApprovalService();
    expect(approvals.needsApproval('research.brief.get')).toBe(false);
    expect(approvals.needsApproval('research.brief.update')).toBe(true);
  });

  it('任务：研究只读角色能读 Brief，但不能写 Brief', () => {
    expect(profileAllowsTool(AGENT_TOOL_PROFILES.research, 'research.brief.get')).toBe(true);
    expect(profileAllowsTool(AGENT_TOOL_PROFILES.research, 'research.brief.update')).toBe(false);
    expect(profileAllowsTool(AGENT_TOOL_PROFILES.experiment, 'research.brief.update')).toBe(true);
  });
});
