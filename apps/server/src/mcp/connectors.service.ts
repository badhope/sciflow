import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createRequire } from 'node:module';
import { safeOutboundFetch } from '../common/safe-outbound';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { encryptSecret, decryptSecret } from '../common/secret-crypto';
import { ReferencesService } from '../references/references.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

export type ConnectorKey = 'zotero' | 'feishu' | 'notion' | 'drive' | 'overleaf';

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export const CONNECTORS: { key: ConnectorKey; name: string; type: 'api' | 'sdk' | 'git'; description: string; fields: ConnectorField[] }[] = [
  {
    key: 'zotero', name: 'Zotero', type: 'api', description: 'Zotero Web API 同步文献库到证据库（按标题指纹去重）',
    fields: [
      { key: 'libraryId', label: '用户 ID 或群组 ID', placeholder: '例如 4758492' },
      { key: 'libraryType', label: '库类型（user / group）', placeholder: 'user' },
      { key: 'apiKey', label: 'Zotero API Key', secret: true },
    ],
  },
  {
    key: 'feishu', name: '飞书', type: 'sdk', description: '官方 Node SDK：发机器人通知、导入云文档到知识库',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'cli_xxx' },
      { key: 'appSecret', label: 'App Secret', secret: true },
      { key: 'receiveId', label: '通知接收人 open_id（可选）', placeholder: 'ou_xxx' },
    ],
  },
  { key: 'notion', name: 'Notion', type: 'sdk', description: '官方 SDK：验证令牌并搜索页面/数据库', fields: [{ key: 'token', label: 'Integration Token', secret: true }] },
  {
    key: 'drive', name: 'Google Drive', type: 'sdk', description: '官方 googleapis：只读列出/导入 Drive 文档',
    fields: [{ key: 'serviceAccount', label: 'Service Account JSON', secret: true, placeholder: '{"type":"service_account",…}' }],
  },
  {
    key: 'overleaf', name: 'Overleaf', type: 'git', description: '官方 Git 集成：检测仓库可达（不爬网页）',
    fields: [
      { key: 'gitUrl', label: 'Git URL', placeholder: 'https://git.overleaf.com/xxxx' },
      { key: 'token', label: 'Git Token（可选）', secret: true },
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
      const res = await safeOutboundFetch(`https://api.zotero.org/${c.libraryType === 'group' ? 'groups' : 'users'}/${encodeURIComponent(c.libraryId)}/items/top?limit=1&format=json`, { headers: { 'Zotero-API-Key': c.apiKey, 'Zotero-API-Version': '3' } });
      if (!res.ok) throw new Error(`Zotero ${res.status}: ${(await res.text()).slice(0, 120)}`);
      const total = res.headers.get('total-results');
      return `Zotero 连接正常${total ? `，库内 ${total} 条` : ''}`;
    }
    if (key === 'feishu') {
      const lark = await import('@larksuiteoapi/node-sdk');
      const client = new lark.Client({ appId: c.appId, appSecret: c.appSecret, appType: lark.AppType.SelfBuild, domain: lark.Domain.Feishu });
      const res = await (client as unknown as { request: (o: { method: string; url: string }) => Promise<unknown> }).request({ method: 'GET', url: '/open-apis/tenant/tenant_access_token/internal' }).catch(() => null);
      void res;
      return '飞书 SDK 已加载（发送/导入时校验租户令牌）';
    }
    if (key === 'notion') {
      const { Client } = await import('@notionhq/client');
      const notion = new Client({ auth: c.token });
      const me = await notion.users.me({});
      return `Notion 连接正常：${'name' in me && me.name ? me.name : me.type}`;
    }
    if (key === 'drive') {
      const { google } = loadGoogleApis();
      const creds = JSON.parse(c.serviceAccount) as { client_email?: string; private_key?: string };
      if (!creds.client_email || !creds.private_key) throw new Error('Service Account JSON 缺少 client_email/private_key');
      const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
      const drive = google.drive({ version: 'v3', auth });
      const res = await drive.files.list({ pageSize: 1, fields: 'files(id,name)' });
      return `Drive 连接正常，可见 ${res.data.files?.length ?? 0} 个文件（抽样）`;
    }
    if (key === 'overleaf') {
      const url = c.gitUrl.replace(/^https:\/\//, c.token ? `https://${encodeURIComponent('git')}:${encodeURIComponent(c.token)}@` : 'https://');
      const res = await safeOutboundFetch(url, { method: 'HEAD' });
      if (!res.ok) throw new Error(`Overleaf Git ${res.status}`);
      return 'Overleaf Git 仓库可达';
    }
    throw new BadRequestException('未知连接器');
  }

  /** Zotero 前 N 条顶层条目 → 证据库；返回新增/重复/跳过。 */
  async importZotero(projectId: string, limit = 10) {
    const c = this.requireConfig('zotero', projectId);
    const max = Math.min(100, Math.max(1, Math.floor(limit)));
    const res = await safeOutboundFetch(`https://api.zotero.org/${c.libraryType === 'group' ? 'groups' : 'users'}/${encodeURIComponent(c.libraryId)}/items/top?limit=${max}&format=json`, { headers: { 'Zotero-API-Key': c.apiKey, 'Zotero-API-Version': '3' } });
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

  async feishuNotify(projectId: string, text: string) {
    const c = this.requireConfig('feishu', projectId);
    if (!c.receiveId) throw new BadRequestException('未配置 receiveId（open_id）');
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

  async notionSearch(projectId: string, query: string) {
    const c = this.requireConfig('notion', projectId);
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: c.token });
    const res = await notion.search({ query: query.slice(0, 100), page_size: 20 });
    return { results: res.results.map((r) => ({ id: r.id, type: r.object, title: r.object === 'page' ? pageTitle(r) : '' })) };
  }

  async driveList(projectId: string) {
    const c = this.requireConfig('drive', projectId);
    const { google } = loadGoogleApis();
    const creds = JSON.parse(c.serviceAccount) as { client_email: string; private_key: string };
    const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
    const drive = google.drive({ version: 'v3', auth });
    const res = await drive.files.list({ pageSize: 20, fields: 'files(id,name,mimeType,modifiedTime)' });
    return { files: res.data.files ?? [] };
  }
}

type GoogleApis = {
  google: {
    auth: { JWT: new (o: { email: string; key: string; scopes: string[] }) => unknown };
    drive: (o: { version: string; auth: unknown }) => { files: { list: (o: Record<string, unknown>) => Promise<{ data: { files?: { id?: string | null; name?: string | null; mimeType?: string | null }[] } }> } };
  };
};

/** googleapis 类型图极大（会拖垮 tsc 内存），运行时按需加载，不参与类型解析。 */
function loadGoogleApis(): GoogleApis {
  return createRequire(__filename)('googleapis') as GoogleApis;
}

function pageTitle(r: unknown): string {
  const page = r as { properties?: Record<string, { title?: { plain_text?: string }[] }> };
  const prop = page.properties?.title || page.properties?.Name;
  return prop?.title?.map((t) => t.plain_text || '').join('') || '';
}
