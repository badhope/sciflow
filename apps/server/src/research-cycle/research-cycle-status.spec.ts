import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { projects } from '../db/schema';
import { ProgramsService } from '../programs/programs.service';
import { ResearchRecordsService } from '../programs/research-records.service';
import { ResearchCycleService } from './research-cycle.service';

/**
 * 循环状态投影的隔离性：
 *  - 同一个 program 跑多轮循环时，status 只返回**本轮**的协议/结论/运行；
 *  - 否则驾驶舱会把上一轮遗留的 draft 协议当成待批方案（误批后可能执行错误实验）。
 */
class FakeAi {
  configured = false;
  config = { model: 'test-model' };
}

describe('ResearchCycleService.status 按轮次隔离', () => {
  let programs: ProgramsService;
  let records: ResearchRecordsService;
  let svc: ResearchCycleService;
  let programId: string;

  beforeEach(() => {
    const pid = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: pid, name: 'Cycle Projection', description: '', createdAt: now, updatedAt: now }).run();
    programs = new ProgramsService();
    records = new ResearchRecordsService();
    programId = programs.createProgram(pid, { title: '多轮计划' }).id;
    svc = new ResearchCycleService(programs, records, {} as never, new FakeAi() as never, {} as never, {} as never);
  });

  /** 造一轮循环：问题 → 假设 → 协议 */
  function seedCycle(objective: string, protocolStatus: 'draft' | 'approved') {
    const cycle = programs.createCycle(programId, { objective });
    const q = programs.createQuestion(programId, { question: objective, cycleId: cycle.id, status: 'active' });
    const h = programs.createHypothesis(q.id, { statement: `${objective} 的假设` });
    const p = programs.createProtocol(h.id, { design: { objective }, status: 'draft' });
    if (protocolStatus === 'approved') programs.approveProtocol(p.id, 'human');
    return { cycle, q, h, p };
  }

  it('只返回本轮问题的协议，不混入上一轮', () => {
    const first = seedCycle('第一轮问题', 'approved');
    const second = seedCycle('第二轮问题', 'draft');

    const firstStatus = svc.status(first.cycle.id);
    expect(firstStatus.protocols.map((p) => p.id)).toEqual([first.p.id]);
    expect(firstStatus.protocols.some((p) => p.id === second.p.id)).toBe(false);

    const secondStatus = svc.status(second.cycle.id);
    expect(secondStatus.protocols.map((p) => p.id)).toEqual([second.p.id]);
  });

  it('只返回本轮结论与运行', () => {
    const first = seedCycle('甲', 'approved');
    const second = seedCycle('乙', 'approved');
    const runOld = records.createRun(programId, { cycleId: first.cycle.id, protocolId: first.p.id, status: 'completed' });
    const runNew = records.createRun(programId, { cycleId: second.cycle.id, protocolId: second.p.id, status: 'running' });
    const claimOld = records.createClaim(programId, { cycleId: first.cycle.id, statement: '甲的结论', status: 'supported' });
    const claimNew = records.createClaim(programId, { cycleId: second.cycle.id, statement: '乙的结论', status: 'draft' });

    const status = svc.status(second.cycle.id);
    expect(status.runs.map((r) => r.id)).toEqual([runNew.id]);
    expect(status.claims.map((c) => c.id)).toEqual([claimNew.id]);
    expect(status.runs.some((r) => r.id === runOld.id)).toBe(false);
    expect(status.claims.some((c) => c.id === claimOld.id)).toBe(false);
  });
});
