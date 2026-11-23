import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { ConnectorsService } from './connectors.service';

const PROJ = 'test-connector-001';
const svc = new ConnectorsService({} as never, {} as never);

function cleanup() {
  for (const key of ['zotero', 'feishu']) {
    db.delete(appSettings).where(eq(appSettings.key, `connector:${key}:${PROJ}`)).run();
    db.delete(appSettings).where(eq(appSettings.key, `connector-status:${key}:${PROJ}`)).run();
  }
}

afterEach(cleanup);

describe('ConnectorsService', () => {
  it('目录固定 2 个国内优先连接器且未连接时为空', () => {
    cleanup();
    const list = svc.list(PROJ);
    expect(list.map((c) => c.key)).toEqual(['zotero', 'feishu']);
    expect(list.every((c) => !c.connected)).toBe(true);
    expect(list.find((c) => c.key === 'feishu')?.type).toBe('sdk');
  });

  it('连接后只回传脱敏字段，密文落库不含明文', () => {
    svc.connect('zotero', PROJ, { libraryId: '12345', libraryType: 'user', apiKey: 'super-secret-key' });
    const item = svc.list(PROJ).find((c) => c.key === 'zotero')!;
    expect(item.connected).toBe(true);
    expect(item.masked.apiKey).toBe('••••••');
    expect(item.masked.libraryId).toBe('12345');
    const raw = db.select().from(appSettings).where(eq(appSettings.key, `connector:zotero:${PROJ}`)).get()!;
    expect(raw.value).not.toContain('super-secret-key');
    expect(JSON.stringify(item)).not.toContain('super-secret-key');
  });

  it('空凭据拒绝，断开后状态清空', () => {
    expect(() => svc.connect('feishu', PROJ, {})).toThrow('至少填写');
    svc.connect('feishu', PROJ, { appId: 'cli_x', appSecret: 'secret_x' });
    svc.disconnect('feishu', PROJ);
    expect(svc.list(PROJ).find((c) => c.key === 'feishu')?.connected).toBe(false);
  });

  it('未配置凭据时 test 直接报错，不发起外网请求', async () => {
    await expect(svc.test('feishu', PROJ)).rejects.toThrow('尚未配置凭据');
  });

  it('飞书 Webhook 只允许官方 HTTPS 域名，非法 URL 在发请求前被拒绝', async () => {
    svc.connect('feishu', PROJ, { webhookUrl: 'http://127.0.0.1:9999/hook' });
    const r = await svc.test('feishu', PROJ);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('HTTPS');
  });
});
