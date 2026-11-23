import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { agentNotifications, agentSchedules } from '../db/schema';
import { safeOutboundFetch } from '../common/safe-outbound';

export type NotificationChannel = 'inapp' | 'browser' | 'feishu';

export interface NotifyInput {
  projectId: string;
  kind: 'task' | 'approval' | 'automation' | 'quality' | 'system';
  title: string;
  body?: string;
  link?: string;
  channels?: NotificationChannel[];
  webhookUrl?: string;
  dedupeKey?: string;
}

const FEISHU_HOSTS = new Set(
  (process.env.FEISHU_WEBHOOK_HOSTS || 'open.feishu.cn,open.larksuite.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);

/** 只允许飞书官方 Webhook 域名；协议固定 HTTPS；拒绝内嵌凭据与私网。 */
export function assertWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('飞书 Webhook 不是合法 URL');
  }
  if (url.protocol !== 'https:') throw new BadRequestException('飞书 Webhook 必须使用 HTTPS');
  if (url.username || url.password) throw new BadRequestException('Webhook 不允许内嵌用户名/密码');
  if (!FEISHU_HOSTS.has(url.hostname.toLowerCase())) {
    throw new BadRequestException(`Webhook 域名不在白名单：${url.hostname}（允许 ${[...FEISHU_HOSTS].join('、')}）`);
  }
  return url;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  list(projectId: string, limit = 30) {
    return db.select().from(agentNotifications)
      .where(eq(agentNotifications.projectId, projectId))
      .orderBy(desc(agentNotifications.createdAt))
      .limit(Math.max(1, Math.min(100, limit))).all();
  }

  unreadCount(projectId: string): number {
    return db.select().from(agentNotifications)
      .where(and(eq(agentNotifications.projectId, projectId), eq(agentNotifications.read, 0)))
      .all().length;
  }

  markRead(id: string, projectId: string) {
    const row = db.select().from(agentNotifications).where(eq(agentNotifications.id, id)).get();
    if (!row || row.projectId !== projectId) throw new NotFoundException('通知不存在');
    db.update(agentNotifications).set({ read: 1 }).where(eq(agentNotifications.id, id)).run();
    return { ok: true };
  }

  markAllRead(projectId: string) {
    db.update(agentNotifications).set({ read: 1 })
      .where(and(eq(agentNotifications.projectId, projectId), eq(agentNotifications.read, 0))).run();
    return { ok: true };
  }

  /** 站内通知幂等入库：同一 dedupeKey 只保留首条，重复事件不刷屏。 */
  createInApp(input: NotifyInput) {
    const dedupeKey = input.dedupeKey || '';
    if (dedupeKey) {
      const exists = db.select().from(agentNotifications)
        .where(and(eq(agentNotifications.projectId, input.projectId), eq(agentNotifications.dedupeKey, dedupeKey))).get();
      if (exists) return exists;
    }
    const row = {
      id: randomUUID(),
      projectId: input.projectId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: (input.body || '').slice(0, 2000),
      link: input.link || '',
      read: 0,
      dedupeKey,
      createdAt: Date.now(),
    };
    db.insert(agentNotifications).values(row).run();
    return row;
  }

  async notify(input: NotifyInput) {
    const channels = input.channels?.length ? input.channels : ['inapp' as const];
    let notification = this.createInApp(input);
    if (channels.includes('feishu') && input.webhookUrl) {
      try {
        assertWebhookUrl(input.webhookUrl);
        const res = await safeOutboundFetch(input.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msg_type: 'text',
            content: { text: `${input.title}${input.body ? `\n${input.body}` : ''}` },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(`飞书通知失败：${message}`);
        notification = this.createInApp({
          ...input,
          kind: 'system',
          title: `飞书通知失败：${input.title}`,
          body: message,
          dedupeKey: `feishu-failed:${input.dedupeKey || notification.id}`,
        });
      }
    }
    return notification;
  }

  /** 通知重试：按 link 找到对应自动化配置，重发飞书；失败仍留在收件箱。 */
  async retry(id: string, projectId: string) {
    const row = db.select().from(agentNotifications).where(eq(agentNotifications.id, id)).get();
    if (!row || row.projectId !== projectId) throw new NotFoundException('通知不存在');
    if (!row.link?.startsWith('/dashboard?automation=')) throw new BadRequestException('这条通知没有可重试的投递目标');
    const scheduleId = row.link.split('automation=')[1];
    const schedule = db.select().from(agentSchedules).where(eq(agentSchedules.id, scheduleId)).get();
    if (!schedule || schedule.projectId !== projectId) throw new NotFoundException('自动化配置不存在');
    const channels = JSON.parse(schedule.notifyChannels || '["inapp"]') as NotificationChannel[];
    await this.notify({
      projectId,
      kind: 'automation',
      title: `重试：${schedule.name}`,
      body: row.body || '',
      channels,
      webhookUrl: schedule.notifyTarget || '',
      dedupeKey: `retry:${id}:${Date.now()}`,
    });
    return { ok: true };
  }
}
