import { describe, it, expect } from 'vitest';
import { buildCommands, filterCommands } from './commands';
import { HOTKEY_DOCS } from './hotkeys-docs';

const navGroups = [
  { label: '核心工作', items: [{ key: 'workspace' as const, label: '工作台' }, { key: 'writing' as const, label: '论文写作' }] },
  { label: '自动化', items: [{ key: 'pipeline' as const, label: '全自动流水线' }] },
];

describe('命令面板注册表（F-3.1）', () => {
  const deps = { onNavigate: () => {}, onNewProject: () => {}, setThemeMode: () => {}, navGroups };
  const commands = buildCommands(deps);

  it('导航命令完备且 id 唯一', () => {
    const ids = commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of navGroups) for (const n of g.items) expect(ids).toContain(`nav-${n.key}`);
  });

  it('关键词命中：中文别名/英文缩写都能搜到', () => {
    const all = buildCommands(deps);
    expect(filterCommands(all, '夜间').map((c) => c.id)).toContain('theme-dark');
    expect(filterCommands(all, 'create project').map((c) => c.id)).toContain('new-project');
    expect(filterCommands(all, '流水线').map((c) => c.id)).toContain('nav-pipeline');
  });

  it('空查询返回全量；无命中返回空数组', () => {
    const all = buildCommands(deps);
    expect(filterCommands(all, '')).toHaveLength(all.length);
    expect(filterCommands(all, '不存在的命令xyz')).toHaveLength(0);
  });

  it('每条命令都有 label 与 group', () => {
    for (const c of commands) {
      expect(c.label.trim().length).toBeGreaterThan(0);
      expect(c.group.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('快捷键速查表（F-3.2）', () => {
  it('与实现一一对应：combo 写法合法、combo+label 不重复、scope 合法', () => {
    const seen = new Set<string>();
    const scopes = ['全局', '写作页', '工作台'];
    for (const h of HOTKEY_DOCS) {
      expect(h.combo).toMatch(/^(mod\+)?[a-z]+$/);
      expect(scopes).toContain(h.scope);
      const key = `${h.combo}::${h.label}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(HOTKEY_DOCS.length);
  });

  it('核心组合键全部在册（mod+k / mod+n / mod+s / mod+b）', () => {
    const combos = HOTKEY_DOCS.map((h) => h.combo);
    for (const c of ['mod+k', 'mod+n', 'mod+s', 'mod+b']) expect(combos).toContain(c);
  });
});
