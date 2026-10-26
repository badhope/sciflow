/**
 * 扩展中心服务（v1.4）：统一管理 skill / mcp / role / constraint / hook / prompt 七类资产。
 *
 * 设计要点：
 *  - **单一事实源**：所有资产存 `extension_asset` 一张表；首次启动幂等播种内置目录。
 *  - **投影真实生效**：启用/停用会同步写入各子系统（技能→app_setting.skills、约束→config_constraint、
 *    钩子→config_hook、角色→config_role、提示词→custom_prompt、MCP→mcp_server），不是「只存不生效」。
 *  - **私有优势工具**：`visibility=private` 的资产不进导出包、不出现在对外 MCP 清单，只有本机用户可见可关。
 *  - **四种添加方式**共用本服务：对话工具、拖拽/粘贴导入、手填模板、一键 AI 生成。
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import yaml from 'js-yaml';
import { jsonrepair } from 'jsonrepair';
import { sqlite } from '../db/database';
import { AiService } from '../ai/ai.service';
import { ConfigCenterService } from '../config/config-center.service';
import { BUILTIN_EXTENSION_ASSETS, EXTENSION_KINDS, type BuiltinAsset, type ExtensionKind } from './extension-catalog';
import { SettingsService } from '../settings/settings.service';

export interface ExtensionRow {
  id: string;
  key: string;
  kind: ExtensionKind;
  name: string;
  description: string;
  source: string;
  repo: string;
  license: string;
  install: string;
  tags: string;
  manifest: string;
  enabled: number;
  visibility: string;
  createdAt: number;
  updatedAt: number;
}

/** 导入解析后的统一资产结构（官方 SKILL.md / MCP JSON / 本项目模板都归一到这里） */
interface ParsedAsset {
  kind: ExtensionKind;
  key: string;
  name: string;
  description: string;
  manifest: Record<string, unknown>;
  repo?: string;
  license?: string;
  install?: string;
  tags?: string[];
}

const KIND_SET = new Set<string>(EXTENSION_KINDS.map((k) => k.value));

function now() { return Date.now(); }

/**
 * 资产 key 生成：小写化 + 非 ASCII 净化；中文/符号名净化后可能为空，
 * 回退到哈希短码，避免出现 `skill-` 这种空 slug 冲突（实测 UI 手填中文名会撞）。
 */
export function assetKey(kind: string, name: string): string {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug) return `${kind}-${slug}`;
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `${kind}-x${h.toString(36)}`;
}

/** 从 Markdown frontmatter 提取（SKILL.md 规范：--- 之间 YAML） */
export function parseFrontmatter(md: string): { meta: Record<string, unknown>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: md };
  try {
    const meta = (yaml.load(m[1]) as Record<string, unknown>) || {};
    return { meta: typeof meta === 'object' ? meta : {}, body: m[2] };
  } catch {
    return { meta: {}, body: md };
  }
}

/** 解析 SKILL.md → skill 资产 */
export function parseSkillMarkdown(md: string, fallbackKey: string): ParsedAsset {
  const { meta, body } = parseFrontmatter(md);
  const name = String(meta.name || meta.title || fallbackKey).trim();
  const description = String(meta.description || body.split('\n').find((l) => l.trim()) || '').slice(0, 400).trim();
  return {
    kind: 'skill',
    key: assetKey('skill', String(meta.name || fallbackKey)),
    name,
    description,
    manifest: { mode: 'prompt', instructions: body.trim().slice(0, 20_000), meta },
  };
}

