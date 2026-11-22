import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { agentSchedules, projects } from '../db/schema';
import { computeNextRun, ScheduleService } from './schedule.service';

const PROJ = 'test-schedule-001';
const background = { start: vi.fn(() => ({ id: 'job-1' })) } as never;
const service = new ScheduleService(background);

function cleanup() {
  db.delete(agentSchedules).where(eq(agentSchedules.projectId, PROJ)).run();
  db.delete(projects).where(eq(projects.id, PROJ)).run();
}

describe('computeNextRun', () => {
  const now = new Date(2026, 10, 22, 10, 30, 0, 0).getTime(); // 2026-11-22 10:30 本地时间（周日）

  it('schedules hourly at the next matching minute', () => {
    const d = new Date(computeNextRun({ cadence: 'hourly', minuteOfHour: 15 }, now));
    expect(d.getHours()).toBe(11);
    expect(d.getMinutes()).toBe(15);
  });

  it('schedules daily to tomorrow when today has passed', () => {
    const d = new Date(computeNextRun({ cadence: 'daily', hourOfDay: 9, minuteOfHour: 0 }, now));
    expect(d.getDate()).toBe(23);
    expect(d.getHours()).toBe(9);
  });

  it('schedules weekly on the next matching weekday', () => {
    const d = new Date(computeNextRun({ cadence: 'weekly', weekday: 1, hourOfDay: 9, minuteOfHour: 0 }, now));
    expect(d.getDay()).toBe(1);
    expect(d.getHours()).toBe(9);
  });
});

describe('ScheduleService', () => {
  beforeEach(() => {
    cleanup();
    const now = Date.now();
    db.insert(projects).values({ id: PROJ, name: '调度测试', createdAt: now, updatedAt: now }).run();
  });
  afterEach(cleanup);

  it('creates, toggles and removes a schedule', () => {
    const s = service.create({ projectId: PROJ, name: '每日简报', cadence: 'daily', hourOfDay: 8, minuteOfHour: 30, message: '读论文' });
    expect(s.nextRunAt).toBeGreaterThan(Date.now());
    expect(service.list(PROJ)).toHaveLength(1);
    const paused = service.update(s.id, PROJ, { enabled: false });
    expect(paused.enabled).toBe(0);
    expect(service.remove(s.id, PROJ).deleted).toBe(true);
    expect(service.list(PROJ)).toHaveLength(0);
  });

  it('runs a schedule now through the background executor', () => {
    const s = service.create({ projectId: PROJ, name: '立即运行', cadence: 'daily', message: '执行' });
    const out = service.runNow(s.id, PROJ);
    expect(out.job).toBeTruthy();
    expect(background.start).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJ, message: '执行' }));
  });
});
