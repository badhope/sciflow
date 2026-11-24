import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sqlite } from '../db/database';
import { projects, researchCycles } from '../db/schema';
import { ProgramsService } from '../programs/programs.service';
import { ResearchRecordsService } from '../programs/research-records.service';
import { ResearchCycleService } from './research-cycle.service';

class FakeAi {
  configured = true;
  config = { model: 'test-model' };
}

/** 只供 service 的恢复路径使用；真正 invoke 被 spy 替换，不会碰图。 */
class FakeTrace {
  startRun() {
    return 'run-test';
  }
  finishRun() {}
}

function insertCheckpoint(cycleId: string) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint BLOB,
    metadata BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
  )`);
  sqlite
    .prepare(
      `INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata)
       VALUES (?, '', ?, 'json', NULL, NULL)`,
    )
    .run(cycleId, `cp-${cycleId}`);
}

describe('ResearchCycleService 启动恢复与看门狗', () => {
  let programs: ProgramsService;
  let records: ResearchRecordsService;
  let service: ResearchCycleService;
  let programId: string;
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: projectId, name: 'Recovery', description: '', createdAt: now, updatedAt: now }).run();
    programs = new ProgramsService();
    records = new ResearchRecordsService();
    programId = programs.createProgram(projectId, { title: '恢复测试' }).id;
    service = new ResearchCycleService(
      programs,
      records,
      {} as never,
      new FakeAi() as never,
      new FakeTrace() as never,
      {} as never,
    );
  });

  it('有 checkpoint 的执行中循环会在启动时自动续跑', () => {
    const cycle = programs.createCycle(programId, { objective: '恢复我', state: 'execute' });
    programs.createQuestion(programId, { question: '恢复我', cycleId: cycle.id, status: 'active' });
    insertCheckpoint(cycle.id);
    const invoke = vi.spyOn(service as never as { invoke: (...args: unknown[]) => Promise<unknown> }, 'invoke').mockResolvedValue(undefined);

    const result = service.recoverInterrupted();

    expect(result.resumed).toBeGreaterThanOrEqual(1);
    expect(invoke).toHaveBeenCalledWith(cycle.id, projectId, null);
    expect(programs.getCycle(cycle.id).summary).toContain('断点');
    programs.updateCycle(cycle.id, { state: 'stopped' }); // 隔离后续用例的全局扫描
  });

  it('没有 checkpoint 的执行中循环标 blocked，不伪造续跑', () => {
    const cycle = programs.createCycle(programId, { objective: '没有断点', state: 'analyze' });
    const result = service.recoverInterrupted();

    expect(result.blocked).toBeGreaterThanOrEqual(1);
    const row = programs.getCycle(cycle.id);
    expect(row.state).toBe('blocked');
    expect(row.summary).toContain('未找到 LangGraph 断点');
  });

  it('awaiting_approval 保留断点等待人工，不自动跑', () => {
    const cycle = programs.createCycle(programId, { objective: '等我批', state: 'awaiting_approval' });
    insertCheckpoint(cycle.id);
    const invoke = vi.spyOn(service as never as { invoke: (...args: unknown[]) => Promise<unknown> }, 'invoke').mockResolvedValue(undefined);

    const result = service.recoverInterrupted();

    expect(result.waiting).toBeGreaterThanOrEqual(1);
    expect(result.resumed).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(programs.getCycle(cycle.id).state).toBe('awaiting_approval');
    programs.updateCycle(cycle.id, { state: 'stopped' }); // 隔离后续用例的全局扫描
  });

  it('synthesize 是终态，重启时不能被当成执行中循环', () => {
    const cycle = programs.createCycle(programId, { objective: '已完成', state: 'synthesize' });
    insertCheckpoint(cycle.id);
    const invoke = vi.spyOn(service as never as { invoke: (...args: unknown[]) => Promise<unknown> }, 'invoke').mockResolvedValue(undefined);

    const result = service.recoverInterrupted();

    expect(result.resumed).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
    expect(programs.getCycle(cycle.id).state).toBe('synthesize');
    programs.updateCycle(cycle.id, { state: 'stopped' });
  });

  it('看门狗把长时间无心跳的活动循环标 blocked 并释放锁', () => {
    const cycle = programs.createCycle(programId, { objective: '卡住', state: 'execute' });
    const active = service as never as {
      watchdogMs: number;
      active: Map<string, { cycleId: string; startedAt: number }>;
      heartbeats: Map<string, number>;
      running: Set<string>;
      sweepStaleCycles(now?: number): number;
    };
    active.watchdogMs = 60_000;
    active.active.set(programId, { cycleId: cycle.id, startedAt: 1 });
    active.heartbeats.set(cycle.id, 1);
    active.running.add(programId);

    const marked = active.sweepStaleCycles(Date.now());

    expect(marked).toBeGreaterThanOrEqual(1);
    expect(programs.getCycle(cycle.id).state).toBe('blocked');
    expect(active.running.has(programId)).toBe(false);
    expect(active.active.has(programId)).toBe(false);
  });

  it('看门狗会收掉库里过期但没有进程持有的执行状态', () => {
    (service as never as { watchdogMs: number }).watchdogMs = 60_000;
    const cycle = programs.createCycle(programId, { objective: '孤儿', state: 'revise' });
    const old = Date.now() - 10 * 60_000;
    db.update(researchCycles).set({ updatedAt: old }).where(eq(researchCycles.id, cycle.id)).run();
    const marked = service.sweepStaleCycles(Date.now());

    expect(marked).toBeGreaterThanOrEqual(1);
    expect(programs.getCycle(cycle.id).state).toBe('blocked');
  });
});
