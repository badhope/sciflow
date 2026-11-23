import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { safeOutboundFetch } from '../common/safe-outbound';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { encryptSecret, decryptSecret } from '../common/secret-crypto';
import { ReferencesService } from '../references/references.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { assertWebhookUrl } from '../schedule/notification.service';

export type ConnectorKey = 'zotero' | 'feishu';

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export const CONNECTORS: { key: ConnectorKey; name: string; type: 'api' | 'sdk'; description: string; fields: ConnectorField[] }[] = [
  {
    key: 'zotero', name: 'Zotero', type: 'api', description: 'Zotero Web API 同步文献库到证据库（按标题指纹去重）',
    fields: [
      { key: 'libraryId', label: '用户 ID 或群组 ID', placeholder: '例如 4758492' },
      { key: 'libraryType', label: '库类型（user / group）', placeholder: 'user' },
      { key: 'apiKey', label: 'Zotero API Key（公开库可留空）', secret: true },
    ],
  },
  {
    key: 'feishu', name: '飞书', type: 'sdk', description: '自定义机器人 Webhook 或官方应用：真实发通知、导入云文档',
    fields: [
      { key: 'webhookUrl', label: '自定义机器人 Webhook（推荐；填了即走 Webhook）', secret: true, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…' },
      { key: 'appId', label: 'App ID（应用模式可选）', placeholder: 'cli_xxx' },
      { key: 'appSecret', label: 'App Secret（应用模式可选）', secret: true },
      { key: 'receiveId', label: '通知接收人 open_id（应用模式可选）', placeholder: 'ou_xxx' },
    ],
  },
];

interface StoredConfig { [k: string]: string }

@Injectable()
export class ConnectorsService {
  constructor(private readonly references: ReferencesService, private readonly knowledge: KnowledgeService) {}

  private settingKey(key: ConnectorKey, projectId: string) { return `connector:${key}:${projectId}`; }
  private statusKey(key: ConnectorKey, projectId: string) { return `connector-status:${key}:${projectId}`; }

  private readConfig(key: ConnectorKey, projectId: string): StoredConfig | null {
    const row = db.select().from(appSettings).where(eq(appSettings.key, this.settingKey(key, projectId))).get();
    if (!row?.value) return null;
    try { return JSON.parse(decryptSecret(row.value)) as StoredConfig; } catch { return null; }
  }

  private readStatus(key: ConnectorKey, projectId: string) {
    const row = db.select().from(appSettings).where(eq(appSettings.key, this.statusKey(key, projectId))).get();
    if (!row?.value) return null;
    try { return JSON.parse(row.value) as { ok: boolean; message: string; checkedAt: number }; } catch { return null; }
  }

  private writeStatus(key: ConnectorKey, projectId: string, ok: boolean, message: string) {
    const value = JSON.stringify({ ok, message: message.slice(0, 300), checkedAt: Date.now() });
    db.insert(appSettings).values({ key: this.statusKey(key, projectId), value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } }).run();
  }

  /** 目录只暴露字段名与连接状态，绝不返回 secret。 */
  list(projectId: string) {
    return CONNECTORS.map((c) => {
      const config = this.readConfig(c.key, projectId);
      return {
        key: c.key, name: c.name, type: c.type, description: c.description, fields: c.fields,
        connected: !!config,
        masked: config ? Object.fromEntries(c.fields.map((f) => [f.key, config[f.key] ? (f.secret ? '••••••' : config[f.key]) : ''])) : {},
        status: this.readStatus(c.key, projectId),
      };
    });
  }

  connect(key: ConnectorKey, projectId: string, config: StoredConfig) {
    const spec = CONNECTORS.find((c) => c.key === key);
    if (!spec) throw new NotFoundException('连接器不存在');
    const clean: StoredConfig = {};
    for (const f of spec.fields) {
      const v = String(config[f.key] || '').trim();
      if (v) clean[f.key] = v.slice(0, 20_000);
    }
    if (!Object.keys(clean).length) throw new BadRequestException('请至少填写一个凭据字段');
    const encrypted = encryptSecret(JSON.stringify(clean));
    db.insert(appSettings).values({ key: this.settingKey(key, projectId), value: encrypted })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: encrypted } }).run();
    return { connected: true, key };
  }

  disconnect(key: ConnectorKey, projectId: string) {
    db.delete(appSettings).where(eq(appSettings.key, this.settingKey(key, projectId))).run();
    db.delete(appSettings).where(eq(appSettings.key, this.statusKey(key, projectId))).run();
    return { connected: false, key };
  }

  async test(key: ConnectorKey, projectId: string) {
    const config = this.requireConfig(key, projectId);
    try {
      const message = await this.check(key, config);
      this.writeStatus(key, projectId, true, message);
      return { ok: true, message };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.writeStatus(key, projectId, false, message);
      return { ok: false, message };
    }
  }

  private requireConfig(key: ConnectorKey, projectId: string): StoredConfig {
    const config = this.readConfig(key, projectId);
    if (!config) throw new BadRequestException('连接器尚未配置凭据');
    return config;
  }

  private async check(key: ConnectorKey, c: StoredConfig): Promise<string> {
    if (key === 'zotero') {
      const headers: Record<string, string> = { 'Zotero-API-Version': '3' };
      if (c.apiKey) headers['Zotero-API-Key'] = c.apiKey;
      const res = await safeOutboundFetch(`https://api.zotero.org/${c.libraryType === 'group' ? 'groups' : 'users'}/${encodeURIComponent(c.libraryId)}/items/top?limit=1&format=json`, { headers });
      if (!res.ok) throw new Error(`Zotero ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const total = res.headers.get('total-results');
      return `Zotero 连接正常${total ? `，库内 ${total} 条` : ''}`;
    }
    if (key === 'feishu') {
      if (c.webhookUrl) {
        const sent = await this.postFeishuWebhook(c.webhookUrl, `SciFlow 连接测试：飞书 Webhook 已连通（${new Date().toLocaleString('zh-CN', { hour12: false })}）`);
        return `飞书 Webhook 发送成功（${sent}）`;
      }
      if (!c.appId || !c.appSecret) throw new Error('未配置飞书 Webhook 或应用凭据');
      const lark = await import('@larksuiteoapi/node-sdk');
      const client = new lark.Client({ appId: c.appId, appSecret: c.appSecret, appType: lark.AppType.SelfBuild, domain: lark.Domain.Feishu });
      // 必须真的换到 tenant_access_token，不能只证明 SDK 能 import。
      const auth = client as unknown as {
        auth: { tenantAccessToken: { internal: (p: { data: { app_id: string; app_secret: string } }) => Promise<{ code?: number; msg?: string; data?: { tenant_access_token?: string } }> } };
      };
      const res = await auth.auth.tenantAccessToken.internal({ data: { app_id: c.appId || '', app_secret: c.appSecret || '' } });
      if (res.code && res.code !== 0) throw new Error(`飞书鉴权失败：${res.msg || res.code}`);
      if (!res.data?.tenant_access_token) throw new Error('飞书鉴权未返回 tenant_access_token');
      return '飞书应用凭据有效，tenant_access_token 已获取';
    }
    throw new BadRequestException('未知连接器');
  }

  /** Zotero 前 N 条顶层条目 → 证据库；返回新增/重复/跳过。 */
  async importZotero(projectId: string, limit = 10) {
    const c = this.requireConfig('zotero', projectId);
    const max = Math.min(100, Math.max(1, Math.floor(limit)));
    const headers: Record<string, string> = { 'Zotero-API-Version': '3' };
    if (c.apiKey) headers['Zotero-API-Key'] = c.apiKey;
    const res = await safeOutboundFetch(`https://api.zotero.org/${c.libraryType === 'group' ? 'groups' : 'users'}/${encodeURIComponent(c.libraryId)}/items/top?limit=${max}&format=json`, { headers });
    if (!res.ok) throw new BadRequestException(`Zotero 拉取失败（${res.status}）：${(await res.text()).slice(0, 160)}`);
    const rows = await res.json() as { data?: Record<string, unknown> }[];
    let added = 0; let duplicate = 0; let skipped = 0;
    for (const raw of rows) {
      const data = raw?.data || {};
      const itemType = String(data.itemType || '');
      if (['attachment', 'note', 'annotation'].includes(itemType)) { skipped += 1; continue; }
      const title = String(data.title || '').trim();
      if (!title) { skipped += 1; continue; }
      const creators = Array.isArray(data.creators) ? data.creators as { firstName?: string; lastName?: string; name?: string }[] : [];
      const authors = creators.map((a) => a.name || [a.firstName, a.lastName].filter(Boolean).join(' ')).filter(Boolean);
      const year = Number(String(data.date || '').match(/\d{4}/)?.[0] || 0) || null;
      try {
        const created = this.references.create(projectId, {
          title,
          authors,
          year,
          venue: String(data.publicationTitle || data.proceedingsTitle || data.bookTitle || ''),
          doi: String(data.DOI || ''),
          url: String(data.url || ''),
          abstract: String(data.abstractNote || ''),
          source: 'scholar',
        });
        if (created.isDuplicateOf) duplicate += 1; else added += 1;
      } catch { skipped += 1; }
    }
    this.writeStatus('zotero', projectId, true, `导入 ${added} 条，重复 ${duplicate}，跳过 ${skipped}`);
    return { fetched: rows.length, added, duplicate, skipped };
  }

  /** 飞书自定义机器人：只走官方域名白名单，返回可审计的 code。 */
  private async postFeishuWebhook(rawUrl: string, text: string): Promise<string> {
    const url = assertWebhookUrl(rawUrl);
    const res = await safeOutboundFetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`飞书 Webhook HTTP ${res.status}：${body.slice(0, 120)}`);
    let parsed: { code?: number; StatusCode?: number; msg?: string; StatusMessage?: string } = {};
    try { parsed = JSON.parse(body) as typeof parsed; } catch { throw new Error(`飞书 Webhook 返回非 JSON：${body.slice(0, 120)}`); }
    const code = parsed.code ?? parsed.StatusCode;
    if (code !== undefined && code !== 0) throw new Error(`飞书 Webhook 返回 code=${code} ${parsed.msg || parsed.StatusMessage || ''}`.trim());
    return code === 0 ? 'code=0' : 'HTTP 2xx';
  }

  async feishuNotify(projectId: string, text: string) {
    const c = this.requireConfig('feishu', projectId);
    if (c.webhookUrl) {
      await this.postFeishuWebhook(c.webhookUrl, text.slice(0, 2000));
      this.writeStatus('feishu', projectId, true, 'Webhook 通知发送成功');
      return { ok: true };
    }
    if (!c.receiveId) throw new BadRequestException('未配置 receiveId（open_id），也未配置 Webhook');
    const lark = await import('@larksuiteoapi/node-sdk');
    const client = new lark.Client({ appId: c.appId, appSecret: c.appSecret, appType: lark.AppType.SelfBuild, domain: lark.Domain.Feishu });
    try {
      await (client as unknown as { im: { message: { create: (o: unknown) => Promise<unknown> } } }).im.message.create({
        params: { receive_id_type: 'open_id' },
        data: { receive_id: c.receiveId, msg_type: 'text', content: JSON.stringify({ text: text.slice(0, 2000) }) },
      });
      this.writeStatus('feishu', projectId, true, '通知发送成功');
      return { ok: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      this.writeStatus('feishu', projectId, false, message);
      throw new BadRequestException(`飞书发送失败：${message}`);
    }
  }

  async feishuImportDoc(projectId: string, documentId: string) {
    const c = this.requireConfig('feishu', projectId);
    if (!c.appId || !c.appSecret) throw new BadRequestException('导入云文档需要飞书应用 App ID / App Secret；Webhook 只用于通知');
    const lark = await import('@larksuiteoapi/node-sdk');
    const client = new lark.Client({ appId: c.appId, appSecret: c.appSecret, appType: lark.AppType.SelfBuild, domain: lark.Domain.Feishu });
    type LarkRaw = { code?: number; msg?: string; data?: { content?: string } };
    const res = await (client as unknown as { request: (o: { method: string; url: string }) => Promise<LarkRaw> }).request({
      method: 'GET', url: `/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/raw_content`,
    });
    if (res.code && res.code !== 0) throw new BadRequestException(`飞书文档读取失败：${res.msg || res.code}`);
    const text = String(res.data?.content || '').trim();
    if (!text) throw new BadRequestException('飞书文档正文为空');
    const doc = await this.knowledge.uploadText(projectId, `飞书文档 ${documentId}`, 'text', text);
    this.writeStatus('feishu', projectId, true, `已导入飞书文档 ${documentId}`);
    return { doc };
  }

}
