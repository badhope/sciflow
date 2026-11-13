import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprint } from './fingerprint';

/**
 * 标题指纹回归。
 *
 * 缺陷：主归一化的字符类只认 ASCII 与 CJK 统一表意文字（\u4e00-\u9fff），
 * 遇到**不含汉字**的标题（纯谚文、纯假名）会把所有字符剥光 → norm 为空 → 返回 ''。
 * 调用方（references / knowledge 共 5 处）一律 `if (fp)` 守卫，于是这类文献的
 * 项目内去重**静默失效**：同一篇韩文/日文文献可被反复导入而不判重。
 *
 * 修复约束：fingerprint 已持久化在 references.fingerprint 列，主口径必须保持不变，
 * 否则历史行与新算法对不上，反而造成更大范围的漏判。因此兜底只在主口径为空时启用。
 */
describe('fingerprint：非汉字标题不再退化为空串', () => {
  it('纯谚文标题得到互不相同的稳定指纹', () => {
    const a = fingerprint('논문 제목 일');
    const b = fingerprint('논문 제목 이');
    expect(a).not.toBe('');
    expect(b).not.toBe('');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('纯假名标题得到互不相同的稳定指纹', () => {
    const a = fingerprint('かんじをふくまないかなのみのタイトル');
    const b = fingerprint('まったくべつのかなタイトル');
    expect(a).not.toBe('');
    expect(a).not.toBe(b);
  });

  it('带变音符的纯拉丁标题不再退化', () => {
    const a = fingerprint('Étude sur la littérature');
    expect(a).not.toBe('');
    expect(a).not.toBe(fingerprint('Étude sur la litterature'));
  });

  it('同一标题多次调用结果一致，且大小写/标点/空白不敏感', () => {
    const base = fingerprint('Deep Learning: A Survey!');
    expect(fingerprint('deep learning  a survey')).toBe(base);
    expect(fingerprint('DEEP LEARNING: A SURVEY!')).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });

  it('主口径不变：含汉字/ASCII 的标题指纹与历史算法逐字一致（无需数据迁移）', () => {
    // 历史算法：lowercase + 去除 [^a-z0-9\u4e00-\u9fff]，取 md5 前 16 位
    const legacy = (t: string) => {
      const norm = (t || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
      if (!norm) return '';
      return createHash('md5').update(norm).digest('hex').slice(0, 16);
    };
    const samples = [
      '深度学习 Deep Learning 研究',
      '异配图残差聚合方法',
      'Attention Is All You Need',
      'A/B Testing 2024 (Extended)',
      '研究v1.2',
    ];
    for (const s of samples) expect(fingerprint(s), s).toBe(legacy(s));
  });

  it('真正无内容的输入仍返回空串（调用方依赖该哨兵值跳过去重）', () => {
    expect(fingerprint('')).toBe('');
    expect(fingerprint('   ')).toBe('');
    expect(fingerprint('!!! ??? ---')).toBe('');
    expect(fingerprint(null as unknown as string)).toBe('');
  });
});
