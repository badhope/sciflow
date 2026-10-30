/**
 * 可切换的论文质量评审标准（v1.9.4）。
 *
 * 为什么需要：原评分体系的六个维度全部是形式检查（结构/篇幅/引用闭环/可读性/修辞/诚信），
 * 且阈值过松——2000 字无引用的稿子能拿 67 分，凑字数流水账拿 60 分，
 * 一篇结构规整但内容空洞的稿子轻松过 80 分门禁。用户反馈：「像相对论这种级别才满分」。
 *
 * 设计：把阈值从 checkPaperQuality 的硬编码中抽成「标准档位」，用户按目标投稿场景选择：
 *  - draft      草稿迭代档：快速产出用，低门槛（≈旧行为）
 *  - standard   SCI 通用期刊档（默认）：多数 SCI/SSCI 期刊的现实门槛
 *  - strict     顶刊档（IEEE Trans / Nature 子刊级别）：满分必须达到顶刊可接收密度
 *  - review     综述档：综述类论文（引用强度要求最高）
 *  - conference 会议档（CCF-B/C 类）：篇幅短但引用密度仍有要求
 *
 * 全部阈值可确定性计算（零 LLM），同一文本同一标准必然同分——这是质量门可作门禁的前提。
 */

export type QualityStandardKey = 'draft' | 'standard' | 'strict' | 'review' | 'conference';

export interface QualityStandard {
  key: QualityStandardKey;
  label: string;
  description: string;
  /** 正文最少字符（去空白；低于该值的 40% 直接判过短硬伤的边界） */
  minChars: number;
  /** 篇幅满分线（≥ 该值篇幅维度 20/20） */
  fullChars: number;
  /** 最少二级章节数 */
  minSections: number;
  /** 最少唯一引用编号（正文 [n] 去重数；低于该值引用维度按比例打折） */
  minUniqueCitations: number;
  /** 平均每章最少引用数（低于按比例打折） */
  minCitationsPerSection: number;
  /** 平均句长上限（超过扣分） */
  maxAvgSentenceChars: number;
  /** 模板腔/套话密度上限（每千字；超过扣分）——「随着…的发展」「综上所述」类空转表述 */
  maxBoilerplatePerKilo: number;
  /** 章节均衡检查：最大章节占正文比例超过该值扣分（防止单章独大凑结构） */
  maxSectionShare: number;
  /** 质量门及格线（流水线 <80 回炉的阈值按标准缩放） */
  passScore: number;
}

export const QUALITY_STANDARDS: Record<QualityStandardKey, QualityStandard> = {
  draft: {
    key: 'draft',
    label: '草稿迭代',
    description: '快速迭代用：低门槛，只拦占位符/空文/名实不符等硬伤。对标系统内流水线首稿。',
    minChars: 2000,
    fullChars: 4000,
    minSections: 4,
    minUniqueCitations: 5,
    minCitationsPerSection: 0.5,
    maxAvgSentenceChars: 80,
    maxBoilerplatePerKilo: 12,
    maxSectionShare: 0.65,
    passScore: 70,
  },
  standard: {
    key: 'standard',
    label: 'SCI 通用期刊',
    description: '多数 SCI/SSCI 期刊的现实门槛：完整 IMRaD、充分文献支撑、均衡章节。',
    minChars: 4500,
    fullChars: 9000,
    minSections: 5,
    minUniqueCitations: 15,
    minCitationsPerSection: 1.5,
    maxAvgSentenceChars: 65,
    maxBoilerplatePerKilo: 8,
    maxSectionShare: 0.45,
    passScore: 80,
  },
  strict: {
    key: 'strict',
    label: '顶刊（IEEE Trans / Nature 子刊）',
    description: '顶刊可接收密度：长文、高引用强度、紧凑句式。满分 = 该级别可投稿。',
    minChars: 8000,
    fullChars: 14000,
    minSections: 6,
    minUniqueCitations: 30,
    minCitationsPerSection: 3,
    maxAvgSentenceChars: 50,
    maxBoilerplatePerKilo: 5,
    maxSectionShare: 0.38,
    passScore: 85,
  },
  review: {
    key: 'review',
    label: '综述（Survey / Review）',
    description: '综述类论文：覆盖面与引用强度要求最高，结构按综述要素判定。',
    minChars: 8000,
    fullChars: 15000,
    minSections: 6,
    minUniqueCitations: 40,
    minCitationsPerSection: 4,
    maxAvgSentenceChars: 60,
    maxBoilerplatePerKilo: 6,
    maxSectionShare: 0.4,
    passScore: 80,
  },
  conference: {
    key: 'conference',
    label: '会议论文（CCF-B/C）',
    description: '会议短文门槛：篇幅要求较低，但引用密度与结构完整性不打折。',
    minChars: 3000,
    fullChars: 6000,
    minSections: 4,
    minUniqueCitations: 10,
    minCitationsPerSection: 1.2,
    maxAvgSentenceChars: 65,
    maxBoilerplatePerKilo: 9,
    maxSectionShare: 0.5,
    passScore: 78,
  },
};

export const QUALITY_STANDARD_KEYS = Object.keys(QUALITY_STANDARDS) as QualityStandardKey[];

/** 合法性校验 + 归一（非法值回落 standard；DB 脏值 fail-closed） */
export function parseQualityStandard(v: unknown): QualityStandard {
  const key = String(v ?? '').trim().toLowerCase() as QualityStandardKey;
  return QUALITY_STANDARDS[key] ?? QUALITY_STANDARDS.standard;
}

/** 模板腔/套话（学术写作中最典型的「零信息量过渡句」标志） */
export const BOILERPLATE_PATTERNS = [
  /随着[^。；\n]{0,18}的(?:不断)?发展/g,
  /近年来[^。；\n]{0,10}受到(?:了)?(?:广泛|越来越多)的?(?:关注|重视)/g,
  /(?:具有|有着)重要的?(?:理论|现实|实践)?(?:意义|价值)/g,
  /综上所述/g,
  /众所周知/g,
  /毋庸置疑/g,
  /不言而喻/g,
  /值得注意的是，?(?:该|这|此)[^。；\n]{0,10}(?:表明|说明|意味着)/g,
  /起到[^。；\n]{0,8}(?:关键|重要|积极)的?作用/g,
  /为[^。；\n]{0,12}提供了(?:新|崭新)的?(?:思路|视角|途径|方向)/g,
];

/** 统计模板腔命中数（纯函数，供审计与单测共用） */
export function countBoilerplate(text: string): number {
  let n = 0;
  for (const re of BOILERPLATE_PATTERNS) {
    for (const _ of String(text || '').matchAll(re)) n += 1;
  }
  return n;
}
