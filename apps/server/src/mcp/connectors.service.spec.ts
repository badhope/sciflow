import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { ConnectorsService } from './connectors.service';

const PROJ = 'test-connector-001';
const svc = new ConnectorsService({} as never, {} as never);

function cleanup() {
  for (const key of ['zotero', 'feishu', 'notion', 'drive', 'overleaf']) {
    db.delete(appSettings).where(eq(appSettings.key, `connector:${key}:${PROJ}`)).run();
    db.delete(appSettings).where(eq(appSettings.key, `connector-status:${key}:${PROJ}`)).run();
  }
}

afterEach(cleanup);

describe('ConnectorsService', () => {
  it('目录固定 5 个官方连接器且未连接时为空', () => {
    cleanup();
    const list = svc.list(PROJ);
    expect(list.map((c) => c.key)).toEqual(['zotero', 'feishu', 'notion', 'drive', 'overleaf']);
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
    expect(() => svc.connect('notion', PROJ, {})).toThrow('至少填写');
    svc.connect('notion', PROJ, { token: 'ntn_x' });
    svc.disconnect('notion', PROJ);
    expect(svc.list(PROJ).find((c) => c.key === 'notion')?.connected).toBe(false);
  });

  it('未配置凭据时 test 直接报错，不发起外网请求', async () => {
    await expect(svc.test('drive', PROJ)).rejects.toThrow('尚未配置凭据');
  });
});