/** 解析官方 MCP 服务器配置（mcpServers 结构） */
export function parseMcpJson(json: unknown): ParsedAsset[] {
  const out: ParsedAsset[] = [];
  const root = json as Record<string, unknown> | null;
  if (!root || typeof root !== 'object' || (!root.mcpServers && !root.servers)) {
    throw new BadRequestException('MCP 配置需包含 mcpServers 对象（官方格式：{"mcpServers":{...}}）');
  }
  const servers = (root.mcpServers ?? root.servers) as Record<string, unknown>;
  for (const [name, raw] of Object.entries(servers)) {
    const cfg = raw as Record<string, unknown> | null;
    if (!cfg || typeof cfg !== 'object') continue;
    const url = typeof cfg.url === 'string' ? cfg.url : '';
    if (!/^https?:\/\//.test(url)) continue; // 只接受可直接连接的 HTTP(S) 端点
    out.push({
      kind: 'mcp',
      key: assetKey('mcp', name),
      name: String(cfg.name || name),
      description: String(cfg.description || `MCP 服务器 ${name}`),
      manifest: { transport: 'http', url },
    });
  }
  if (!out.length) throw new BadRequestException('未找到可用的 HTTP(S) MCP 端点（stdio 配置请手动添加）');
  return out;
}

/** 解析本项目模板 JSON（{kind,name,manifest,...} 或数组） */
export function parseTemplateJson(json: unknown): ParsedAsset[] {
  const arr = Array.isArray(json) ? json : [json];
  const out: ParsedAsset[] = [];
  for (const item of arr) {
    const o = item as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') throw new BadRequestException('模板必须是 JSON 对象或对象数组');
    const kind = String(o.kind || '');
    if (!KIND_SET.has(kind)) throw new BadRequestException(`未知 kind「${kind}」，可选：${[...KIND_SET].join(' / ')}`);
    const name = String(o.name || '').trim();
    if (!name) throw new BadRequestException('缺少 name');
    const manifest = (o.manifest as Record<string, unknown>) || {};
    if (typeof manifest !== 'object' || Array.isArray(manifest)) throw new BadRequestException('manifest 必须是对象');
    out.push({
      kind: kind as ExtensionKind,
      key: String(o.key || assetKey(kind, name)),
      name,
      description: String(o.description || ''),
      manifest,
      repo: typeof o.repo === 'string' ? o.repo : undefined,
      license: typeof o.license === 'string' ? o.license : undefined,
      install: typeof o.install === 'string' ? o.install : undefined,
      tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map(String) : undefined,
    });
  }
  return out;
}

@Injectable()
export class ExtensionsService {
  private readonly logger = new Logger(ExtensionsService.name);
  private seeded = false;

  constructor(
    private readonly ai: AiService,
    private readonly config: ConfigCenterService,
  ) {
    this.ensureSeed();
  }

  // ------------------------------------------------------------------ //
  //  查询                                                              //
  // ------------------------------------------------------------------ //

  list(kind?: string, opts: { includePrivate?: boolean } = {}): ExtensionRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (kind && KIND_SET.has(kind)) { where.push('kind = ?'); args.push(kind); }
    if (opts.includePrivate === false) where.push("visibility != 'private'");
    const sql = `SELECT * FROM extension_asset ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY source DESC, kind, name`;
    return sqlite.prepare(sql).all(...(args as never[])) as ExtensionRow[];
  }

  /** 对外可见清单（导出包 / 外部 MCP 客户端用）：排除 private 私有优势工具 */
  listPublic(): ExtensionRow[] {
    return this.list(undefined, { includePrivate: false });
  }

  /** 导出扩展包（排除 private：私有优势工具不开放给别人） */
  exportBundle() {
    return {
      version: 1,
      exportedAt: now(),
      assets: this.listPublic().map((r) => ({
        kind: r.kind, key: r.key, name: r.name, description: r.description,
        repo: r.repo, license: r.license, install: r.install,
        tags: JSON.parse(r.tags || '[]'), manifest: JSON.parse(r.manifest || '{}'), enabled: r.enabled === 1,
      })),
    };
  }

  get(id: string): ExtensionRow {
    const row = sqlite.prepare('SELECT * FROM extension_asset WHERE id = ?').get(id) as ExtensionRow | undefined;
    if (!row) throw new NotFoundException('扩展不存在');
    return row;
  }

  kinds() {
    return EXTENSION_KINDS.map((k) => ({
      ...k,
      total: (sqlite.prepare('SELECT COUNT(*) AS c FROM extension_asset WHERE kind = ?').get(k.value) as { c: number }).c,
      enabled: (sqlite.prepare('SELECT COUNT(*) AS c FROM extension_asset WHERE kind = ? AND enabled = 1').get(k.value) as { c: number }).c,
    }));
  }

  // ------------------------------------------------------------------ //
  //  增删改（四种入口共用）                                            //
  // ------------------------------------------------------------------ //

  /** 新增/更新一条资产（key 冲突则更新），并投影到真实子系统 */
  upsert(parsed: ParsedAsset, opts: { source?: string; visibility?: string; id?: string; actor?: string } = {}): ExtensionRow {
    if (!KIND_SET.has(parsed.kind)) throw new BadRequestException(`未知 kind「${parsed.kind}」`);
    if (!parsed.name?.trim()) throw new BadRequestException('名称不能为空');
    const existing = opts.id
      ? (sqlite.prepare('SELECT * FROM extension_asset WHERE id = ?').get(opts.id) as ExtensionRow | undefined)
      : (sqlite.prepare('SELECT * FROM extension_asset WHERE key = ?').get(parsed.key) as ExtensionRow | undefined);
    const isPrivate = opts.visibility === 'private' || existing?.visibility === 'private';
    if (isPrivate) this.config.assertAllowed('skill', opts.actor || 'ui'); // 私有资产改动按技能类权限管控
    if (existing) {
      sqlite.prepare('UPDATE extension_asset SET name=?, description=?, manifest=?, repo=?, license=?, install=?, tags=?, enabled=1, updated_at=? WHERE id=?')
        .run(parsed.name.trim(), parsed.description || '', JSON.stringify(parsed.manifest ?? {}), parsed.repo || existing.repo, parsed.license || existing.license, parsed.install || existing.install, JSON.stringify(parsed.tags || []), now(), existing.id);
      const row = this.get(existing.id);
      this.project(row);
      return row;
    }
    const id = randomUUID();
    sqlite.prepare('INSERT INTO extension_asset (id, key, kind, name, description, source, repo, license, install, tags, manifest, enabled, visibility, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)')
      .run(id, parsed.key, parsed.kind, parsed.name.trim(), parsed.description || '', opts.source || 'user', parsed.repo || '', parsed.license || '', parsed.install || '', JSON.stringify(parsed.tags || []), JSON.stringify(parsed.manifest ?? {}), isPrivate ? 'private' : 'public', now(), now());
    const row = this.get(id);
    this.project(row);
    return row;
  }

  toggle(id: string, enabled: boolean): ExtensionRow {
    this.get(id); // 不存在时抛 404
    sqlite.prepare('UPDATE extension_asset SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now(), id);
    const next = this.get(id);
    this.project(next);
    return next;
  }

  remove(id: string): { ok: true } {
    const row = this.get(id);
    if (row.source !== 'user' && row.source !== 'import') {
      // 内置资产不允许物理删除（防止用户删完无法恢复），改为停用
      sqlite.prepare('UPDATE extension_asset SET enabled = 0, updated_at = ? WHERE id = ?').run(now(), id);
      this.project(this.get(id));
      return { ok: true };
    }
    sqlite.prepare('DELETE FROM extension_asset WHERE id = ?').run(id);
    this.deproject(row);
    return { ok: true };
  }

  /** 恢复内置资产（全部内置重新启用；用户自建保留） */
  resetBuiltin(): { restored: number } {
    const n = sqlite.prepare("UPDATE extension_asset SET enabled = 1, updated_at = ? WHERE source LIKE 'builtin-%'").run(now()).changes;
    for (const row of this.list()) this.project(row);
    this.config.audit({ actor: 'ui', category: 'skill', action: 'reset_builtin', detail: `${n} assets` });
    return { restored: n };
  }

  // ------------------------------------------------------------------ //
  //  导入（拖拽 / 粘贴 / 压缩包）                                      //
  // ------------------------------------------------------------------ //

  /**
   * 导入原始内容：自动识别 SKILL.md / MCP JSON / 模板 JSON / ZIP 包。
   * 返回逐文件结果（含字段级错误），部分成功不抛整体异常。
   */
  importRaw(input: { filename?: string; content: string | Uint8Array }): { added: number; updated: number; assets: ExtensionRow[]; errors: string[] } {
    const errors: string[] = [];
    const assets: ExtensionRow[] = [];
    let added = 0, updated = 0;
    const apply = (parsed: ParsedAsset[]) => {
      for (const p of parsed) {
        try {
          const before = sqlite.prepare('SELECT id FROM extension_asset WHERE key = ?').get(p.key);
          const row = this.upsert(p, { source: 'import' });
          assets.push(row);
          if (before) updated += 1; else added += 1;
        } catch (e: unknown) {
          errors.push(`${p.name}: ${String((e as Error)?.message || e)}`);
        }
      }
    };

    const filename = String(input.filename || '').toLowerCase();
    const isZip = filename.endsWith('.zip') || (typeof input.content !== 'string' && input.content.length > 4 && input.content[0] === 0x50 && input.content[1] === 0x4b);
    if (isZip) {
      try {
        const buf = typeof input.content === 'string' ? new Uint8Array(Buffer.from(input.content, 'base64')) : input.content;
        const files = unzipSync(buf);
        for (const [path, bytes] of Object.entries(files)) {
          if (path.endsWith('/')) continue;
          const text = strFromU8(bytes);
          if (/skill\.md$/i.test(path)) {
            try { apply([parseSkillMarkdown(text, path.replace(/\/skill\.md$/i, '').split('/').pop() || 'skill')]); }
            catch (e: unknown) { errors.push(`${path}: ${String((e as Error)?.message || e)}`); }
          } else if (/\.mcp\.json$|mcp.*\.json$/i.test(path) || /\.json$/i.test(path)) {
            try {
              const json = JSON.parse(text);
              // 先试模板，再试 MCP
              try { apply(parseTemplateJson(json)); }
              catch { apply(parseMcpJson(json)); }
            } catch (e: unknown) { errors.push(`${path}: ${String((e as Error)?.message || e)}`); }
          }
        }
        if (!assets.length && !errors.length) errors.push('压缩包内未找到 SKILL.md 或 JSON 配置');
      } catch (e: unknown) {
        errors.push(`压缩包解析失败：${String((e as Error)?.message || e)}（需标准 ZIP）`);
      }
      return { added, updated, assets, errors };
    }

    const text = typeof input.content === 'string' ? input.content : strFromU8(input.content);
    if (!text.trim()) throw new BadRequestException('内容为空');
    if (/^\s*---\r?\n[\s\S]*?name:/m.test(text) || /SKILL\.md/i.test(filename)) {
      apply([parseSkillMarkdown(text, filename.replace(/\.md$/i, '') || 'skill')]);
      return { added, updated, assets, errors };
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (e: unknown) {
      throw new BadRequestException(`无法识别的格式：既不是 SKILL.md（需 --- frontmatter），也不是合法 JSON（${String((e as Error)?.message || e)}）`);
    }
    const looksMcp = !!json && typeof json === 'object' && !Array.isArray(json)
      && ('mcpServers' in (json as Record<string, unknown>) || 'servers' in (json as Record<string, unknown>));
    if (looksMcp) {
      apply(parseMcpJson(json));
    } else {
      // 模板格式：逐条校验，单条错误只记录不整体失败
      try { apply(parseTemplateJson(json)); }
      catch (e: unknown) { errors.push(String((e as Error)?.message || e)); }
    }
    return { added, updated, assets, errors };
  }

  /** 当前各 kind 的模板（手填/一键生成都用它做 schema） */
  templates() {
    return [
      {
        kind: 'skill',
        fields: [
          { key: 'name', label: '技能名称', required: true, example: '文献精读矩阵' },
          { key: 'description', label: '一句话描述', required: true, example: '按 12 维矩阵精读论文' },
          { key: 'instructions', label: '技能说明（注入模型）', required: true, example: '按 12 维矩阵精读论文：研究问题、假设…' },
        ],
        jsonExample: { kind: 'skill', name: '示例技能', description: '一句话描述', manifest: { mode: 'prompt', instructions: '技能说明正文' } },
      },
      {
        kind: 'mcp',
        fields: [
          { key: 'name', label: '服务器名称', required: true, example: 'My MCP' },
          { key: 'url', label: 'HTTP(S) 端点', required: true, example: 'https://example.com/mcp' },
        ],
        jsonExample: { kind: 'mcp', name: '示例 MCP', description: '说明', manifest: { transport: 'http', url: 'https://example.com/mcp' } },
      },
      {
        kind: 'role',
        fields: [
          { key: 'name', label: '角色名称', required: true, example: '统计顾问' },
          { key: 'systemPrompt', label: '系统提示词', required: true, example: '你是统计顾问…' },
        ],
        jsonExample: { kind: 'role', name: '示例角色', description: '说明', manifest: { systemPrompt: '你是…' } },
      },
      {
        kind: 'constraint',
        fields: [
          { key: 'title', label: '约束标题', required: true, example: '数值必须带单位' },
          { key: 'rule', label: '规则内容', required: true, example: '所有数值必须带单位' },
          { key: 'level', label: '等级', required: false, example: 'must | must_not | should' },
          { key: 'scope', label: '作用域', required: false, example: 'all | chat | pipeline' },
        ],
        jsonExample: { kind: 'constraint', name: '数值必须带单位', description: '', manifest: { title: '数值必须带单位', rule: '所有数值必须带单位', level: 'must', scope: 'all' } },
      },
      {
        kind: 'hook',
        fields: [
          { key: 'name', label: '钩子名称', required: true, example: '结尾自检' },
          { key: 'event', label: '事件', required: true, example: 'chat:before | chat:after | pipeline:before | pipeline:after' },
          { key: 'type', label: '类型', required: true, example: 'prompt_inject | block | webhook' },
          { key: 'config', label: '配置 JSON', required: true, example: '{"text":"..."}' },
        ],
        jsonExample: { kind: 'hook', name: '示例钩子', description: '', manifest: { event: 'chat:before', type: 'prompt_inject', config: { text: '回答结尾附一句风险提示' } } },
      },
      {
        kind: 'prompt',
        fields: [
          { key: 'toolKey', label: '工具 key', required: true, example: 'polish | translate | writeOutline | draftSection…' },
          { key: 'prompt', label: '提示词正文', required: true, example: '你是学术润色专家…' },
        ],
        jsonExample: { kind: 'prompt', name: '润色模板', description: '', manifest: { toolKey: 'polish', prompt: '你是…', enabled: 1 } },
      },
    ];
  }

  // ------------------------------------------------------------------ //
  //  一键 AI 生成                                                      //
  // ------------------------------------------------------------------ //

  /** 用已配置模型按模板生成资产草稿（不落库，返回可编辑草稿；用户确认后再 upsert） */
  async generate(kind: string, brief: string): Promise<{ draft: ParsedAsset; raw: string }> {
    if (!KIND_SET.has(kind)) throw new BadRequestException(`未知 kind「${kind}」`);
    if (!brief?.trim()) throw new BadRequestException('请先描述你想要的工具（一两句话）');
    if (!this.ai.configured) throw new BadRequestException('AI 未配置：请先在设置 → 模型路由中配置模型后再使用一键生成');
    const tpl = this.templates().find((t) => t.kind === kind)!;
    const schemaHint = JSON.stringify(tpl.jsonExample, null, 2);
    const raw = await this.ai.complete([
      {
        role: 'system',
        content: [
          '你是 SciFlow 扩展中心的资产生成器。用户会用一两句话描述想要的科研能力，你要输出一条可直接入库的资产 JSON。',
          '严格要求：只输出 JSON，不要 Markdown 代码块，不要解释。字段必须与给定示例同构。',
          'content 必须专业、具体、可执行（含步骤、输出格式、拒答边界），不要空话。',
        ].join('\n'),
      },
      { role: 'user', content: `资产类型：${kind}（${EXTENSION_KINDS.find((k) => k.value === kind)?.label}）\n用户需求：${brief.trim()}\n\n输出 JSON 示例结构：\n${schemaHint}` },
    ], { temperature: 0.4, maxTokens: 1500, context: 'extensionGenerate' });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    // 模型常把换行直接写进字符串（非法 JSON）：先用 jsonrepair 修复（项目既有依赖，与 ai.service 同一策略）
    let json: unknown;
    try {
      json = JSON.parse(cleaned);
    } catch {
      try {
        json = JSON.parse(jsonrepair(cleaned));
      } catch (e: unknown) {
        throw new BadRequestException(`AI 生成结果不是合法资产 JSON：${String((e as Error)?.message || e).slice(0, 200)}`);
      }
    }
    let parsed: ParsedAsset[];
    try {
      parsed = parseTemplateJson(json);
    } catch (e: unknown) {
      throw new BadRequestException(`AI 生成的资产结构不合法：${String((e as Error)?.message || e).slice(0, 200)}`);
    }
    return { draft: parsed[0], raw: cleaned };
  }

  // ------------------------------------------------------------------ //
  //  投影：资产 → 真实子系统                                            //
  // ------------------------------------------------------------------ //

  /**
   * 把一条资产启用/停用同步到真实子系统。
   * 幂等：以稳定 key 去重；停用时撤回对应配置。
   */
  project(row: ExtensionRow): void {
    try {
      const manifest = JSON.parse(row.manifest || '{}') as Record<string, unknown>;
      const enabled = row.enabled === 1;
      switch (row.kind) {
        case 'skill': return this.projectSkill(row, manifest, enabled);
        case 'role': return this.projectRole(row, manifest, enabled);
        case 'constraint': return this.projectConstraint(row, manifest, enabled);
        case 'hook': return this.projectHook(row, manifest, enabled);
        case 'prompt': return this.projectPrompt(row, manifest, enabled);
        case 'mcp': return this.projectMcp(row, manifest, enabled);
        default: return;
      }
    } catch (e: unknown) {
      this.logger.warn(`[extensions] 投影失败 ${row.key}: ${String((e as Error)?.message || e)}`);
    }
  }

  private deproject(row: ExtensionRow): void {
    this.project({ ...row, enabled: 0 });
  }

  private projectSkill(row: ExtensionRow, manifest: Record<string, unknown>, enabled: boolean): void {
    const stored = this.readJson<{ id: string; key: string; name: string; description: string; enabled: number; builtin: number }[]>('skills', []);
    // 必须保留内置 4 项技能（AgentToolBridge 用它们的 key 裁剪工具；缺失会被当作全部关闭）
    const skills = [...stored];
    for (const b of SettingsService.BUILTIN_SKILLS) {
      if (!skills.some((s) => s.key === b.key)) skills.unshift({ id: `builtin-${b.key}`, ...b, enabled: 1, builtin: 1 });
    }
    const idx = skills.findIndex((s) => s.id === `ext-${row.key}`);
    const entry = {
      id: `ext-${row.key}`,
      key: row.key,
      name: row.name,
      description: (row.description || row.name).slice(0, 200),
      enabled: enabled ? 1 : 0,
      builtin: row.source.startsWith('builtin') ? 1 : 0,
    };
    if (idx >= 0) skills[idx] = entry; else if (enabled) skills.push(entry);
    this.writeJson('skills', skills);
  }

  private projectRole(row: ExtensionRow, manifest: Record<string, unknown>, enabled: boolean): void {
    const prompt = String(manifest.systemPrompt || '').trim();
    if (!prompt) return;
    const existing = sqlite.prepare('SELECT id FROM config_role WHERE name = ?').get(row.name) as { id?: string } | undefined;
    if (!enabled) {
      // 停用：仅清空提示词并取消默认，不删除（可能被用户设过默认）
      if (existing?.id) sqlite.prepare('UPDATE config_role SET enabled = 0, is_default = 0, updated_at = ? WHERE id = ?').run(now(), existing.id);
      return;
    }
    if (existing?.id) {
      sqlite.prepare('UPDATE config_role SET system_prompt = ?, enabled = 1, updated_at = ? WHERE id = ?').run(prompt, now(), existing.id);
    } else {
      sqlite.prepare('INSERT INTO config_role (id, name, system_prompt, is_default, enabled, created_at, updated_at) VALUES (?,?,?,0,1,?,?)')
        .run(randomUUID(), row.name, prompt, now(), now());
    }
  }

  private projectConstraint(row: ExtensionRow, manifest: Record<string, unknown>, enabled: boolean): void {
    const title = String(manifest.title || row.name).trim();
    const rule = String(manifest.rule || '').trim();
    if (!title || !rule) return;
    const level = ['must', 'must_not', 'should'].includes(String(manifest.level)) ? String(manifest.level) : 'must';
    const scope = ['all', 'chat', 'pipeline'].includes(String(manifest.scope)) ? String(manifest.scope) : 'all';
    const existing = sqlite.prepare('SELECT id, source FROM config_constraint WHERE title = ?').get(title) as { id?: string; source?: string } | undefined;
    if (existing?.id) {
      // 只覆盖由扩展投影产生的行（source=extension），避免覆盖用户手写同名约束
      if (existing.source === 'extension' || existing.source === 'seed') {
        sqlite.prepare('UPDATE config_constraint SET rule = ?, level = ?, scope = ?, enabled = ?, updated_at = ? WHERE id = ?')
          .run(rule, level, scope, enabled ? 1 : 0, now(), existing.id);
      }
      return;
    }
    if (!enabled) return;
    sqlite.prepare('INSERT INTO config_constraint (id, title, rule, level, scope, enabled, sort_order, source, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)')
      .run(randomUUID(), title, rule, level, scope, 100, 'extension', now(), now());
  }

  private projectHook(row: ExtensionRow, manifest: Record<string, unknown>, enabled: boolean): void {
    const event = String(manifest.event || 'chat:before');
    const type = String(manifest.type || 'prompt_inject');
    const config = JSON.stringify(manifest.config ?? {});
    const existing = sqlite.prepare('SELECT id FROM config_hook WHERE name = ? AND event = ? AND type = ?').get(row.name, event, type) as { id?: string } | undefined;
    if (existing?.id) {
      sqlite.prepare('UPDATE config_hook SET config = ?, enabled = ?, updated_at = ? WHERE id = ?').run(config, enabled ? 1 : 0, now(), existing.id);
      return;
    }
    if (!enabled) return;
    sqlite.prepare('INSERT INTO config_hook (id, name, event, type, config, enabled, priority, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(randomUUID(), row.name, event, type, config, 200, now(), now());
  }

  private promptActiveMap(): Record<string, string> {
    return this.readJson<Record<string, string>>('extension_prompt_active', {});
  }

  /**
   * 提示词模板投影：同一 toolKey 只能有一个生效模板。
   *
   * 关键取舍：模板「启用」只代表在扩展中心可用，**不等于自动覆盖系统默认提示词**——
   * 自动覆盖会静默改变所有科研工具的输出契约（实测会让流水线起草 prompt 失去 [n] 锚点指令）。
   * 只有用户显式点「应用」（applyPrompt）才写入 custom_prompt；未应用时保持系统默认。
   */
  private projectPrompt(row: ExtensionRow, manifest: Record<string, unknown>, enabled: boolean): void {
    const toolKey = String(manifest.toolKey || '');
    const prompt = String(manifest.prompt || '').trim();
    if (!toolKey || !prompt) return;
    const map = this.promptActiveMap();
    const activeKey = map[toolKey];
    const existing = sqlite.prepare('SELECT id, tool_label FROM custom_prompt WHERE tool_key = ?').get(toolKey) as { id?: string; tool_label?: string } | undefined;
    if (!enabled) {
      if (activeKey === row.key && existing?.id) {
        sqlite.prepare('UPDATE custom_prompt SET enabled = 0, updated_at = ? WHERE id = ?').run(now(), existing.id);
        delete map[toolKey];
        this.writeJson('extension_prompt_active', map);
      }
      return;
    }
    // 未显式应用 → 不写入 custom_prompt（保留系统默认提示词）
    if (activeKey !== row.key) return;
    if (existing?.id) {
      sqlite.prepare('UPDATE custom_prompt SET prompt = ?, tool_label = ?, enabled = 1, updated_at = ? WHERE id = ?').run(prompt, row.name, now(), existing.id);
    } else {
      sqlite.prepare('INSERT INTO custom_prompt (id, tool_key, tool_label, prompt, enabled, updated_at) VALUES (?,?,?,?,1,?)')
        .run(randomUUID(), toolKey, row.name, prompt, now());
    }
  }

  /** 当前生效的提示词模板 key（设置页展示「已应用」徽标） */
  activePromptKeys(): Record<string, string> {
    return this.promptActiveMap();
  }

  /** 显式应用某个提示词模板（同 toolKey 其他模板让位） */
  applyPrompt(id: string): ExtensionRow {
    const row = this.get(id);
    if (row.kind !== 'prompt') throw new BadRequestException('只有提示词模板支持「应用」');
    const manifest = JSON.parse(row.manifest || '{}') as Record<string, unknown>;
    const toolKey = String(manifest.toolKey || '');
    // 同 toolKey 的其他模板停用（只允许一个生效）
    for (const other of this.list('prompt')) {
      const m = JSON.parse(other.manifest || '{}') as Record<string, unknown>;
      if (String(m.toolKey) === toolKey && other.id !== id) {
        sqlite.prepare('UPDATE extension_asset SET enabled = 0, updated_at = ? WHERE id = ?').run(now(), other.id);
      }
    }
    // 先登记 active key，再投影（projectPrompt 以 map 为准写 custom_prompt）
    const map = this.promptActiveMap();
    map[toolKey] = row.key;
    this.writeJson('extension_prompt_active', map);
    sqlite.prepare('UPDATE extension_asset SET enabled = 1, updated_at = ? WHERE id = ?').run(now(), id);
    this.project(this.get(id));
    return this.get(id);
  }

  private projectMcp(row: ExtensionRow, manifest: Record<string, unknown>, enabled: boolean): void {
    const url = String(manifest.url || '');
    if (!/^https?:\/\//.test(url)) return;
    const existing = sqlite.prepare('SELECT id FROM mcp_server WHERE name = ?').get(row.name) as { id?: string } | undefined;
    if (existing?.id) {
      sqlite.prepare('UPDATE mcp_server SET url = ?, enabled = ? WHERE id = ?').run(url, enabled ? 1 : 0, existing.id);
      return;
    }
    if (!enabled) return;
    sqlite.prepare('INSERT INTO mcp_server (id, name, url, enabled, created_at) VALUES (?,?,?,1,?)')
      .run(randomUUID(), row.name, url, now());
  }

  // ------------------------------------------------------------------ //
  //  播种                                                              //
  // ------------------------------------------------------------------ //

  /** 首次启动幂等播种：内置资产全部启用并投影；已存在则只补缺失 */
  ensureSeed(): void {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const rows = sqlite.prepare('SELECT COUNT(*) AS c FROM extension_asset').get() as { c: number };
      if (rows.c > 0) {
        // 已有数据：不覆盖用户改动，但补齐新版本新增的内置项
        for (const asset of BUILTIN_EXTENSION_ASSETS) {
          const exists = sqlite.prepare('SELECT id FROM extension_asset WHERE key = ?').get(asset.key);
          if (!exists) this.insertBuiltin(asset);
        }
        return;
      }
      for (const asset of BUILTIN_EXTENSION_ASSETS) this.insertBuiltin(asset);
      // 播种后统一投影一次（含默认角色保持）
      for (const row of this.list()) this.project(row);
      this.logger.log(`[extensions] 已播种 ${BUILTIN_EXTENSION_ASSETS.length} 条内置资产（public ${BUILTIN_EXTENSION_ASSETS.filter((a) => a.source === 'builtin-public').length} / private ${BUILTIN_EXTENSION_ASSETS.filter((a) => a.source === 'builtin-private').length}）`);
    } catch (e: unknown) {
      this.logger.warn(`[extensions] 播种失败（表未建？）：${String((e as Error)?.message || e)}`);
    }
  }

  private insertBuiltin(asset: BuiltinAsset) {
    sqlite.prepare('INSERT INTO extension_asset (id, key, kind, name, description, source, repo, license, install, tags, manifest, enabled, visibility, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)')
      .run(randomUUID(), asset.key, asset.kind, asset.name, asset.description, asset.source, asset.repo || '', asset.license || '', asset.install || '', JSON.stringify(asset.tags || []), JSON.stringify(asset.manifest || {}), asset.source === 'builtin-private' ? 'private' : 'public', now(), now());
    const row = sqlite.prepare('SELECT * FROM extension_asset WHERE key = ?').get(asset.key) as ExtensionRow;
    // MCP 的远程端点写进 manifest.url（catalog 顶层 url 也合并进去）
    if (asset.url) {
      const mf = { ...(asset.manifest || {}), url: asset.url } as Record<string, unknown>;
      sqlite.prepare('UPDATE extension_asset SET manifest = ? WHERE key = ?').run(JSON.stringify(mf), asset.key);
      row.manifest = JSON.stringify(mf);
    }
    this.project(row);
  }

  // ------------------------------------------------------------------ //
  //  工具                                                              //
  // ------------------------------------------------------------------ //

  private readJson<T>(key: string, fallback: T): T {
    try {
      const row = sqlite.prepare('SELECT value FROM app_setting WHERE key = ?').get(key) as { value?: string } | undefined;
      if (!row?.value) return fallback;
      const v = JSON.parse(row.value);
      return v as T;
    } catch {
      return fallback;
    }
  }

  private writeJson(key: string, value: unknown): void {
    const text = JSON.stringify(value);
    const exists = sqlite.prepare('SELECT key FROM app_setting WHERE key = ?').get(key);
    if (exists) sqlite.prepare('UPDATE app_setting SET value = ? WHERE key = ?').run(text, key);
    else sqlite.prepare('INSERT INTO app_setting (key, value) VALUES (?,?)').run(key, text);
  }
}
