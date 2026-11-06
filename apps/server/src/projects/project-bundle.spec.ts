import { describe, expect, it } from 'vitest';
import {
  BUNDLE_TABLES,
  BUNDLE_VERSION,
  buildIdMap,
  remapRow,
  renameOnImport,
  validateBundle,
} from './project-bundle';

const bundle = {
  bundleVersion: BUNDLE_VERSION,
  exportedAt: 1700000000000,
  project: { id: 'p1', name: '测试项目' },
  tables: {
    documents: [
      { id: 'd1', projectId: 'p1', title: 'doc' },
      { id: 'd2', projectId: 'p1', title: 'doc2' },
    ],
    references: [{ id: 'r1', projectId: 'p1', title: 'ref' }],
  },
  counts: { documents: 2, references: 1 },
};

describe('BUNDLE_TABLES', () => {
  it('每个条目都有唯一 key 与表名', () => {
    const keys = BUNDLE_TABLES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of BUNDLE_TABLES) {
      expect(t.table.length).toBeGreaterThan(0);
      expect(t.projectColumn).toBe('project_id');
    }
  });

  it('运行态轨迹默认不导出（避免归档文件臃肿）', () => {
    const heavy = BUNDLE_TABLES.filter((t) => !t.defaultInclude).map((t) => t.key);
    expect(heavy).toContain('pipelineTasks');
    expect(heavy).toContain('agentExecutions');
  });
});

describe('validateBundle', () => {
  it('接受合法包', () => {
    const r = validateBundle(bundle);
    expect(r.ok).toBe(true);
  });

  it('拒绝非对象', () => {
    for (const bad of [null, 'x', 42, []]) {
      const r = validateBundle(bad);
      expect(r.ok).toBe(false);
    }
  });

  it('拒绝缺失关键字段', () => {
    expect(validateBundle({ ...bundle, project: undefined }).ok).toBe(false);
    expect(validateBundle({ ...bundle, tables: undefined }).ok).toBe(false);
  });

  it('拒绝未来版本', () => {
    const r = validateBundle({ ...bundle, bundleVersion: BUNDLE_VERSION + 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('高于当前支持');
  });

  it('拒绝 tables 里非数组的条目', () => {
    const r = validateBundle({ ...bundle, tables: { documents: 'oops' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不是数组');
  });
});

describe('buildIdMap', () => {
  it('覆盖项目与所有行 id', () => {
    let n = 0;
    const map = buildIdMap(bundle, () => `new-${++n}`);
    expect(map.get('p1')).toBeTruthy();
    expect(map.get('d1')).toBeTruthy();
    expect(map.get('r1')).toBeTruthy();
  });

  it('同一个旧 id 只映射一次（引用一致性）', () => {
    let n = 0;
    const map = buildIdMap(bundle, () => `new-${++n}`);
    const first = map.get('p1');
    expect(map.get('p1')).toBe(first);
    expect([...map.values()].length).toBe(map.size);
  });

  it('忽略空值与重复 id', () => {
    const map = buildIdMap(
      { ...bundle, tables: { documents: [{ id: 'd1', projectId: 'p1' }, { id: 'd1', projectId: 'p1' }] } },
      () => 'X',
    );
    expect(map.size).toBe(2); // p1 + d1
  });
});

describe('remapRow', () => {
  it('把外键换成新 id', () => {
    const map = new Map([['p1', 'P'], ['d1', 'D']]);
    const row = remapRow({ id: 'd1', projectId: 'p1', title: 'x' }, map);
    expect(row.id).toBe('D');
    expect(row.projectId).toBe('P');
    expect(row.title).toBe('x');
  });

  it('未命中的值原样保留', () => {
    const row = remapRow({ id: 'unknown', other: 'value' }, new Map());
    expect(row.id).toBe('unknown');
    expect(row.other).toBe('value');
  });

  it('overrides 覆盖重映射结果（用于强设 projectId）', () => {
    const map = new Map([['p1', 'P']]);
    const row = remapRow({ projectId: 'p1' }, map, { projectId: 'NEW' });
    expect(row.projectId).toBe('NEW');
  });
});

describe('renameOnImport', () => {
  it('不重名时原名返回', () => {
    expect(renameOnImport('项目 A', ['项目 B'])).toBe('项目 A');
  });

  it('重名时追加标记', () => {
    expect(renameOnImport('项目 A', ['项目 A'])).toBe('项目 A（导入）');
  });

  it('多次重名时递增编号', () => {
    expect(renameOnImport('项目 A', ['项目 A', '项目 A（导入）'])).toBe('项目 A（导入 2）');
  });

  it('空名回落默认名', () => {
    expect(renameOnImport('', [])).toBe('未命名项目');
  });
});
