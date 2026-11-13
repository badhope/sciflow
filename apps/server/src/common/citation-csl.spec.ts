import { describe, it, expect } from 'vitest';
import { toCslAuthors, cslSurname } from './citation-csl';

/**
 * 作者名解析回归：必须用 CSL 官方规则拆 family/given。
 * 历史手写 split(/\s+/) 会把 "Zhang, Wei" 拆成 family="Wei"，把
 * "van der Waals, Johannes" 拆成 family="Johannes"，参考文献排序与缩写全错。
 */
describe('CSL 作者名解析', () => {
  it('逗号式 "Zhang, Wei" → family=Zhang / given=Wei', () => {
    const [a] = toCslAuthors(JSON.stringify(['Zhang, Wei']));
    expect(a.family).toBe('Zhang');
    expect(a.given).toBe('Wei');
  });

  it('带前缀 "van der Waals, Johannes" → family=Waals + non-dropping-particle', () => {
    const [a] = toCslAuthors(JSON.stringify(['van der Waals, Johannes']));
    expect(a.family).toBe('Waals');
    expect(a['non-dropping-particle']).toBe('van der');
    expect(a.given).toBe('Johannes');
  });

  it('普通西文名 "Ludwig van Beethoven" → family=Beethoven', () => {
    const [a] = toCslAuthors(JSON.stringify(['Ludwig van Beethoven']));
    expect(a.family).toBe('Beethoven');
    expect(a.given).toBe('Ludwig');
    expect(a['non-dropping-particle']).toBe('van');
  });

  it('cslSurname 与 CSL 解析同口径', () => {
    expect(cslSurname('Zhang, Wei')).toBe('Zhang');
    expect(cslSurname('van der Waals, Johannes')).toBe('Waals');
    expect(cslSurname('柏拉图')).toBe('柏拉图');
  });
});
