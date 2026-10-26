/**
 * 配置中心服务（角色 / 约束 / 钩子 / 权限 / 审计 / 预设）——唯一写入口。
 *
 * 三条入口共用：Web 设置页、CLI、对话工具（chat tool calling）。
 * 所有写操作先过权限矩阵并落审计；核心保护项不经此服务暴露。
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sqlite } from '../db/database';
import { checkOutboundUrl, allowPrivateOutbound } from '../common/outbound-guard';
import {
  CORE_PROTECTED, PERMISSION_MODES, PERMISSION_RANK, decidePermission, parsePermissionMode,
  type ConfigCategory, type PermissionMode, type PermissionDecision,
} from './permission';
import { CONFIG_PRESETS, SEED_CONSTRAINTS, SEED_HOOKS, SEED_ROLE, type ConfigPreset } from './config-presets';
import { loadPromptAugmentation } from '../../../../packages/ai/src/prompt-augmentation';

export interface RoleRow {
  id: string; name: string; systemPrompt: string; isDefault: number; enabled: number; createdAt: number; updatedAt: number;
}
export interface ConstraintRow {
  id: string; title: string; rule: string; level: string; scope: string; enabled: number; sortOrder: number; source: string; createdAt: number; updatedAt: number;
}
export interface HookRow {
  id: string; name: string; event: string; type: string; config: string; enabled: number; priority: number; createdAt: number; updatedAt: number;
}

const HOOK_EVENTS = ['chat:before', 'chat:after', 'pipeline:before', 'pipeline:after'];
const HOOK_TYPES = ['prompt_inject', 'block', 'webhook'];
const CONSTRAINT_LEVELS = ['must', 'must_not', 'should'];
const CONSTRAINT_SCOPES = ['all', 'chat', 'pipeline'];

function nowMs() { return Date.now(); }

@Injectable()
export class ConfigCenterService {
  private readonly logger = new Logger(ConfigCenterService.name);
  private seeded = false;

  constructor() {
    this.ensureSeed();
  }

  // ------------------------------------------------------------------ //
  //  权限                                                              //
  // ------------------------------------------------------------------ //

  getPermissionMode(): PermissionMode {
    const row = sqlite.prepare("SELECT value FROM app_setting WHERE key='config_permission_mode'").get() as { value?: string } | undefined;
    // 未设置 → 产品默认「全面放开」；读到非法值 → fail-closed 回落 strict 并告警（防脏数据静默提权）
    if (row?.value === undefined) return 'unrestricted';
    const parsed = parsePermissionMode(row.value);
    if (!parsed) {
      this.logger.warn(`[config] 非法权限档「${row.value}」已按 strict 处理`);
      return 'strict';
    }
    return parsed;
  }

  getPermissionInfo() {
    const mode = this.getPermissionMode();
    return {
      mode,
      modes: PERMISSION_MODES,
      coreProtected: CORE_PROTECTED,
    };
  }

  /**
   * 切换权限档（专用门禁，独立于类别矩阵）：
   *  - 非法值直接 400（不再静默回落）
   *  - 降档（变严格）自由；升档（变宽松）每次最多一级，防止 strict 一键解除成 unrestricted
   *  - strict 下仍允许升到 balanced（否则用户永远无法解锁），但禁止直接跳到 open/unrestricted
   */
  setPermissionMode(mode: unknown, actor = 'ui') {
    const next = parsePermissionMode(mode);
    if (!next) {
      this.audit({ actor, category: 'permission', action: 'set_mode', target: 'permission', allowed: 0, reason: `非法权限档：${String(mode)}` });
      throw new BadRequestException(`非法权限档：${String(mode)}（可选 strict/balanced/open/unrestricted）`);
    }
    const current = this.getPermissionMode();
    const delta = PERMISSION_RANK[next] - PERMISSION_RANK[current];
    if (delta > 1) {
      const reason = `不允许从「${current}」一步跳到「${next}」：每次最多放宽一级（需先切到 ${PERMISSION_MODES[PERMISSION_RANK[current] + 1]?.value ?? '更高档'}）`;
      this.audit({ actor, category: 'permission', action: 'set_mode', target: 'permission', allowed: 0, reason });
      throw new BadRequestException(reason);
    }
    this.upsertSetting('config_permission_mode', next);
    this.audit({ actor, category: 'permission', action: 'set_mode', target: 'permission', detail: JSON.stringify({ from: current, to: next }) });
    return this.getPermissionInfo();
  }

  /** 写操作守卫：不满足直接 403 语义异常（含可读原因），并落拒绝审计 */
  assertAllowed(category: ConfigCategory, actor = 'ui'): PermissionDecision {
    const d = decidePermission(this.getPermissionMode(), category);
    if (!d.allowed) {
      this.audit({ actor, category, action: 'denied', target: category, allowed: 0, reason: d.reason });
      throw new BadRequestException(d.reason);
    }
    return d;
  }

  // ------------------------------------------------------------------ //
  //  角色                                                              //
  // ------------------------------------------------------------------ //

  listRoles(): RoleRow[] {
    return sqlite.prepare('SELECT id, name, system_prompt AS systemPrompt, is_default AS isDefault, enabled, created_at AS createdAt, updated_at AS updatedAt FROM config_role ORDER BY is_default DESC, created_at').all() as RoleRow[];
  }

  createRole(body: { name?: string; systemPrompt?: string; isDefault?: boolean }, actor = 'ui') {
    this.assertAllowed('role', actor);
    if (!body?.name?.trim()) throw new BadRequestException('角色名称不能为空');
    const id = randomUUID();
    const isDefault = body.isDefault ? 1 : 0;
    if (isDefault) sqlite.prepare('UPDATE config_role SET is_default = 0').run();
    sqlite.prepare('INSERT INTO config_role (id, name, system_prompt, is_default, enabled, created_at, updated_at) VALUES (?,?,?,?,1,?,?)')
      .run(id, body.name.trim(), String(body.systemPrompt ?? ''), isDefault, nowMs(), nowMs());
    this.audit({ actor, category: 'role', action: 'create', target: id, detail: body.name.trim() });
    return this.listRoles();
  }

  updateRole(id: string, patch: { name?: string; systemPrompt?: string; isDefault?: boolean; enabled?: number }, actor = 'ui') {
    this.assertAllowed('role', actor);
    const row = sqlite.prepare('SELECT id, is_default FROM config_role WHERE id = ?').get(id) as { id?: string; is_default?: number } | undefined;
    if (!row) throw new NotFoundException('角色不存在');
    // 不变量：始终恰好一个可用默认角色。禁止把唯一默认角色降级/停用（否则对话静默回落内置提示词）
    if (row.is_default === 1 && (patch.isDefault === false || patch.enabled === 0)) {
      const others = sqlite.prepare('SELECT id FROM config_role WHERE id != ? AND is_default = 0 AND enabled != 0').get(id);
      if (!others) throw new BadRequestException('至少保留一个可用默认角色：请先把其他角色设为默认，再停用/降级当前角色');
      if (patch.enabled === 0) throw new BadRequestException('默认角色不可停用：请先把其他角色设为默认');
      // 允许取消默认（已有其他候选角色时由调用方显式再设置默认）
    }
    if (patch.isDefault) sqlite.prepare('UPDATE config_role SET is_default = 0').run();
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(String(patch.name).trim()); }
    if (patch.systemPrompt !== undefined) { sets.push('system_prompt = ?'); vals.push(String(patch.systemPrompt)); }
    if (patch.isDefault !== undefined) { sets.push('is_default = ?'); vals.push(patch.isDefault ? 1 : 0); }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); vals.push(patch.enabled ? 1 : 0); }
    if (!sets.length) return this.listRoles();
    sets.push('updated_at = ?'); vals.push(nowMs(), id);
    sqlite.prepare(`UPDATE config_role SET ${sets.join(', ')} WHERE id = ?`).run(...vals as never[]);
    this.audit({ actor, category: 'role', action: 'update', target: id, detail: JSON.stringify(patch).slice(0, 500) });
    return this.listRoles();
  }

  deleteRole(id: string, actor = 'ui') {
    this.assertAllowed('role', actor);
    const row = sqlite.prepare('SELECT is_default FROM config_role WHERE id = ?').get(id) as { is_default?: number } | undefined;
    if (!row) throw new NotFoundException('角色不存在');
    if (row.is_default === 1) throw new BadRequestException('默认角色不可删除，请先把其他角色设为默认');
    sqlite.prepare('DELETE FROM config_role WHERE id = ?').run(id);
    this.audit({ actor, category: 'role', action: 'delete', target: id });
    return this.listRoles();
  }

  // ------------------------------------------------------------------ //
  //  约束                                                              //
  // ------------------------------------------------------------------ //

  listConstraints(): ConstraintRow[] {
    return sqlite.prepare('SELECT id, title, rule, level, scope, enabled, sort_order AS sortOrder, source, created_at AS createdAt, updated_at AS updatedAt FROM config_constraint ORDER BY sort_order, created_at').all() as ConstraintRow[];
  }

  createConstraint(body: { title?: string; rule?: string; level?: string; scope?: string; sortOrder?: number; source?: string }, actor = 'ui') {
    this.assertAllowed('constraint', actor);
    if (!body?.title?.trim() || !body?.rule?.trim()) throw new BadRequestException('约束标题与规则不能为空');
    const level = CONSTRAINT_LEVELS.includes(String(body.level)) ? String(body.level) : 'must';
    const scope = CONSTRAINT_SCOPES.includes(String(body.scope)) ? String(body.scope) : 'all';
    const id = randomUUID();
    sqlite.prepare('INSERT INTO config_constraint (id, title, rule, level, scope, enabled, sort_order, source, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)')
      .run(id, body.title.trim(), body.rule.trim(), level, scope, Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0, body.source || 'user', nowMs(), nowMs());
    this.audit({ actor, category: 'constraint', action: 'create', target: id, detail: body.title.trim() });
    return this.listConstraints();
  }

  updateConstraint(id: string, patch: { title?: string; rule?: string; level?: string; scope?: string; enabled?: number; sortOrder?: number }, actor = 'ui') {
    this.assertAllowed('constraint', actor);
    const row = sqlite.prepare('SELECT id FROM config_constraint WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('约束不存在');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.title !== undefined) { sets.push('title = ?'); vals.push(String(patch.title).trim()); }
    if (patch.rule !== undefined) { sets.push('rule = ?'); vals.push(String(patch.rule).trim()); }
    if (patch.level !== undefined && CONSTRAINT_LEVELS.includes(String(patch.level))) { sets.push('level = ?'); vals.push(String(patch.level)); }
    if (patch.scope !== undefined && CONSTRAINT_SCOPES.includes(String(patch.scope))) { sets.push('scope = ?'); vals.push(String(patch.scope)); }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); vals.push(patch.enabled ? 1 : 0); }
    if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(Number(patch.sortOrder) || 0); }
    if (!sets.length) return this.listConstraints();
    sets.push('updated_at = ?'); vals.push(nowMs(), id);
    sqlite.prepare(`UPDATE config_constraint SET ${sets.join(', ')} WHERE id = ?`).run(...vals as never[]);
    this.audit({ actor, category: 'constraint', action: 'update', target: id, detail: JSON.stringify(patch).slice(0, 500) });
    return this.listConstraints();
  }

  deleteConstraint(id: string, actor = 'ui') {
    this.assertAllowed('constraint', actor);
    const row = sqlite.prepare('SELECT id FROM config_constraint WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('约束不存在');
    sqlite.prepare('DELETE FROM config_constraint WHERE id = ?').run(id);
    this.audit({ actor, category: 'constraint', action: 'delete', target: id });
    return this.listConstraints();
  }

  // ------------------------------------------------------------------ //
  //  钩子                                                              //
  // ------------------------------------------------------------------ //

  listHooks(): HookRow[] {
    return sqlite.prepare('SELECT id, name, event, type, config, enabled, priority, created_at AS createdAt, updated_at AS updatedAt FROM config_hook ORDER BY priority, created_at').all() as HookRow[];
  }

  createHook(body: { name?: string; event?: string; type?: string; config?: unknown; priority?: number }, actor = 'ui') {
    this.assertAllowed('hook', actor);
    if (!body?.name?.trim()) throw new BadRequestException('钩子名称不能为空');
    if (!HOOK_EVENTS.includes(String(body.event))) throw new BadRequestException(`事件必须是 ${HOOK_EVENTS.join(' / ')}`);
    if (!HOOK_TYPES.includes(String(body.type))) throw new BadRequestException(`类型必须是 ${HOOK_TYPES.join(' / ')}`);
    const cfgText = typeof body.config === 'string' ? body.config : JSON.stringify(body.config ?? {});
    try { JSON.parse(cfgText); } catch { throw new BadRequestException('钩子配置必须是合法 JSON'); }
    if (String(body.type) === 'webhook') {
      const url = (JSON.parse(cfgText) as { url?: string }).url;
      if (!url || !/^https?:\/\//.test(url)) throw new BadRequestException('webhook 钩子必须配置 http(s) URL');
    }
    // 同名同事件同类型已存在 → 400（防止重复注入；DB 另有唯一索引兜底）
    const dup = sqlite.prepare('SELECT id FROM config_hook WHERE name = ? AND event = ? AND type = ?')
      .get(body.name.trim(), String(body.event), String(body.type));
    if (dup) throw new BadRequestException(`钩子「${body.name.trim()}」已存在（同事件同类型），请先删除或改名`);
    const id = randomUUID();
    sqlite.prepare('INSERT INTO config_hook (id, name, event, type, config, enabled, priority, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(id, body.name.trim(), String(body.event), String(body.type), cfgText, Number.isFinite(Number(body.priority)) ? Number(body.priority) : 100, nowMs(), nowMs());
    this.audit({ actor, category: 'hook', action: 'create', target: id, detail: body.name.trim() });
    return this.listHooks();
  }

  updateHook(id: string, patch: { name?: string; event?: string; type?: string; config?: unknown; enabled?: number; priority?: number }, actor = 'ui') {
    this.assertAllowed('hook', actor);
    const row = sqlite.prepare('SELECT id FROM config_hook WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('钩子不存在');
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(String(patch.name).trim()); }
    if (patch.event !== undefined) {
      if (!HOOK_EVENTS.includes(String(patch.event))) throw new BadRequestException('非法事件');
      sets.push('event = ?'); vals.push(String(patch.event));
    }
    if (patch.type !== undefined) {
      if (!HOOK_TYPES.includes(String(patch.type))) throw new BadRequestException('非法类型');
      sets.push('type = ?'); vals.push(String(patch.type));
    }
    if (patch.config !== undefined) {
      const cfgText = typeof patch.config === 'string' ? patch.config : JSON.stringify(patch.config);
      try { JSON.parse(cfgText); } catch { throw new BadRequestException('钩子配置必须是合法 JSON'); }
      sets.push('config = ?'); vals.push(cfgText);
    }
    if (patch.enabled !== undefined) { sets.push('enabled = ?'); vals.push(patch.enabled ? 1 : 0); }
    if (patch.priority !== undefined) { sets.push('priority = ?'); vals.push(Number(patch.priority) || 100); }
    if (!sets.length) return this.listHooks();
    sets.push('updated_at = ?'); vals.push(nowMs(), id);
    sqlite.prepare(`UPDATE config_hook SET ${sets.join(', ')} WHERE id = ?`).run(...vals as never[]);
    this.audit({ actor, category: 'hook', action: 'update', target: id, detail: JSON.stringify(patch).slice(0, 500) });
    return this.listHooks();
  }

  deleteHook(id: string, actor = 'ui') {
    this.assertAllowed('hook', actor);
    const row = sqlite.prepare('SELECT id FROM config_hook WHERE id = ?').get(id);
    if (!row) throw new NotFoundException('钩子不存在');
    sqlite.prepare('DELETE FROM config_hook WHERE id = ?').run(id);
    this.audit({ actor, category: 'hook', action: 'delete', target: id });
    return this.listHooks();
  }

  /**
   * 执行某事件的全部钩子：
   * - block：命中的关键词则抛异常（chat 请求被拒，返回可读原因），并落审计
   * - webhook：SSRF 守卫后 POST JSON（5s 超时），失败只记审计不阻断主流程
   * - prompt_inject：由 AiService 直接读表注入（这里不重复处理）
   */
  async runEventHooks(event: string, payload: Record<string, unknown>, actor = 'system'): Promise<{ blocked?: string; fired: number; errors: string[] }> {
    const hooks = this.listHooks().filter((h) => h.event === event && h.enabled !== 0);
    const errors: string[] = [];
    let fired = 0;
    for (const h of hooks) {
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(h.config || '{}'); } catch { cfg = {}; }
      try {
        if (h.type === 'block') {
          const when = String(cfg.when || 'always');
          const kws = Array.isArray(cfg.keywords) ? (cfg.keywords as unknown[]).map(String).filter(Boolean) : [];
          const text = String(payload.text ?? payload.topic ?? '');
          const hit = when !== 'keyword' || kws.length === 0 || kws.some((k) => text.toLowerCase().includes(k.toLowerCase()));
          if (hit) {
            const reason = String(cfg.reason || `已被钩子「${h.name}」拦截`);
            this.audit({ actor, category: 'hook', action: 'block', target: h.id, detail: JSON.stringify({ event, text: text.slice(0, 200) }), allowed: 0, reason });
            return { blocked: reason, fired: fired + 1, errors };
          }
        } else if (h.type === 'webhook') {
          const url = String(cfg.url || '');
          const guard = await checkOutboundUrl(url, { allowPrivate: allowPrivateOutbound() });
          if (!guard.ok) {
            errors.push(`${h.name}: ${guard.reason}`);
            this.audit({ actor, category: 'hook', action: 'webhook_blocked', target: h.id, allowed: 0, reason: guard.reason || '出站被拒' });
            continue;
          }
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, hook: h.name, payload, at: nowMs() }),
            signal: AbortSignal.timeout(5000),
          }).catch((e: unknown) => ({ ok: false, status: 0, statusText: String((e as Error)?.message || e) }) as Response);
          fired += 1;
          this.audit({ actor, category: 'hook', action: 'webhook', target: h.id, allowed: res.ok ? 1 : 0, reason: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status} ${res.statusText}` });
        }
      } catch (e: unknown) {
        errors.push(`${h.name}: ${String((e as Error)?.message || e)}`);
      }
    }
    return { fired, errors };
  }

  // ------------------------------------------------------------------ //
  //  审计                                                              //
  // ------------------------------------------------------------------ //

  listAudit(limit = 100) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return sqlite.prepare('SELECT id, actor, category, action, target, detail, allowed, reason, created_at AS createdAt FROM config_audit ORDER BY created_at DESC, rowid DESC LIMIT ?').all(n);
  }

  audit(entry: { actor?: string; category: string; action: string; target?: string; detail?: string; allowed?: number; reason?: string }) {
    try {
      sqlite.prepare('INSERT INTO config_audit (id, actor, category, action, target, detail, allowed, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), entry.actor || 'ui', entry.category, entry.action, entry.target || '', entry.detail || '', entry.allowed ?? 1, entry.reason || '', nowMs());
    } catch { /* 审计失败不影响主流程 */ }
  }

  // ------------------------------------------------------------------ //
  //  预设 / 快照 / 预览                                                //
  // ------------------------------------------------------------------ //

  listPresets(): ConfigPreset[] {
    return CONFIG_PRESETS;
  }

  /** 应用预设：角色 upsert 为默认、约束全量替换（source=preset）、钩子全量替换 */
  applyPreset(presetId: string, actor = 'ui') {
    this.assertAllowed('constraint', actor);
    const preset = CONFIG_PRESETS.find((p) => p.id === presetId);
    if (!preset) throw new BadRequestException('预设不存在');
    if (preset.role) {
      this.assertAllowed('role', actor);
      sqlite.prepare('UPDATE config_role SET is_default = 0').run();
      const existing = sqlite.prepare('SELECT id FROM config_role WHERE name = ?').get(preset.role.name) as { id?: string } | undefined;
      if (existing?.id) {
        sqlite.prepare('UPDATE config_role SET system_prompt = ?, is_default = 1, enabled = 1, updated_at = ? WHERE id = ?').run(preset.role.systemPrompt, nowMs(), existing.id);
      } else {
        sqlite.prepare('INSERT INTO config_role (id, name, system_prompt, is_default, enabled, created_at, updated_at) VALUES (?,?,?,1,1,?,?)')
          .run(randomUUID(), preset.role.name, preset.role.systemPrompt, nowMs(), nowMs());
      }
    }
    sqlite.prepare("DELETE FROM config_constraint WHERE source = 'preset'").run();
    preset.constraints.forEach((c, i) => {
      sqlite.prepare('INSERT INTO config_constraint (id, title, rule, level, scope, enabled, sort_order, source, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)')
        .run(randomUUID(), c.title, c.rule, c.level, c.scope, i, 'preset', nowMs(), nowMs());
    });
    sqlite.prepare("DELETE FROM config_hook WHERE name LIKE '[预设]%'").run();
    preset.hooks.forEach((h, i) => {
      sqlite.prepare('INSERT INTO config_hook (id, name, event, type, config, enabled, priority, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?)')
        .run(randomUUID(), `[预设] ${h.name}`, h.event, h.type, JSON.stringify(h.config), 10 + i, nowMs(), nowMs());
    });
    this.audit({ actor, category: 'constraint', action: 'apply_preset', target: preset.id, detail: preset.name });
    return this.snapshot();
  }

  /** 导出：可分享/备份的配置包（不含审计与密钥，任何档位可导出） */
  exportBundle() {
    return {
      version: 1,
      exportedAt: nowMs(),
      permission: { mode: this.getPermissionMode() },
      roles: this.listRoles().map((r) => ({ name: r.name, systemPrompt: r.systemPrompt, isDefault: r.isDefault === 1 })),
      constraints: this.listConstraints().map((c) => ({ title: c.title, rule: c.rule, level: c.level, scope: c.scope, enabled: c.enabled === 1, sortOrder: c.sortOrder })),
      hooks: this.listHooks().map((h) => ({ name: h.name, event: h.event, type: h.type, config: h.config, enabled: h.enabled === 1, priority: h.priority })),
    };
  }

  /**
   * 导入配置包（离线分享 / 从外部下载的 JSON）：merge=true 追加，merge=false 先清空用户自建项再写入。
   * 与其它写操作一样过权限矩阵 + 审计；非法条目逐条跳过并回报，不因单条坏数据整体失败。
   */
  importBundle(bundle: unknown, opts: { merge?: boolean; applyPermission?: boolean } = {}, actor = 'ui') {
    this.assertAllowed('constraint', actor);
    const b = bundle as { roles?: unknown; constraints?: unknown; hooks?: unknown; permission?: { mode?: unknown } } | null;
    if (!b || typeof b !== 'object') throw new BadRequestException('配置包格式错误：需要 JSON 对象');
    const errors: string[] = [];
    let rolesAdded = 0, constraintsAdded = 0, hooksAdded = 0;
    if (opts.merge === false) {
      // 覆盖模式：先快照将被删除的条目并写入审计（审计可证明「谁删了什么」）
      const doomedConstraints = sqlite.prepare("SELECT id, title FROM config_constraint WHERE source = 'user'").all() as { id: string; title: string }[];
      const doomedHooks = sqlite.prepare("SELECT id, name FROM config_hook WHERE name NOT LIKE '[预设]%'").all() as { id: string; name: string }[];
      this.audit({
        actor, category: 'constraint', action: 'bulk_delete',
        target: 'import:replace',
        detail: JSON.stringify({ constraints: doomedConstraints, hooks: doomedHooks }).slice(0, 3000),
      });
      sqlite.prepare("DELETE FROM config_constraint WHERE source = 'user'").run();
      sqlite.prepare("DELETE FROM config_hook WHERE name NOT LIKE '[预设]%'").run();
    }
    if (Array.isArray(b.roles)) {
      this.assertAllowed('role', actor);
      for (const r of b.roles as Record<string, unknown>[]) {
        const name = String(r?.name || '').trim();
        if (!name) { errors.push('role: 缺少 name'); continue; }
        if (r?.isDefault === true) sqlite.prepare('UPDATE config_role SET is_default = 0').run();
        const existing = sqlite.prepare('SELECT id FROM config_role WHERE name = ?').get(name) as { id?: string } | undefined;
        if (existing?.id) {
          sqlite.prepare('UPDATE config_role SET system_prompt = ?, is_default = ?, enabled = 1, updated_at = ? WHERE id = ?')
            .run(String(r?.systemPrompt || ''), r?.isDefault === true ? 1 : 0, nowMs(), existing.id);
        } else {
          sqlite.prepare('INSERT INTO config_role (id, name, system_prompt, is_default, enabled, created_at, updated_at) VALUES (?,?,?,?,1,?,?)')
            .run(randomUUID(), name, String(r?.systemPrompt || ''), r?.isDefault === true ? 1 : 0, nowMs(), nowMs());
        }
        rolesAdded += 1;
      }
    }
    if (Array.isArray(b.constraints)) {
      for (const c of b.constraints as Record<string, unknown>[]) {
        const title = String(c?.title || '').trim();
        const rule = String(c?.rule || '').trim();
        if (!title || !rule) { errors.push('constraint: 缺少 title/rule'); continue; }
        const level = CONSTRAINT_LEVELS.includes(String(c?.level)) ? String(c?.level) : 'must';
        const scope = CONSTRAINT_SCOPES.includes(String(c?.scope)) ? String(c?.scope) : 'all';
        // 幂等：同标题同规则已存在则跳过（重复导入/备份恢复不会叠加）
        const dup = sqlite.prepare('SELECT id FROM config_constraint WHERE title = ? AND rule = ?').get(title, rule);
        if (dup) { continue; }
        sqlite.prepare('INSERT INTO config_constraint (id, title, rule, level, scope, enabled, sort_order, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), title, rule, level, scope, c?.enabled === false ? 0 : 1, Number(c?.sortOrder) || 0, 'import', nowMs(), nowMs());
        constraintsAdded += 1;
      }
    }
    if (Array.isArray(b.hooks)) {
      this.assertAllowed('hook', actor);
      for (const h of b.hooks as Record<string, unknown>[]) {
        const name = String(h?.name || '').trim();
        if (!name) { errors.push('hook: 缺少 name'); continue; }
        if (!HOOK_EVENTS.includes(String(h?.event))) { errors.push(`hook ${name}: 非法 event`); continue; }
        if (!HOOK_TYPES.includes(String(h?.type))) { errors.push(`hook ${name}: 非法 type`); continue; }
        const cfgText = typeof h?.config === 'string' ? String(h.config) : JSON.stringify(h?.config ?? {});
        try { JSON.parse(cfgText); } catch { errors.push(`hook ${name}: config 非 JSON`); continue; }
        // 幂等：同名同事件同类型已存在则跳过
        const dupHook = sqlite.prepare('SELECT id FROM config_hook WHERE name = ? AND event = ? AND type = ?').get(name, String(h.event), String(h.type));
        if (dupHook) { continue; }
        sqlite.prepare('INSERT INTO config_hook (id, name, event, type, config, enabled, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(randomUUID(), name, String(h.event), String(h.type), cfgText, h?.enabled === false ? 0 : 1, Number(h?.priority) || 100, nowMs(), nowMs());
        hooksAdded += 1;
      }
    }
    // 导入包不自动应用 permission.mode（防止借导入提权）；需显式 applyPermission=true 且走同一升档门禁
    if (b.permission && typeof b.permission === 'object' && opts.applyPermission === true) {
      const mode = (b.permission as { mode?: unknown }).mode;
      try { this.setPermissionMode(mode, actor); } catch (e: unknown) { errors.push(`permission: ${String((e as Error)?.message || e)}`); }
    } else if (b.permission) {
      errors.push('permission: 已忽略（导入不自动改权限档，如需应用请显式 applyPermission）');
    }
    this.audit({ actor, category: 'constraint', action: 'import', target: 'bundle', detail: JSON.stringify({ rolesAdded, constraintsAdded, hooksAdded, merge: opts.merge !== false, errors: errors.slice(0, 5) }) });
    return { ok: true, rolesAdded, constraintsAdded, hooksAdded, errors };
  }

  /** 一次性快照：设置页一次请求拿全（角色/约束/钩子/权限/预设/审计/核心保护项） */
  snapshot() {
    return {
      permission: this.getPermissionInfo(),
      roles: this.listRoles(),
      constraints: this.listConstraints(),
      hooks: this.listHooks(),
      presets: CONFIG_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, constraints: p.constraints.length, hooks: p.hooks.length })),
      audit: this.listAudit(50),
      defaults: SEED_CONSTRAINTS.length,
    };
  }

  /** 预览：聊天/流水线实际会注入的约束文本（与 AI 层同一实现，设置页「生效预览」） */
  preview(scope: 'chat' | 'pipeline') {
    return {
      scope,
      text: loadPromptAugmentation(scope),
      role: this.listRoles().find((r) => r.isDefault === 1 && r.enabled !== 0) ?? null,
    };
  }

  /** 读取注入文本（CLI/对话工具预览用；AI 层每次调用走同一函数） */
  augmentation(scope: 'chat' | 'pipeline') {
    return loadPromptAugmentation(scope);
  }

  // ------------------------------------------------------------------ //
  //  种子与工具                                                        //
  // ------------------------------------------------------------------ //

  /** 幂等种子：库里为空时写入学术严谨型角色 + 约束 + 钩子（用户已有配置则不动） */
  ensureSeed() {
    if (this.seeded) return;
    this.seeded = true;
    try {
      const roles = (sqlite.prepare('SELECT COUNT(*) AS c FROM config_role').get() as { c: number }).c;
      if (roles === 0) {
        sqlite.prepare('INSERT INTO config_role (id, name, system_prompt, is_default, enabled, created_at, updated_at) VALUES (?,?,?,1,1,?,?)')
          .run(randomUUID(), SEED_ROLE.name, SEED_ROLE.systemPrompt, nowMs(), nowMs());
        this.logger.log('[config] 已写入默认角色（学术严谨型）');
      }
      const cons = (sqlite.prepare('SELECT COUNT(*) AS c FROM config_constraint').get() as { c: number }).c;
      if (cons === 0) {
        SEED_CONSTRAINTS.forEach((c, i) => {
          sqlite.prepare('INSERT INTO config_constraint (id, title, rule, level, scope, enabled, sort_order, source, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)')
            .run(randomUUID(), c.title, c.rule, c.level, c.scope, i, 'seed', nowMs(), nowMs());
        });
        SEED_HOOKS.forEach((h, i) => {
          sqlite.prepare('INSERT INTO config_hook (id, name, event, type, config, enabled, priority, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?)')
            .run(randomUUID(), h.name, h.event, h.type, JSON.stringify(h.config), 10 + i, nowMs(), nowMs());
        });
        this.logger.log('[config] 已写入默认约束与钩子');
      }
      const mode = sqlite.prepare("SELECT value FROM app_setting WHERE key='config_permission_mode'").get();
      if (!mode) this.upsertSetting('config_permission_mode', 'unrestricted');
    } catch (e: unknown) {
      this.logger.warn(`[config] 种子写入失败（表未建？）：${String((e as Error)?.message || e)}`);
    }
  }

  private upsertSetting(key: string, value: string) {
    sqlite.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
}
