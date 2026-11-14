import { describe, it, expect } from 'vitest';
import { checkConsistency, guessChineseNames, normalizeEntityName } from './longform.consistency';

/**
 * 一致性检查器是确定性规则，必须稳定：同一输入永远同一结论。
 * 典型要抓的错误：声明出场却没写、正文里换了名字、出现了未登记的人名。
 */
describe('长篇一致性检查', () => {
  it('声明出场但正文没出现 → warning', () => {
    const r = checkConsistency([
      { seq: 1, title: '第一章', entities: ['陈默', '林远'], content: '陈默走进档案室，翻开了记录。' },
    ]);
    expect(r.issues.some((i) => i.kind === 'missing-entity' && i.message.includes('林远'))).toBe(true);
    expect(r.score).toBeLessThan(100);
  });

  it('正文出现与登记实体的单字差异 → 疑似改名', () => {
    const r = checkConsistency([{ seq: 2, title: '第二章', entities: ['陈默'], content: '陈墨抬起头，看着窗外的雾。' }], ['陈默']);
    const v = r.issues.find((i) => i.kind === 'name-variant');
    expect(v).toBeTruthy();
    expect(v!.message).toContain('陈墨');
    expect(v!.message).toContain('陈默');
  });

  it('完全未登记的人名 → info（不误判为改名）', () => {
    const r = checkConsistency([{ seq: 1, title: '第一章', entities: ['陈默'], content: '陈默遇见了周海。' }], ['陈默']);
    const u = r.issues.find((i) => i.kind === 'unregistered-entity');
    expect(u?.severity).toBe('info');
  });

  it('一致的书不产生 warning，分数 100', () => {
    const r = checkConsistency([
      { seq: 1, title: '第一章', entities: ['陈默'], content: '陈默走进档案室。' },
      { seq: 2, title: '第二章', entities: ['陈默'], content: '陈默打开抽屉。' },
    ]);
    expect(r.issues.filter((i) => i.severity === 'warning')).toHaveLength(0);
    expect(r.score).toBe(100);
  });

  it('实体名带角色注释时不误判漏写（真实缺陷回归）', () => {
    // 实测：模型把实体写成「林远（主角/测绘员）」，正文只出现「林远」，
    // 旧实现拿整串比对，导致每章几十条假「漏写」。
    const r = checkConsistency([
      { seq: 1, title: '第一章', entities: ['林远（主角/测绘员）', '黑潮港（地点）'], content: '林远抵达黑潮港，风很大。' },
    ]);
    expect(r.issues.filter((i) => i.kind === 'missing-entity')).toHaveLength(0);
    expect(r.declaredEntities).toContain('林远');
    expect(r.declaredEntities).toContain('黑潮港');
  });

  it('normalizeEntityName 剥掉中英文括号注释与角色前缀', () => {
    expect(normalizeEntityName('林远（主角/测绘员）')).toBe('林远');
    expect(normalizeEntityName('黑潮港 (地点)')).toBe('黑潮港');
    expect(normalizeEntityName('向导阿海')).toBe('阿海');
    expect(normalizeEntityName('主角林远')).toBe('林远');
    expect(normalizeEntityName('灯塔')).toBe('灯塔');
    // 不在角色词表里的地名不应被误切
    expect(normalizeEntityName('老城区')).toBe('老城区');
    expect(normalizeEntityName('（无名称）')).toBe('（无名称）');
  });

  it('声明「阿海」正文写「张海」→ 合并成一条疑似改名，而不是两条噪音', () => {
    const r = checkConsistency([
      { seq: 1, title: '第一章', entities: ['向导阿海（NPC）'], content: '张海在码头等他，雨很大。' },
    ]);
    const variants = r.issues.filter((i) => i.kind === 'name-variant');
    expect(variants).toHaveLength(1);
    expect(variants[0].message).toContain('阿海');
    expect(variants[0].message).toContain('张海');
    // 合并后不应再单独出现「漏写」与「未登记」两条
    expect(r.issues.filter((i) => i.kind === 'missing-entity')).toHaveLength(0);
    expect(r.issues.filter((i) => i.kind === 'unregistered-entity')).toHaveLength(0);
  });

  it('统计口径：章数与字数', () => {
    const r = checkConsistency([
      { seq: 1, title: 'a', entities: [], content: '一二三四五' },
      { seq: 2, title: 'b', entities: [], content: '六七八' },
    ]);
    expect(r.chapters).toBe(2);
    expect(r.chars).toBe(8);
  });

  it('人名猜测不把常见词当人名', () => {
    const names = guessChineseNames('我们觉得这个可以，但是他还是不知道。');
    expect(names).not.toContain('我们');
    expect(names).not.toContain('可以');
    expect(names).not.toContain('还是');
  });
});
