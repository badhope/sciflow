import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '../db/database';
import { agentSchedules } from '../db/schema';
import { BackgroundRunService } from '../chat/background-run.service';

export type ScheduleCadence = 'once' | 'hourly' | 'daily' | 'weekly';

export interface ScheduleInput {
  projectId: string;
  name: string;
  cadence: ScheduleCadence;
  minuteOfHour?: number;
  hourOfDay?: number;
  weekday?: number;
  message: string;
  sessionKey?: string;
  model?: string;
  delayMinutes?: number;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

/** 计算下一个触发时间（服务器本地时区，和用户看到的 UI 时区一致）。 */
export function computeNextRun(input: {
  cadence: ScheduleCadence;
  minuteOfHour?: number;
  hourOfDay?: number;
  weekday?: number;
  delayMinutes?: number;
}, now = Date.now()): number {
  const minute = clampInt(input.minuteOfHour, 0, 59, 0);
  const hour = clampInt(input.hourOfDay, 0, 23, 9);
  const weekday = clampInt(input.weekday, 0, 6, 1);
  if (input.cadence === 'once') return now + Math.max(1, clampInt(input.delayMinutes, 1, 60 * 24 * 30, 5)) * 60_000;

  const d = new Date(now);
  d.setSeconds(0, 0);
  if (input.cadence === 'hourly') {
    d.setMinutes(minute);
    if (d.getTime() <= now) d.setHours(d.getHours() + 1);
    return d.getTime();
  }
  d.setHours(hour, minute, 0, 0);
  if (input.cadence === 'daily') {
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  // weekly：从今天起最多找 7 天，避开「今天已过点」的边界。
  for (let i = 0; i < 8; i += 1) {
    if (d.getDay() === weekday && d.getTime() > now) return d.getTime();
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

@Injectable()
export class ScheduleService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private readonly background: BackgroundRunService) {}

  onModuleInit(): void {
    // 每 30 秒扫描一次；单机单进程部署足够，多实例时由 agent_schedule 的唯一任务语义 + 下次更新时间避免重复。
    this.timer = setInterval(() => void this.runDue(), 30_000);
    this.timer.unref?.();
    void this.runDue();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  create(input: ScheduleInput) {
    this.validate(input);
    const now = Date.now();
    const id = randomBytes(12).toString('hex');
    const cadence = input.cadence;
    const nextRunAt = computeNextRun({ cadence, minuteOfHour: input.minuteOfHour, hourOfDay: input.hourOfDay, weekday: input.weekday, delayMinutes: input.delayMinutes }, now);
    db.insert(agentSchedules).values({
      id,
      projectId: input.projectId,
      name: input.name.trim() || '定时任务',
      cadence,
      minuteOfHour: clampInt(input.minuteOfHour, 0, 59, 0),
      hourOfDay: clampInt(input.hourOfDay, 0, 23, 9),
      weekday: clampInt(input.weekday, 0, 6, 1),
      message: input.message,
      sessionKey: input.sessionKey || 'schedule',
      model: input.model || '',
      enabled: 1,
      nextRunAt,
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.get(id)!;
  }

  list(projectId: string) {
    return db.select().from(agentSchedules).where(eq(agentSchedules.projectId, projectId)).orderBy(asc(agentSchedules.nextRunAt)).all();
  }

  get(id: string) {
    return db.select().from(agentSchedules).where(eq(agentSchedules.id, id)).get();
  }

  update(id: string, projectId: string, patch: Partial<Omit<ScheduleInput, 'projectId'>> & { enabled?: boolean }) {
    const row = this.get(id);
    if (!row || row.projectId !== projectId) throw new NotFoundException('定时任务不存在');
    const cadence = (patch.cadence || row.cadence) as ScheduleCadence;
    const merged = {
      cadence,
      minuteOfHour: patch.minuteOfHour ?? row.minuteOfHour ?? 0,
      hourOfDay: patch.hourOfDay ?? row.hourOfDay ?? 9,
      weekday: patch.weekday ?? row.weekday ?? 1,
      delayMinutes: 5,
    };
    this.validate({
      projectId,
      name: patch.name ?? row.name,
      cadence,
      message: patch.message ?? row.message,
      minuteOfHour: merged.minuteOfHour,
      hourOfDay: merged.hourOfDay,
      weekday: merged.weekday,
      sessionKey: patch.sessionKey ?? row.sessionKey ?? undefined,
      model: patch.model ?? row.model ?? undefined,
      delayMinutes: merged.delayMinutes,
    });
    const enabled = patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0);
    const nextRunAt = enabled ? computeNextRun(merged) : row.nextRunAt;
    db.update(agentSchedules).set({
      name: patch.name?.trim() || row.name,
      cadence,
      minuteOfHour: merged.minuteOfHour,
      hourOfDay: merged.hourOfDay,
      weekday: merged.weekday,
      message: patch.message ?? row.message,
      sessionKey: patch.sessionKey ?? row.sessionKey,
      model: patch.model ?? row.model,
      enabled,
      nextRunAt,
      updatedAt: Date.now(),
    }).where(eq(agentSchedules.id, id)).run();
    return this.get(id)!;
  }

  remove(id: string, projectId: string) {
    const row = this.get(id);
    if (!row || row.projectId !== projectId) throw new NotFoundException('定时任务不存在');
    db.delete(agentSchedules).where(eq(agentSchedules.id, id)).run();
    return { deleted: true, id };
  }

  /** 立即触发一次（不改变周期，只把 lastRunAt 写为当前）。 */
  runNow(id: string, projectId: string) {
    const row = this.get(id);
    if (!row || row.projectId !== projectId) throw new NotFoundException('定时任务不存在');
    const job = this.background.start({ projectId: row.projectId, message: row.message, sessionKey: row.sessionKey || 'schedule', model: row.model || undefined });
    db.update(agentSchedules).set({ lastRunAt: Date.now(), updatedAt: Date.now() }).where(eq(agentSchedules.id, id)).run();
    return { schedule: this.get(id), job };
  }

  /** 扫描到期任务；失败的任务也推进下一次，避免一次配置错误永久卡住调度器。 */
  async runDue(now = Date.now()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = db.select().from(agentSchedules)
        .where(and(eq(agentSchedules.enabled, 1), lte(agentSchedules.nextRunAt, now)))
        .orderBy(asc(agentSchedules.nextRunAt))
        .all();
      for (const row of due) {
        try {
          this.background.start({ projectId: row.projectId, message: row.message, sessionKey: row.sessionKey || 'schedule', model: row.model || undefined });
        } catch {
          // 入队失败也要推进 nextRunAt，错误留给列表页/后台任务状态呈现。
        }
        const nextRunAt = row.cadence === 'once'
          ? now + 1000 * 60 * 60 * 24 * 365
          : computeNextRun({ cadence: row.cadence as ScheduleCadence, minuteOfHour: row.minuteOfHour ?? 0, hourOfDay: row.hourOfDay ?? 9, weekday: row.weekday ?? 1 }, now);
        db.update(agentSchedules).set({
          lastRunAt: now,
          nextRunAt,
          enabled: row.cadence === 'once' ? 0 : 1,
          updatedAt: now,
        }).where(eq(agentSchedules.id, row.id)).run();
      }
    } finally {
      this.ticking = false;
    }
  }

  private validate(input: Partial<ScheduleInput> & { cadence: ScheduleCadence }) {
    if (!['once', 'hourly', 'daily', 'weekly'].includes(input.cadence)) throw new BadRequestException('不支持的定频类型');
    if (!input.message?.trim()) throw new BadRequestException('任务内容不能为空');
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('任务名称不能为空');
  }
}
