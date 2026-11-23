import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/database';
import { agentSchedules } from '../db/schema';
import { BackgroundRunService } from '../chat/background-run.service';
import { NotificationService, type NotificationChannel } from './notification.service';

export interface AutomationEvent {
  projectId: string;
  title?: string;
  referenceId?: string;
  documentId?: string;
  experimentId?: string;
  score?: number;
  status?: string;
  error?: string;
}

function channelsOf(raw: string | null): NotificationChannel[] {
  try {
    const list = (JSON.parse(raw || '["inapp"]') as string[])
      .filter((c): c is NotificationChannel => ['inapp', 'browser', 'feishu'].includes(c));
    return list.length ? list : ['inapp'];
  } catch {
    return ['inapp'];
  }
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly background: BackgroundRunService,
    private readonly notifications: NotificationService,
  ) {}

  @OnEvent('reference.created', { async: true })
  async onReferenceCreated(event: AutomationEvent) {
    await this.fire('reference.created', event);
  }

  @OnEvent('pipeline.completed', { async: true })
  async onPipelineCompleted(event: AutomationEvent) {
    await this.fire('pipeline.completed', event);
  }

  @OnEvent('quality.scored', { async: true })
  async onQualityScored(event: AutomationEvent) {
    await this.fire('quality.threshold', event);
  }

  @OnEvent('experiment.failed', { async: true })
  async onExperimentFailed(event: AutomationEvent) {
    await this.fire('experiment.failed', event);
  }

  private async fire(trigger: string, event: AutomationEvent) {
    if (!event?.projectId) return;
    const rows = db.select().from(agentSchedules)
      .where(and(eq(agentSchedules.projectId, event.projectId), eq(agentSchedules.enabled, 1), eq(agentSchedules.triggerType, trigger)))
      .all();
    for (const row of rows) {
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(row.triggerConfig || '{}') as Record<string, unknown>; } catch { /* 使用默认条件 */ }
      if (trigger === 'quality.threshold') {
        const threshold = Number(config.threshold ?? 80);
        if (typeof event.score !== 'number' || event.score >= threshold) continue;
      }
      if (trigger === 'experiment.failed' && event.status && event.status !== 'error' && event.status !== 'timeout') continue;
      if (trigger === 'pipeline.completed' && config.documentId && config.documentId !== event.documentId) continue;
      if (trigger === 'reference.created' && config.referenceId && config.referenceId !== event.referenceId) continue;
      await this.run(row, event);
    }
  }

  private async run(row: typeof agentSchedules.$inferSelect, event: AutomationEvent) {
    const eventLine = [event.title, event.error, event.score !== undefined ? `得分 ${event.score}` : ''].filter(Boolean).join(' · ');
    const message = `${row.message}${eventLine ? `\n\n触发事件：${eventLine}` : ''}`;
    let status = 'ok';
    try {
      this.background.start({
        projectId: row.projectId,
        message,
        sessionKey: row.sessionKey || 'automation',
        model: row.model || undefined,
      });
    } catch (e: unknown) {
      status = 'error';
      this.logger.warn(`事件自动化入队失败：${e instanceof Error ? e.message : String(e)}`);
    }
    db.update(agentSchedules).set({ lastRunAt: Date.now(), lastStatus: status, updatedAt: Date.now() })
      .where(eq(agentSchedules.id, row.id)).run();
    await this.notifications.notify({
      projectId: row.projectId,
      kind: 'automation',
      title: `${row.name} · ${status === 'ok' ? '事件触发' : '入队失败'}`,
      body: eventLine || '事件已触发',
      link: `/dashboard?automation=${row.id}`,
      channels: channelsOf(row.notifyChannels),
      webhookUrl: row.notifyTarget || '',
      dedupeKey: `event:${row.id}:${event.documentId || event.referenceId || event.experimentId || ''}:${Math.floor(Date.now() / 60000)}`,
    }).catch(() => undefined);
  }
}
