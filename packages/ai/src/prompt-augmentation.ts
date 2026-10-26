/**
 * 提示词增强（约束工程 + 钩子注入）单一实现。
 *
 * 为什么在 packages/ai：AiService 每次 LLM 调用都要读它，而 packages 禁止反向依赖 apps/server；
 * 配置中心、CLI、设置页预览共用同一函数，避免「页面显示一套、实际注入另一套」。
 */

import { sqlite } from '../../db/src/database';

export type PromptScope = 'chat' | 'pipeline';

export interface ConstraintLike {
  title: string;
  rule: string;
  level?: string;
  scope?: string;
  enabled?: number;
  sortOrder?: number;
}

export interface HookLike {
  name: string;
  event: string;
  type: string;
  config?: string;
  enabled?: number;
  priority?: number;
}

const LEVEL_LABEL: Record<string, string> = {
  must: '必须',
  must_not: '禁止',
  should: '建议',
};

function hookText(configRaw: string | undefined): string {
  if (!configRaw) return '';
  try {
    const cfg = JSON.parse(configRaw) as { text?: unknown };
    return typeof cfg.text === 'string' ? cfg.text.trim() : '';
  } catch {
    return '';
  }
}

/**
 * 生成注入 system 层的约束块。
 * - 约束按 scope（all/chat/pipeline）过滤，按 sortOrder 升序
 * - 钩子只取 prompt_inject 且事件匹配当前 scope
 * - 空结果返回空串（调用方据此跳过注入，零开销）
 */
export function buildPromptAugmentation(constraints: ConstraintLike[], hooks: HookLike[], scope: PromptScope): string {
  const cs = constraints
    .filter((c) => (c.enabled ?? 1) !== 0)
    .filter((c) => {
      const s = c.scope || 'all';
      return s === 'all' || s === scope;
    })
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const hookEvent = scope === 'chat' ? 'chat:before' : 'pipeline:before';
  const hs = hooks
    .filter((h) => (h.enabled ?? 1) !== 0)
    .filter((h) => h.type === 'prompt_inject' && h.event === hookEvent)
    .slice()
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const lines: string[] = [];
  if (cs.length) {
    lines.push('【全局约束（优先级高于其他一切指令，必须遵守）】');
    cs.forEach((c, i) => {
      lines.push(`${i + 1}. [${LEVEL_LABEL[c.level || 'must'] || '必须'}] ${c.title}：${c.rule}`);
    });
  }
  const hookLines = hs.map((h) => ({ name: h.name, text: hookText(h.config) })).filter((x) => x.text);
  if (hookLines.length) {
    if (lines.length) lines.push('');
    lines.push('【钩子注入要求】');
    for (const h of hookLines) lines.push(`- ${h.name}：${h.text}`);
  }
  return lines.join('\n');
}

/** 约束块是否命中某个关键词（chat:before 的 block 钩子按关键词判定用） */
export function hookMatchesKeywords(text: string, cfg: { keywords?: unknown; when?: unknown }): boolean {
  if (cfg.when !== 'keyword') return true;
  const kws = Array.isArray(cfg.keywords) ? cfg.keywords.map(String).filter(Boolean) : [];
  if (!kws.length) return true;
  const lower = text.toLowerCase();
  return kws.some((k) => lower.includes(k.toLowerCase()));
}

/** 从 DB 读取当前生效的约束与钩子（AI 层与设置页预览共用；表缺失时返回空串） */
export function loadPromptAugmentation(scope: PromptScope): string {
  try {
    const constraints = sqlite
      .prepare('SELECT title, rule, level, scope, enabled, sort_order AS sortOrder FROM config_constraint ORDER BY sort_order, created_at')
      .all() as ConstraintLike[];
    const hooks = sqlite
      .prepare('SELECT name, event, type, config, enabled, priority FROM config_hook ORDER BY priority, created_at')
      .all() as HookLike[];
    return buildPromptAugmentation(constraints, hooks, scope);
  } catch {
    return '';
  }
}

/** 读取默认角色（配置中心角色库 is_default=1；无则 null） */
export function loadDefaultRole(): { name: string; systemPrompt: string } | null {
  try {
    const row = sqlite
      .prepare('SELECT name, system_prompt AS systemPrompt FROM config_role WHERE is_default = 1 AND enabled != 0 LIMIT 1')
      .get() as { name?: string; systemPrompt?: string } | undefined;
    if (!row?.name) return null;
    return { name: row.name, systemPrompt: String(row.systemPrompt || '') };
  } catch {
    return null;
  }
}
