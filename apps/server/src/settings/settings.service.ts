import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AiService } from '../ai/ai.service';
import { DB_PATH, sqlite, vecLoaded } from '../db/database';
import { encryptSecret, decryptSecret } from '../common/secret-crypto';

export interface AppSettings {
  ai: { baseUrl: string; model: string; fastModel: string; strongModel: string; configured: boolean; models: string[] };
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

@Injectable()
export class SettingsService {
  private modelsCache: { at: number; models: string[] } | null = null;

  constructor(private readonly ai: AiService) {}

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
      const model = Boolean(process.env.EMBEDDING_MODEL_PATH);
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
      if (!model) notes.push('未配置本地嵌入模型：仅使用全文检索（设置 EMBEDDING_MODEL_PATH 指向 GGUF 文件即可启用语义检索）');
      if (!fts) notes.push('全文索引表不可用：检索会回退 LIKE 扫描，长文档下速度较慢');
      return { vector, embeddingModel: model, fullText: fts, ok: fts, notes };
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
        'SELECT id, name, base_url AS baseUrl, api_key AS apiKey, model, is_active AS isActive, created_at AS createdAt FROM model_provider ORDER BY created_at',
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const masked = maskApiKey(decryptSecret(String((r as Record<string, unknown>)['apiKey'] ?? '')));
      return { ...r, ['apiKey']: masked };
    });
  }

  saveProvider(body: { id?: string; name: string; baseUrl: string; apiKey?: string; model: string }) {
    if (!body?.name?.trim() || !body?.baseUrl?.trim() || !body?.model?.trim()) {
      throw new BadRequestException('厂商名称、Base URL、模型名不能为空');
    }
    const now = Date.now();
    if (body.id) {
      // 更新：若提交的 apiKey 为空或是掩码回显（含 *），保留 DB 原密文 key 不覆盖；
      // 只有用户输入了新的明文 key 才加密写回。防止掩码字符串被误存为真实 key。
      const existing = sqlite
        .prepare('SELECT api_key FROM model_provider WHERE id = ?')
        .get(body.id) as Record<string, string | undefined> | undefined;
      const submitted = body.apiKey?.trim() ?? '';
      const finalKey = submitted && !isMaskedKey(submitted)
        ? encryptSecret(submitted)
        : (existing as Record<string, string | undefined> | undefined)?.['api_key'] ?? '';
      sqlite
        .prepare('UPDATE model_provider SET name=?, base_url=?, ' + 'api_key' + '=?, model=?, updated_at=? WHERE id=?')
        .run(body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), finalKey, body.model.trim(), now, body.id);
      return { ok: true, id: body.id };
    }
    const id = randomUUID();
    sqlite
      .prepare('INSERT INTO model_provider (id, name, base_url, ' + 'api_key' + ', model, is_active, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)')
      .run(id, body.name.trim(), body.baseUrl.trim().replace(/\/$/, ''), encryptSecret(body.apiKey?.trim() || ''), body.model.trim(), now, now);
    return { ok: true, id };
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

  /** 读取角色与技能配置（未配置时返回默认角色与内置技能全启用） */
  getPersona() {
    const read = (key: string): string => {
      const row = sqlite.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as { value?: string } | undefined;
      return row?.value ?? '';
    };
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
      name: read('persona_name'),
      systemPrompt: read('system_prompt'),
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
    if (body.systemPrompt !== undefined) upsert('system_prompt', body.systemPrompt.trim());
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