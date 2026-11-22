import { Injectable } from '@nestjs/common';
import { sqlite } from '../db/database';
import { BUILTIN_SKILLS } from '../common/skill-catalog';

export interface SkillIndexEntry {
  key: string;
  name: string;
  description: string;
  builtin: boolean;
  hasInstructions: boolean;
}

export interface SkillReadResult extends SkillIndexEntry {
  instructions: string;
  chars: number;
  truncated: boolean;
}

interface StoredSkill {
  id?: string;
  key?: string;
  name?: string;
  description?: string;
  instructions?: string;
  enabled?: number;
  builtin?: number;
}

const INDEX_MAX_CHARS = 3_000;
const READ_MAX_CHARS = 20_000;

/**
 * 技能索引与按需读取。
 *
 * 旧实现把技能正文（最多 8000 字）全量塞进系统提示：技能一多，真正的用户问题和
 * 项目上下文就被挤到后面，且每轮都重复付费。这里只注入“名称 + 一句话用途 + key”，
 * 模型需要执行细节时再调用原生工具 `skill_read`。正文仍来自设置页/扩展投影，
 * 不改变用户已保存的技能内容。
 */
@Injectable()
export class SkillRegistryService {
  private readStored(): StoredSkill[] {
    try {
      const row = sqlite.prepare("SELECT value FROM app_setting WHERE key = 'skills'").get() as { value?: string } | undefined;
      if (!row?.value) return [];
      const parsed = JSON.parse(row.value) as unknown;
      return Array.isArray(parsed) ? (parsed as StoredSkill[]) : [];
    } catch {
      return [];
    }
  }

  private normalized(): StoredSkill[] {
    const stored = this.readStored();
    if (stored.length === 0) {
      return BUILTIN_SKILLS.map((s) => ({ id: `builtin-${s.key}`, ...s, enabled: 1, builtin: 1 }));
    }
    return stored;
  }

  private keyOf(skill: StoredSkill): string {
    return String(skill.key || skill.id || '').trim();
  }

  listEnabled(): SkillIndexEntry[] {
    const seen = new Set<string>();
    const out: SkillIndexEntry[] = [];
    for (const s of this.normalized()) {
      if (s.enabled === 0) continue;
      const key = this.keyOf(s);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        name: String(s.name || key),
        description: String(s.description || '').slice(0, 300),
        builtin: s.builtin === 1 || key.startsWith('builtin-'),
        hasInstructions: Boolean(String(s.instructions || '').trim()),
      });
    }
    return out;
  }

  /** 系统提示里的技能索引：只给导航，不给正文。 */
  indexText(): string {
    const entries = this.listEnabled();
    if (entries.length === 0) return '';
    const lines = ['可用技能索引（需要完整执行说明时调用 skill_read，传入 key）：'];
    let used = lines[0].length;
    for (const s of entries) {
      const line = `- ${s.key} · ${s.name}：${s.description}${s.hasInstructions ? '（正文可按需读取）' : ''}`;
      if (used + line.length + 1 > INDEX_MAX_CHARS) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length === 1) return '';
    return lines.join('\n');
  }

  /** 按 key / name / id 读取一个已启用技能的完整说明；禁用或未知返回 null。 */
  read(keyOrName: string): SkillReadResult | null {
    const needle = String(keyOrName || '').trim();
    if (!needle) return null;
    const skill = this.normalized().find((s) => s.enabled !== 0 && [s.key, s.name, s.id].some((v) => String(v || '').trim() === needle));
    if (!skill) return null;
    const key = this.keyOf(skill);
    const raw = String(skill.instructions || '').trim();
    const truncated = raw.length > READ_MAX_CHARS;
    const instructions = truncated ? raw.slice(0, READ_MAX_CHARS) + '\n…（技能正文超过 20000 字，已截断）' : raw;
    return {
      key,
      name: String(skill.name || key),
      description: String(skill.description || ''),
      builtin: skill.builtin === 1 || key.startsWith('builtin-'),
      hasInstructions: Boolean(raw),
      instructions,
      chars: raw.length,
      truncated,
    };
  }
}
