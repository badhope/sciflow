import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { agentNotifications, projects } from '../db/schema';
import { assertWebhookUrl, NotificationService } from './notification.service';

const PROJ = 'test-notify-001';
const svc = new NotificationService();

function cleanup() {
  db.delete(agentNotifications).where(eq(agentNotifications.projectId, PROJ)).run();
  db.delete(projects).where(eq(projects.id, PROJ)).run();
}

describe('assertWebhookUrl', () => {
  it('只允许 HTTPS 飞书官方域名', () => {
    expect(assertWebhookUrl('https://open.feishu.cn/open-apis/bot/v2/hook/x').hostname).toBe('open.feishu.cn');
    expect(() => assertWebhookUrl('http://open.feishu.cn/x')).toThrow('HTTPS');
    expect(() => assertWebhookUrl('https://evil.example.com/x')).toThrow('白名单');
    expect(() => assertWebhookUrl('https://user:pass@open.feishu.cn/x')).toThrow('内嵌');
    expect(() => assertWebhookUrl('not-a-url')).toThrow('合法 URL');
  });
});

describe('NotificationService', () => {
  beforeEach(() => {
    cleanup();
    const now = Date.now();
    db.insert(projects).values({ id: PROJ, name: '通知测试', createdAt: now, updatedAt: now }).run();
  });
  afterEach(cleanup);

  it('同一 dedupeKey 只入库一次', () => {
    const a = svc.createInApp({ projectId: PROJ, kind: 'automation', title: '任务完成', dedupeKey: 'k1' });
    const b = svc.createInApp({ projectId: PROJ, kind: 'automation', title: '重复', dedupeKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(svc.list(PROJ)).toHaveLength(1);
  });

  it('站内通知读写与未读计数', () => {
    svc.createInApp({ projectId: PROJ, kind: 'system', title: 'a' });
    svc.createInApp({ projectId: PROJ, kind: 'system', title: 'b' });
    expect(svc.unreadCount(PROJ)).toBe(2);
    const first = svc.list(PROJ)[0];
    svc.markRead(first.id, PROJ);
    expect(svc.unreadCount(PROJ)).toBe(1);
    svc.markAllRead(PROJ);
    expect(svc.unreadCount(PROJ)).toBe(0);
    expect(() => svc.markRead(first.id, 'other')).toThrow('通知不存在');
  });

  it('飞书失败降级为站内系统通知，不抛出', async () => {
    const out = await svc.notify({
      projectId: PROJ, kind: 'automation', title: '每周综述', channels: ['inapp', 'feishu'],
      webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/not-real', dedupeKey: 'weekly',
    });
    expect(out.projectId).toBe(PROJ);
    const rows = svc.list(PROJ);
    expect(rows.some((r) => r.title.startsWith('飞书通知失败'))).toBe(true);
  });
});
