import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../db/database';
import { SkillRegistryService } from './skill-registry.service';

function setSkills(value: string | null) {
  if (value === null) sqlite.prepare("DELETE FROM app_setting WHERE key = 'skills'").run();
  else sqlite.prepare("INSERT INTO app_setting (key, value) VALUES ('skills', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
}

describe('SkillRegistryService', () => {
  beforeEach(() => setSkills(null));

  it('indexes enabled skills without injecting instruction bodies', () => {
    setSkills(JSON.stringify([
      { id: 'ext-lit', key: 'lit_helper', name: '文献助手', description: '找文献', instructions: '很长的执行步骤'.repeat(100), enabled: 1 },
      { id: 'ext-off', key: 'off_skill', name: '停用技能', description: '不该出现', instructions: 'secret', enabled: 0 },
    ]));
    const registry = new SkillRegistryService();
    const index = registry.indexText();
    expect(index).toContain('lit_helper');
    expect(index).toContain('文献助手');
    expect(index).toContain('skill_read');
    expect(index).not.toContain('很长的执行步骤');
    expect(index).not.toContain('停用技能');
  });

  it('reads the full instructions on demand and reports truncation', () => {
    setSkills(JSON.stringify([
      { id: 'ext-lit', key: 'lit_helper', name: '文献助手', description: '找文献', instructions: '步骤'.repeat(20_000), enabled: 1 },
    ]));
    const registry = new SkillRegistryService();
    const result = registry.read('lit_helper');
    expect(result).not.toBeNull();
    expect(result!.instructions.length).toBeLessThanOrEqual(20_000 + 30);
    expect(result!.truncated).toBe(true);
    expect(registry.read('missing')).toBeNull();
  });

  it('falls back to builtin skills when settings are absent', () => {
    const registry = new SkillRegistryService();
    expect(registry.listEnabled().map((s) => s.key)).toEqual([
      'literature_search',
      'knowledge_qa',
      'writing_assist',
      'web_research',
    ]);
    expect(registry.read('writing_assist')?.hasInstructions).toBe(false);
  });
});
