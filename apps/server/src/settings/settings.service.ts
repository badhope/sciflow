import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiService } from '../ai/ai.service';
import { DB_PATH, sqlite, vecLoaded } from '../db/database';
import { encryptSecret, decryptSecret } from '../common/secret-crypto';
import { allowPrivateOutbound, checkOutboundUrl } from '../common/outbound-guard';
import { fetchModelCatalog, normalizeProtocol, type DiscoveredModel } from '../common/model-catalog';
import { EmbeddingService } from '../knowledge/embedding.service';

export interface AppSettings {
  ai: {
    baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean; models: string[];
    protocol: string; contextWindow: number; maxOutput: number; toolCalling: boolean;
  };
  env: { node: string; database: string; port: number };
  sources: { literature: string[] };
}

// 零内置：无可用模型列表时不伪造占位模型，前端按「未配置」引导用户自填
const FALLBACK_MODELS: string[] = [];

/** 模型列表 TTL 缓存：避免每次进设置页都实时请求网关（5 分钟内复用） */
const MODELS_TTL_MS = 5 * 60 * 1000;

/**
 * API Key 掩码：列表/详情接口回显时绝不返回明文。
 *  - sk- 开头的 key：保留 "sk-" 前缀 + "****" + 尾4，如 sk-abcd…wxyz → sk-****wxyz
 *  - 其他 key：等长星号掩码，仅保留尾4（等长便于前端判断"已配置"且不泄露长度语义之外的内容）
 *  - 空值原样返回空串
 */
function maskApiKey(key: unknown): string {
  const k = String(key ?? '');
  if (!k) return '';
  const tail = k.slice(-4);
  if (k.startsWith('sk-')) return `sk-****${tail}`;
  return '*'.repeat(Math.max(k.length - 4, 0)) + tail;
}

/** 判断提交上来的 apiKey 是否为列表接口下发的掩码回显（含 * 即视为掩码，真实 LLM key 不含星号） */
function isMaskedKey(key: string): boolean {
  return key.includes('*');
}

/** 上下文窗口 / 最大输出钳制：0=未知；最大输出不得超过上下文窗口 */
function normalizeCapabilities(contextWindow: unknown, maxOutput: unknown): { contextWindow: number; maxOutput: number } {
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const cw = num(contextWindow);
  const mo = num(maxOutput);
  return { contextWindow: cw, maxOutput: cw > 0 && mo > cw ? cw : mo };
}

/** 模型目录落库前裁剪：只保留必要字段、限制条数，防止异常载荷撑爆单行 */
function sanitizeModels(raw: unknown): DiscoveredModel[] {
  if (!Array.isArray(raw)) return [];
  const out: DiscoveredModel[] = [];
  for (const item of raw.slice(0, 200)) {
    const m = item as Record<string, unknown> | null;
    const id = typeof m?.['id'] === 'string' ? m['id'].trim() : '';
    if (!id) continue;
    const num = (v: unknown): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
    };
    out.push({
      id,
      displayName: typeof m?.['displayName'] === 'string' ? String(m['displayName']) : undefined,
      contextWindow: num(m?.['contextWindow']),
      maxOutput: num(m?.['maxOutput']),
      toolCalling: m?.['toolCalling'] === false ? false : true,
    });
  }
  return out;
}

/** 模型目录 JSON 回读：损坏/空值一律回落 []，不让设置页因脏数据崩溃 */
function parseModelsJson(raw: unknown): DiscoveredModel[] {
  if (Array.isArray(raw)) return raw as DiscoveredModel[];
  const text = String(raw ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as DiscoveredModel[]) : [];
  } catch {
    return [];
  }
}

@Injectable()
export class SettingsService {
  private modelsCache: { at: number; models: string[] } | null = null;

  constructor(
    private readonly ai: AiService,
    private readonly embedding: EmbeddingService,
  ) {}

