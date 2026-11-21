import { describe, it, expect } from 'vitest';
import { formatCitation } from './documents.service';

const ref = {
  title: 'Graph Neural Networks: A Review',
  authors: JSON.stringify(['Thomas Kipf', 'Max Welling', 'Petar Velickovic']),
  year: 2021,
  venue: 'IEEE TPAMI',
  doi: '10.1109/TPAMI.2021.123456',
};

/**
 * 说明：引用格式化现走 citation-js CSL 引擎（csl-register.ts 注册官方补缺样式）。
 * 与旧手写渲染器的差异（本 spec 断言新行为，即 CSL 标准行为）：
 *  - APA 参考文献列表列全作者（et al. 仅用于文内引注，书目列表不省略）；
 *  - CSL 不虚构作者（无 Anonymous）、年份缺失按 zh-CN 渲染为「(不详)」；
 *  - 顺序编码制（IEEE/GB-T/Vancouver/Nature/ACS）由官方样式自带编号，
 *    formatCitation 剥离单条渲染的 [1] 后重写为全局序号。
 */
describe('formatCitation 引用格式化（citation-js CSL 引擎）', () => {
  it('APA：全作者列表 + (年份) + 期刊 + DOI URL', () => {
    const out = formatCitation(ref, 'apa', 0);
    expect(out).toContain('Kipf, T.');
    expect(out).toContain('(2021)');
    expect(out).toContain('IEEE TPAMI');
    expect(out).toContain('https://doi.org/10.1109/TPAMI.2021.123456');
  });

  it('IEEE：全局序号 [n] + 姓 + 名首字母缩写', () => {
    const out = formatCitation(ref, 'ieee', 3);
    expect(out).toMatch(/^\[3\] /);
    expect(out).toContain('T. Kipf');
    expect(out).toContain('M. Welling');
  });

  it('Vancouver：全局序号 [n] + 姓 名首字母（无点）+ 年份', () => {
    const out = formatCitation(ref, 'vancouver', 7);
    expect(out).toMatch(/^\[7\] /);
    expect(out).toContain('Kipf T');
    expect(out).toContain('2021');
  });

  it('GB/T 7714（国标）：全局序号 + 姓全大写 + 文献类型标识 [J]', () => {
    const out = formatCitation(ref, 'gbt', 1);
    expect(out).toMatch(/^\[1\] /);
    expect(out).toContain('KIPF T');
    expect(out).toContain('[J]');
  });

  it('GB/T 7714 别名（gb7714 / gb-t-7714 / gbt7714）归一后仍渲染国标，不回退 APA', () => {
    for (const alias of ['gb7714', 'gb-t-7714', 'gbt7714', 'GB/T 7714']) {
      const out = formatCitation(ref, alias, 1);
      expect(out).toMatch(/^\[1\] /);
      expect(out).toContain('KIPF T');
      expect(out).toContain('[J]');
    }
  });

  it('空作者/无年份：CSL 不虚构作者，zh-CN 年份渲染为（不详）', () => {
    const out = formatCitation({ ...ref, authors: '[]', year: null as unknown as number }, 'apa', 0);
    expect(out).toContain('Graph Neural Networks: A Review');
    expect(out).toContain('(不详)');
    expect(out).not.toContain('et al.');
  });

  it('单作者 APA：作者正常列出，书目不追加 et al.', () => {
    const out = formatCitation({ ...ref, authors: JSON.stringify(['Thomas Kipf']) }, 'apa', 0);
    expect(out).toContain('Kipf, T.');
    expect(out).not.toContain('et al.');
  });

  it('8 种引用样式全部可渲染（官方补缺样式注册回归防护）', () => {
    const styles = ['apa', 'ieee', 'vancouver', 'gbt', 'nature', 'chicago', 'springer', 'acs'];
    for (const style of styles) {
      const out = formatCitation(ref, style, 1);
      expect(out).toBeTruthy();
      expect(out).toContain('Graph Neural Networks: A Review');
    }
  });
});
