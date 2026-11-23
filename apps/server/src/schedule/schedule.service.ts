import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, lte } from 'drizzle-orm';
import { Cron } from 'croner';
import { NotificationService, type NotificationChannel } from './notification.service';
import { randomBytes } from 'node:crypto';
import { db } from '../db/database';
import { agentSchedules } from '../db/schema';
import { BackgroundRunService } from '../chat/background-run.service';

export type ScheduleCadence = 'once' | 'hourly' | 'daily' | 'weekly';
export type TriggerType = 'time' | 'reference.created' | 'pipeline.completed' | 'quality.threshold' | 'experiment.failed';
const TRIGGER_TYPES: TriggerType[] = ['time', 'reference.created', 'pipeline.completed', 'quality.threshold', 'experiment.failed'];

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
  triggerType?: TriggerType;
  triggerConfig?: Record<string, unknown>;
  notifyChannels?: NotificationChannel[];
  notifyTarget?: string;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function parseChannels(raw: string | null): NotificationChannel[] {
  try {
    const parsed = JSON.parse(raw || '["inapp"]') as string[];
    const list = parsed.filter((c): c is NotificationChannel => ['inapp', 'browser', 'feishu'].includes(c));
    return list.length ? list : ['inapp'];
  } catch {
    return ['inapp'];
  }
}

function cronFor(input: { cadence: ScheduleCadence; minuteOfHour?: number; hourOfDay?: number; weekday?: number }): string {
  const minute = clampInt(input.minuteOfHour, 0, 59, 0);
  const hour = clampInt(input.hourOfDay, 0, 23, 9);
  const weekday = clampInt(input.weekday, 0, 6, 1);
  if (input.cadence === 'hourly') return `${minute} * * * *`;
  if (input.cadence === 'daily') return `${minute} ${hour} * * *`;
  return `${minute} ${hour} * * ${weekday}`;
}

/** 计算下一个触发时间（服务器本地时区）；Croner 负责月份/闰年/夏令时边界。 */
export function computeNextRun(input: {
  cadence: ScheduleCadence;
  minuteOfHour?: number;
  hourOfDay?: number;
  weekday?: number;
  delayMinutes?: number;
}, now = Date.now()): number {
  if (input.cadence === 'once') return now + Math.max(1, clampInt(input.delayMinutes, 1, 60 * 24 * 30, 5)) * 60_000;
  const cron = new Cron(cronFor(input), { paused: true });
  const next = cron.nextRun(new Date(now));
  return next ? next.getTime() : now + 60_000;
}