  async getSettings(): Promise<AppSettings> {
    let models: string[] = [];
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_TTL_MS) {
      models = this.modelsCache.models;
    } else {
      try {
        models = await this.ai.listModels();
        this.modelsCache = { at: Date.now(), models };
      } catch {
        /* 忽略 */
      }
    }
    if (models.length === 0) models = FALLBACK_MODELS;
    const cfg = this.ai.config;
    return {
      ai: { ...cfg, models },
      env: {
        node: process.version,
        database: DB_PATH,
        port: Number(process.env.PORT || 3000),
      },
      sources: { literature: ['本地文献库（手动添加 / 项目导入）'] },
    };
  }

  /** 连接自检：数据库读写 + AI 连通性 */
  async selfCheck() {
    const dbOk = (() => {
      try {
        sqlite.prepare('SELECT 1 AS ok').get();
        return true;
      } catch {
        return false;
      }
    })();
    const aiTest = await this.ai.testConnection();
    // 检索栈能力：向量扩展 / 嵌入模型 / 全文索引，逐项给出「可用 or 降级原因 + 修复指引」
    const retrieval = (() => {
      const vector = vecLoaded;
      const emb = this.embedding.status();
      const model = emb.backend !== 'none';
      const fts = (() => {
        try {
          sqlite.prepare("SELECT rowid FROM knowledge_chunk_fts LIMIT 1").get();
          return true;
        } catch {
          return false;
        }
      })();
      const notes: string[] = [];
      if (!vector) notes.push('sqlite-vec 扩展未加载：向量检索将降级为全文检索（排查 SCIFLOW_NO_VEC / 原生扩展兼容性）');
      if (!model) {
        notes.push(
          '嵌入后端不可用：仅使用全文检索。可二选一启用语义检索——① 放置 384 维 GGUF（bge-small-zh-v1.5）并设 EMBEDDING_MODEL_PATH；② 已配置模型 Key 时设 EMBEDDING_PROVIDER=api 走厂商 /embeddings',
        );
      } else if (emb.backend === 'api') {
        notes.push('嵌入后端：远程 /embeddings（沿用当前模型厂商的 baseURL 与 Key），无需本地模型文件');
      } else {
        notes.push(`嵌入后端：本地 GGUF（${emb.modelPath}，${emb.dimension} 维）`);
      }
      if (!fts) notes.push('全文索引表不可用：检索会回退 LIKE 扫描，长文档下速度较慢');
      return { vector, embeddingModel: model, embeddingBackend: emb.backend, fullText: fts, ok: fts, notes };
    })();
    return {
      database: { ok: dbOk, path: DB_PATH },
      ai: { configured: this.ai.configured, ok: aiTest.ok, model: aiTest.model, latencyMs: aiTest.latencyMs, detail: aiTest.reply },
      retrieval,
      timestamp: Date.now(),
    };
  }

  /** 指定模型连接测试 */
  testModel(model: string) {
    return this.ai.testConnection(model);
  }

  // ---------- 模型厂商管理（LiteLLM 式多厂商） ----------
  /**
   * 列表接口：api_key 在 DB 中为密文（v0.3.0 起），先解密再掩码回传（sk-****尾4）。
   * 前端设置页仅用于展示厂商名/模型/BaseURL，无需明文 key；
   * 若用户要改 key，在输入框重新输入明文即可（留空/掩码回显=不修改原 key）。
   */
  listProviders() {
    const rows = sqlite
      .prepare(
        'SELECT id, name, base_url AS baseUrl, api_key AS apiKey, model, protocol, context_window AS contextWindow, '
        + 'max_output AS maxOutput, tool_calling AS toolCalling, models, is_active AS isActive, created_at AS createdAt '
        + 'FROM model_provider ORDER BY created_at',
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const masked = maskApiKey(decryptSecret(String((r as Record<string, unknown>)['apiKey'] ?? '')));
      return { ...r, ['apiKey']: masked, models: parseModelsJson(r['models']) };
    });
  }

  /** 保存厂商（新增/更新）：协议 + 能力列 + 检测到的模型目录 */
  saveProvider(body: {
    id?: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    protocol?: string;
    contextWindow?: number;
    maxOutput?: number;
    toolCalling?: number | boolean;
    models?: unknown;
  }) {
    if (!body?.name?.trim() || !body?.baseUrl?.trim() || !body?.model?.trim()) {
      throw new BadRequestException('厂商名称、Base URL、模型名不能为空');
    }
    if (!/^https?:\/\//.test(body.baseUrl.trim())) throw new BadRequestException('Base URL 需以 http:// 或 https:// 开头');
    const now = Date.now();
    const protocol = normalizeProtocol(body.protocol);
    const caps = normalizeCapabilities(body.contextWindow, body.maxOutput);
    const toolCalling = body.toolCalling === false || Number(body.toolCalling) === 0 ? 0 : 1;
    const modelsJson = JSON.stringify(sanitizeModels(body.models));
    if (body.id) {
      // 更新：若提交的 apiKey 为空或是掩码回显（含 *），保留 DB 原密文 key 不覆盖；
      // 只有用户输入了新的明文 key 才加密写回。防止掩码字符串被误存为真实 key。
      const existing = sqlite
        .prepare('SELECT api_key, is_active FROM model_provider WHERE id = ?')
        .get(body.id) as Record<string, string | number | undefined> | undefined;
      if (!existing) throw new NotFoundException('厂商不存在');
      const submitted = body.apiKey?.trim() ?? '';
      const finalKey = submitted && !isMaskedKey(submitted)
        ? encryptSecret(submitted)
        : String(existing['api_key'] ?? '');
      sqlite
        .prepare('UPDATE model_provider SET name=?, base_url=?, ' + 'api_key' + '=?, model=?, protocol=?, context_window=?, max_output=?, tool_calling=?, models=?, updated_at=? WHERE id=?')
        .run(body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), finalKey, body.model.trim(), protocol, caps.contextWindow, caps.maxOutput, toolCalling, modelsJson, now, body.id);
      // 编辑的是激活中的厂商 → 立即刷新运行中连接参数（否则页面显示新模型、实际还在打旧端点）
      if (Number(existing['is_active']) === 1) this.ai.switchProvider(body.id);
      return { ok: true, id: body.id };
    }
    const id = randomUUID();
    sqlite
      .prepare('INSERT INTO model_provider (id, name, base_url, ' + 'api_key' + ', model, protocol, context_window, max_output, tool_calling, models, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)')
      .run(id, body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), encryptSecret(body.apiKey?.trim() || ''), body.model.trim(), protocol, caps.contextWindow, caps.maxOutput, toolCalling, modelsJson, now, now);
    return { ok: true, id };
  }

  /**
   * 检测模型：用「表单里的地址 + Key」实时拉 /models（不落库）。
   * 编辑态 Key 为掩码回显时复用库内真实 Key（id 定位）；全部错误以 ok=false 返回，前端原地展示。
   */
  async discoverModels(body: {
    id?: string;
    baseUrl: string;
    apiKey?: string;
    protocol?: string;
    privateOk?: boolean;
  }): Promise<{ ok: boolean; models: DiscoveredModel[]; error?: string; endpoint?: string }> {
    const baseUrl = String(body?.baseUrl || '').trim();
    if (!baseUrl) return { ok: false, models: [], error: '请先填写 Base URL' };
    if (!/^https?:\/\//.test(baseUrl)) return { ok: false, models: [], error: 'Base URL 需以 http:// 或 https:// 开头' };
    const key = this.resolveFormKey(body.id, body.apiKey);
    // SSRF 守卫：内网/回环/云元数据地址默认拒绝（本地 Ollama 场景由调用方显式声明 privateOk，仍需 ALLOW_PRIVATE_OUTBOUND=1）
    const allowPrivate = body.privateOk === true || allowPrivateOutbound();
    const guard = await this.guardOutbound(baseUrl, allowPrivate);
    if (!guard.ok) return { ok: false, models: [], error: `地址被安全策略拒绝：${guard.reason}` };
    const r = await fetchModelCatalog({ baseUrl, apiKey: key, protocol: body.protocol });
    return { ok: r.ok, models: r.models, error: r.error, endpoint: r.endpoint };
  }

  /** 连接测试：用表单当前值发一条最小消息，不保存、不切换激活厂商 */
  async testProvider(body: {
    id?: string;
    baseUrl: string;
    apiKey?: string;
    protocol?: string;
    model: string;
    maxOutput?: number;
    privateOk?: boolean;
  }): Promise<{ ok: boolean; reply: string; model: string; latencyMs: number }> {
    const baseUrl = String(body?.baseUrl || '').trim();
    const model = String(body?.model || '').trim();
    if (!baseUrl) return { ok: false, reply: '请先填写 Base URL', model, latencyMs: 0 };
    if (!model) return { ok: false, reply: '请先选择或填写模型名', model, latencyMs: 0 };
    if (!/^https?:\/\//.test(baseUrl)) return { ok: false, reply: 'Base URL 需以 http:// 或 https:// 开头', model, latencyMs: 0 };
    const guard = await this.guardOutbound(baseUrl, body.privateOk === true || allowPrivateOutbound());
    if (!guard.ok) return { ok: false, reply: `地址被安全策略拒绝：${guard.reason}`, model, latencyMs: 0 };
    return this.ai.testProviderConfig({
      baseUrl,
      apiKey: this.resolveFormKey(body.id, body.apiKey),
      protocol: body.protocol,
      model,
      maxOutput: body.maxOutput,
    });
  }

  /** 出站地址守卫（独立方法便于单测注入：DNS 解析不适合在每个用例里真跑） */
  protected async guardOutbound(url: string, allowPrivate: boolean) {
    return checkOutboundUrl(url, { allowPrivate });
  }

  /** 表单 Key 解析：明文直接用；空/掩码时按 id 回查库内真实 Key（绝不把掩码当 Key 发上游） */
  private resolveFormKey(id: string | undefined, submitted: string | undefined): string {
    const key = String(submitted ?? '').trim();
    if (key && !isMaskedKey(key)) return key;
    if (!id) return '';
    const row = sqlite.prepare('SELECT api_key FROM model_provider WHERE id = ?').get(id) as Record<string, string | undefined> | undefined;
    return row?.['api_key'] ? decryptSecret(String(row['api_key'])) : '';
  }

  removeProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id) as { is_active?: number } | undefined;
    if (!row) throw new NotFoundException('厂商不存在');
    sqlite.prepare('DELETE FROM model_provider WHERE id = ?').run(id);
    // 删除的是激活中的厂商 → AI 服务回退到环境变量配置，避免内存残留失效厂商
    if (row.is_active === 1) this.ai.resetToEnv();
    return { ok: true };
  }

  /** 切换激活厂商（立即影响所有 AI 调用） */
  activateProvider(id: string) {
    const row = sqlite.prepare('SELECT * FROM model_provider WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('厂商不存在');
    this.ai.switchProvider(id);
    return { ok: true, active: id };
  }

  // ---------- 外部 MCP 服务器 ----------
  listMcpServers() {
    return sqlite.prepare('SELECT id, name, url, enabled, created_at AS createdAt FROM mcp_server ORDER BY created_at').all();
  }

  saveMcpServer(body: { id?: string; name: string; url: string; enabled?: number }) {
    if (!body?.name?.trim() || !body?.url?.trim()) throw new BadRequestException('名称与 URL 不能为空');
    if (!/^https?:\/\//.test(body.url.trim())) throw new BadRequestException('URL 需以 http(s):// 开头');
    if (body.id) {
      sqlite.prepare('UPDATE mcp_server SET name=?, url=?, enabled=? WHERE id=?').run(body.name.trim(), body.url.trim().replace(/\/$/, ''), body.enabled === 0 ? 0 : 1, body.id);
      return { ok: true, id: body.id };
    }
    const id = randomUUID();
    sqlite.prepare('INSERT INTO mcp_server (id, name, url, enabled, created_at) VALUES (?,?,?,?,?)').run(id, body.name.trim(), body.url.trim().replace(/\/$/, ''), body.enabled === 0 ? 0 : 1, Date.now());
    return { ok: true, id };
  }

  removeMcpServer(id: string) {
    const row = sqlite.prepare('SELECT * FROM mcp_server WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('MCP 服务器不存在');
    sqlite.prepare('DELETE FROM mcp_server WHERE id = ?').run(id);
    return { ok: true };
  }

  // ---------- 角色定义与技能（persona + skills，对标 Dify/Coze 的人设与技能管理） ----------
  /** 内置技能（不可删除、可启停；name/description 与真实能力对应） */
  static readonly BUILTIN_SKILLS: { key: string; name: string; description: string }[] = [
    { key: 'literature_search', name: '文献检索', description: '检索项目文献库（标题/作者/摘要/全文），需要引用具体文献时使用' },
    { key: 'knowledge_qa', name: '知识库问答', description: '基于已上传资料（RAG）回答，回答标注来源文档，事实优先来自资料' },
    { key: 'writing_assist', name: '写作辅助', description: '大纲生成、章节起草、润色、降重、翻译等写作类操作' },
    { key: 'web_research', name: '联网检索', description: '检索公开网页作为背景参考，注意甄别时效与权威性' },
  ];

  /** 读取角色与技能配置：角色库默认角色优先，app_setting 兼容旧版；技能始终读 app_setting */
  getPersona() {
    const read = (key: string): string => {
      const row = sqlite.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as { value?: string } | undefined;
      return row?.value ?? '';
    };
    // 角色库（配置中心）是角色的唯一事实源：设置页「角色与技能」与配置中心显示同一份
    const roleRow = sqlite.prepare('SELECT name, system_prompt AS systemPrompt FROM config_role WHERE is_default = 1 AND enabled != 0 LIMIT 1').get() as { name?: string; systemPrompt?: string } | undefined;
    let skills: { id: string; key: string; name: string; description: string; enabled: number; builtin: number }[] = [];
    try {
      skills = JSON.parse(read('skills') || '[]');
    } catch {
      skills = [];
    }
    if (!Array.isArray(skills)) skills = [];
    // 首次使用（未保存过）：填充内置技能全启用，用户可立即启停
    if (skills.length === 0) {
      skills = SettingsService.BUILTIN_SKILLS.map((s) => ({ id: `builtin-${s.key}`, ...s, enabled: 1, builtin: 1 }));
    }
    return {
      name: roleRow?.name ?? read('persona_name'),
      systemPrompt: roleRow ? String(roleRow.systemPrompt ?? '') : read('system_prompt'),
      defaultSystemPrompt: read('system_prompt_default') || '',
      skills,
    };
  }

  /** 保存角色与技能：systemPrompt 为空=恢复默认角色；skills 全量覆盖（前端保证内置项存在） */
  savePersona(body: { name?: string; systemPrompt?: string; skills?: { id?: string; key: string; name: string; description: string; enabled?: number; builtin?: number }[] }) {
    const upsert = (key: string, value: string) => {
      const exists = sqlite.prepare('SELECT key FROM app_setting WHERE key = ?').get(key);
      if (exists) sqlite.prepare('UPDATE app_setting SET value = ? WHERE key = ?').run(value, key);
      else sqlite.prepare('INSERT INTO app_setting (key, value) VALUES (?,?)').run(key, value);
    };
    if (body.name !== undefined) upsert('persona_name', body.name.trim());
    if (body.systemPrompt !== undefined) {
      upsert('system_prompt', body.systemPrompt.trim());
      // 同步写角色库默认角色：保证配置中心 / CLI / 对话看到的是同一份角色
      const roleName = body.name?.trim() || '默认角色';
      const existing = sqlite.prepare('SELECT id FROM config_role WHERE is_default = 1 LIMIT 1').get() as { id?: string } | undefined;
      if (existing?.id) {
        sqlite.prepare('UPDATE config_role SET name = ?, system_prompt = ?, updated_at = ? WHERE id = ?')
          .run(roleName, body.systemPrompt.trim(), Date.now(), existing.id);
      } else {
        sqlite.prepare('INSERT INTO config_role (id, name, system_prompt, is_default, enabled, created_at, updated_at) VALUES (?,?,?,1,1,?,?)')
          .run(randomUUID(), roleName, body.systemPrompt.trim(), Date.now(), Date.now());
      }
    }
    if (Array.isArray(body.skills)) upsert('skills', JSON.stringify(body.skills.map((s) => ({
      id: s.id || randomUUID(),
      key: s.key,
      name: s.name,
      description: s.description,
      enabled: s.enabled === 0 ? 0 : 1,
      builtin: s.builtin === 0 ? 0 : 1,
    }))));
    return { ok: true, ...this.getPersona() };
  }
}