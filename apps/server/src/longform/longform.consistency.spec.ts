import { describe, it, expect } from 'vitest';
import { checkConsistency, guessChineseNames } from './longform.consistency';

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