@Injectable()
export class ScheduleService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly background: BackgroundRunService,
    private readonly notifications: NotificationService,
  ) {}

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
    const triggerType = input.triggerType || 'time';
    const nextRunAt = triggerType === 'time'
      ? computeNextRun({ cadence, minuteOfHour: input.minuteOfHour, hourOfDay: input.hourOfDay, weekday: input.weekday, delayMinutes: input.delayMinutes }, now)
      : now + 1000 * 60 * 60 * 24 * 365;
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
      triggerType,
      triggerConfig: JSON.stringify(input.triggerConfig || {}),
      notifyChannels: JSON.stringify(input.notifyChannels?.length ? input.notifyChannels : ['inapp']),
      notifyTarget: input.notifyTarget || '',
      lastStatus: 'pending',
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
      triggerType: (patch.triggerType || row.triggerType) as TriggerType,
      triggerConfig: patch.triggerConfig ?? JSON.parse(row.triggerConfig || '{}'),
      notifyChannels: patch.notifyChannels ?? parseChannels(row.notifyChannels),
      notifyTarget: patch.notifyTarget ?? row.notifyTarget ?? undefined,
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
      triggerType: patch.triggerType || row.triggerType,
      triggerConfig: patch.triggerConfig ? JSON.stringify(patch.triggerConfig) : row.triggerConfig,
      notifyChannels: patch.notifyChannels ? JSON.stringify(patch.notifyChannels) : row.notifyChannels,
      notifyTarget: patch.notifyTarget ?? row.notifyTarget,
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
    const now = Date.now();
    let lastStatus = 'ok';
    let job: ReturnType<BackgroundRunService['start']> | null = null;
    try {
      job = this.background.start({ projectId: row.projectId, message: row.message, sessionKey: row.sessionKey || 'schedule', model: row.model || undefined });
    } catch (e: unknown) {
      lastStatus = 'error';
      void this.notifySchedule(row, '手动触发失败', e instanceof Error ? e.message : String(e));
    }
    const nextRunAt = row.cadence === 'once' ? now + 1000 * 60 * 60 * 24 * 365 : (row.nextRunAt || now);
    db.update(agentSchedules).set({
      lastRunAt: now,
      lastStatus,
      enabled: row.cadence === 'once' ? 0 : row.enabled,
      nextRunAt,
      updatedAt: now,
    }).where(eq(agentSchedules.id, id)).run();
    return { schedule: this.get(id), job };
  }

  /** 扫描到期任务；失败的任务也推进下一次，避免一次配置错误永久卡住调度器。 */
  async runDue(now = Date.now()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = db.select().from(agentSchedules)
        .where(and(eq(agentSchedules.enabled, 1), eq(agentSchedules.triggerType, 'time'), lte(agentSchedules.nextRunAt, now)))
        .orderBy(asc(agentSchedules.nextRunAt))
        .all();
      for (const row of due) {
        let lastStatus = 'ok';
        try {
          this.background.start({ projectId: row.projectId, message: row.message, sessionKey: row.sessionKey || 'schedule', model: row.model || undefined });
          void this.notifySchedule(row, '定时任务已触发', 'Agent 已入队执行');
        } catch (e: unknown) {
          lastStatus = 'error';
          void this.notifySchedule(row, '定时任务入队失败', e instanceof Error ? e.message : String(e));
        }
        const nextRunAt = row.cadence === 'once'
          ? now + 1000 * 60 * 60 * 24 * 365
          : computeNextRun({ cadence: row.cadence as ScheduleCadence, minuteOfHour: row.minuteOfHour ?? 0, hourOfDay: row.hourOfDay ?? 9, weekday: row.weekday ?? 1 }, now);
        db.update(agentSchedules).set({
          lastRunAt: now,
          nextRunAt,
          enabled: row.cadence === 'once' ? 0 : 1,
          lastStatus,
          updatedAt: now,
        }).where(eq(agentSchedules.id, row.id)).run();
      }
    } finally {
      this.ticking = false;
    }
  }

  private async notifySchedule(row: typeof agentSchedules.$inferSelect, title: string, body: string) {
    const channels = parseChannels(row.notifyChannels);
    await this.notifications.notify({
      projectId: row.projectId,
      kind: 'automation',
      title: `${row.name} · ${title}`,
      body,
      link: `/dashboard?automation=${row.id}`,
      channels,
      webhookUrl: row.notifyTarget || '',
      dedupeKey: `schedule:${row.id}:${row.lastRunAt || ''}:${title}`,
    }).catch(() => undefined);
  }

  private validate(input: Partial<ScheduleInput> & { cadence: ScheduleCadence }) {
    if (!['once', 'hourly', 'daily', 'weekly'].includes(input.cadence)) throw new BadRequestException('不支持的定频类型');
    if (!input.message?.trim()) throw new BadRequestException('任务内容不能为空');
    if (input.name !== undefined && !input.name.trim()) throw new BadRequestException('任务名称不能为空');
    if (input.triggerType && !TRIGGER_TYPES.includes(input.triggerType)) throw new BadRequestException('不支持的触发类型');
    if (input.notifyTarget && input.notifyTarget.trim() && !input.notifyTarget.startsWith('https://')) {
      throw new BadRequestException('Webhook 必须使用 HTTPS');
    }
  }
}
