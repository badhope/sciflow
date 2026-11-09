import { describe, expect, it } from 'vitest';
import { KnowledgeService } from './knowledge.service';

/**
 * FTS5 trigram 查询构造回归（纯函数，此前零测试覆盖）。
 *
 * 缺陷一（配额饿死）：`parts` 先塞全部拉丁词、再塞 CJK 三元组，最后 `[...new Set(parts)].slice(0, 24)`
 * 从头截断。于是**中英混合**问题里只要拉丁词 ≥24 个，中文三元组会被整段截掉——
 * 检索退化成「只搜英文」，中文那一半问题完全没参与召回，而 bm25 排序也看不到它们。
 * 用户看到的是「明明知识库里有这段中文，却搜不到」，且日志无任何异常。
 *
 * 缺陷二（文字系统覆盖）：CJK 段正则写死 `[一-鿿]`（仅 CJK 统一表意文字），
 * 纯假名 / 纯谚文的问题一个 token 都构造不出来 → 返回空串 → 直接掉到 LIKE 全表兜底，
 * trigram 索引形同虚设（与 fingerprint 曾经的问题是同一个字符类盲区）。
 */
describe('buildTrigramQuery：中英混合不得让中文部分被配额饿死', () => {
  it('拉丁词很多时，CJK 三元组仍然进入查询', () => {
    const manyLatin = Array.from({ length: 30 }, (_, i) => `token${i}xx`).join(' ');
    const q = KnowledgeService.buildTrigramQuery(`${manyLatin} 异配图残差聚合方法`);
    expect(q).toContain('"异配图"');
    expect(q).toContain('"残差聚"');
    // 两路信号都必须在场
    expect(q).toMatch(/"token\d+xx"/);
  });

  it('配额上限仍然生效（不会因为交错而放大查询体积）', () => {
    const manyLatin = Array.from({ length: 30 }, (_, i) => `token${i}xx`).join(' ');
    const q = KnowledgeService.buildTrigramQuery(`${manyLatin} 异配图残差聚合方法研究`);
    expect(q.split(' OR ')).toHaveLength(24);
  });

  it('纯中文问题：全部三元组按出现顺序展开', () => {
    const q = KnowledgeService.buildTrigramQuery('异配图');
    expect(q).toBe('"异配图"');
    expect(KnowledgeService.buildTrigramQuery('异配图谱')).toBe('"异配图" OR "配图谱"');
  });
});

describe('buildTrigramQuery：非汉字文字系统同样能构造 trigram', () => {
  it('纯假名问题不再退化为空串', () => {
    const q = KnowledgeService.buildTrigramQuery('かんじをふくまないタイトル');
    expect(q).not.toBe('');
    expect(q).toContain('"んじを"');
  });

  it('纯谚文问题不再退化为空串', () => {
    const q = KnowledgeService.buildTrigramQuery('연구방법론과 딥러닝모델');
    expect(q).not.toBe('');
    expect(q).toContain('"연구방"');
    expect(q.split(' OR ').length).toBeGreaterThan(1);
  });

  /**
   * trigram 的固有下限：连续段不足 3 字符时无法构造任何 token，必须回落 LIKE 兜底。
   * 谚文按词空格分隔、大量词是 2 音节（논문 / 제목），这类短查询走 LIKE 是**正确**行为，
   * 不是缺陷——FTS5 trigram 索引本身就无法匹配 <3 字符的串。
   */
  it('2 音节谚文词（不足 trigram 下限）返回空串，交由 LIKE 兜底', () => {
    expect(KnowledgeService.buildTrigramQuery('논문 제목')).toBe('');
  });
});

describe('buildTrigramQuery：既有行为不回归', () => {
  it('不足 3 字的中文查询返回空串（交给 LIKE 兜底，trigram 无法匹配）', () => {
    expect(KnowledgeService.buildTrigramQuery('图论')).toBe('');
    expect(KnowledgeService.buildTrigramQuery('')).toBe('');
    expect(KnowledgeService.buildTrigramQuery('   ')).toBe('');
  });

  it('拉丁词至少 3 字符才入词（trigram tokenizer 的硬约束）', () => {
    expect(KnowledgeService.buildTrigramQuery('a b cd abc')).toBe('"abc"');
  });

  it('输出是合法 FTS5 语法：每个 token 双引号包裹、OR 连接', () => {
    const q = KnowledgeService.buildTrigramQuery('深度学习 deep learning 与 (残差) 聚合');
    for (const term of q.split(' OR ')) expect(term).toMatch(/^".+"$/);
  });

  it('FTS5 元字符被清理，不会破坏查询语法', () => {
    const q = KnowledgeService.buildTrigramQuery('深度学习"引号" (括号) {花括号} #井号 ^脱字符');
    expect(q).not.toMatch(/[#^(){}]/);
    // 引号已被替换成空格，token 内部不得再出现裸引号
    for (const term of q.split(' OR ')) expect(term.slice(1, -1)).not.toContain('"');
  });

  it('重复 token 去重', () => {
    expect(KnowledgeService.buildTrigramQuery('abc abc abc')).toBe('"abc"');
  });
});
