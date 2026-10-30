import { describe, expect, it } from 'vitest';
import { checkPaperQuality } from './quality-audit';
import {
  QUALITY_STANDARDS,
  QUALITY_STANDARD_KEYS,
  countBoilerplate,
  parseQualityStandard,
  type QualityStandardKey,
} from './quality-standards';

/**
 * 多标准评分回归（v1.9.4）。
 *
 * 背景：用户实测反馈「打分太潦草——像相对论这种级别才满分，怎么可能这么多高分」。
 * 基准确认：旧口径下 2000 字无引用稿拿 67 分、凑字数流水账拿 60 分、
 * 形式规整但内容空洞的稿子轻松过 80 分门禁——六个维度全是形式检查，没有内容密度。
 * 本次修复：① 阈值抽成五档可切换标准（默认 standard 收紧）；② 新增「引用强度」打折；
 * ③ 新增第 7 维「信息密度」（模板腔密度 + 章节均衡）。本文件锁定这些行为的阈值语义。
 */

// 结构完整但内容空洞的稿子（旧口径 67 分的元凶）。
// 每章正文重复扩展到 ~1200 字：模拟「字数够了、格式齐了、但每句都是套话」的真实产物形态
// （直接复制 5 章会产生 25 个碎章 + 触发过短硬伤，无法代表真实场景）。
const HOLLOW_SECTION = (body: { title: string; text: string }) => `## ${body.title}\n\n${body.text.repeat(12)}\n`;

const HOLLOW_RAW = [
  {
    title: '引言',
    text: '近年来，图神经网络的发展受到广泛关注，具有重要的理论意义和现实价值。综上所述，该领域为研究者提供了新的思路。随着研究的不断深入，其作用愈发关键。',
  },
  {
    title: '相关工作',
    text: '随着深度学习的不断发展，图表示学习方法层出不穷。值得注意的是，该类方法表明结构信息可以利用，为后续研究提供了新的视角。',
  },
  {
    title: '方法',
    text: '本文采用消息传递框架，为该问题提供了新的途径，起到了关键的作用。该框架具有重要的理论意义，是不言而喻的。',
  },
  {
    title: '结果与讨论',
    text: '随着数据规模的不断发展，该框架展现出良好的性能，具有重要的意义。毋庸置疑，这为该方向奠定了坚实基础。',
  },
  {
    title: '结论',
    text: '综上所述，本文的工作具有重要意义，为后续研究提供了新的视角。随着应用的不断推广，其价值将更加凸显。',
  },
];
const HOLLOW = HOLLOW_RAW.map(HOLLOW_SECTION).join('\n');
const HOLLOW_X6 = HOLLOW; // 每章已扩展，总 ~2000+ 字、5 章均衡

describe('评审标准档位（quality-standards）', () => {
  it('五档标准齐备且关键字段递进（draft 最松、strict/review 最严）', () => {
    expect(QUALITY_STANDARD_KEYS).toEqual(['draft', 'standard', 'strict', 'review', 'conference']);
    const minChars = QUALITY_STANDARD_KEYS.map((k) => QUALITY_STANDARDS[k].minChars);
    expect(Math.min(...minChars)).toBe(QUALITY_STANDARDS.draft.minChars);
    expect(QUALITY_STANDARDS.strict.minChars).toBeGreaterThan(QUALITY_STANDARDS.standard.minChars);
    // 综述档引用要求最高（综述的本质就是引用网络）
    const uniq = QUALITY_STANDARD_KEYS.map((k) => QUALITY_STANDARDS[k].minUniqueCitations);
    expect(Math.max(...uniq)).toBe(QUALITY_STANDARDS.review.minUniqueCitations);
  });

  it('parseQualityStandard：合法值透传、非法值回落 standard（fail-closed）', () => {
    expect(parseQualityStandard('strict').key).toBe('strict');
    expect(parseQualityStandard('STRICT').key).toBe('strict'); // 大小写归一
    expect(parseQualityStandard('不存在的档').key).toBe('standard');
    expect(parseQualityStandard(undefined).key).toBe('standard');
    expect(parseQualityStandard('').key).toBe('standard');
  });

  it('countBoilerplate：命中典型套话且不误伤正常学术表述', () => {
    const boiler = '随着深度学习的不断发展，该方法受到广泛关注。综上所述，其具有重要意义。众所周知，效果显著。';
    expect(countBoilerplate(boiler)).toBeGreaterThanOrEqual(4);
    const solid = '消息传递范式将邻域聚合分解为消息生成、聚合与更新三步。该分解使每一步的归纳偏置可以被独立分析。';
    expect(countBoilerplate(solid)).toBe(0);
  });
});

describe('checkPaperQuality 多标准', () => {
  it('信息密度维真实生效：满篇套话的空洞稿密度维被打到接近 0（旧口径该维度不存在）', () => {
    const r = checkPaperQuality(HOLLOW_X6, { citationCount: 0, externalRefs: true });
    const density = r.dimensions.find((d) => d.key === 'density')!;
    expect(r.stats.boilerplateHits).toBeGreaterThan(100);
    expect(density.score).toBeLessThanOrEqual(10);
    expect(density.evidence.some((e) => e.includes('模板腔'))).toBe(true);
    // 引用 0 + 篇幅不足 + 信息空洞三重叠加 → 总分必须低于旧口径同文本的 67
    expect(r.totalScore).toBeLessThan(67);
  });

  it('标准越严分数越低：同一篇稿 draft ≥ standard ≥ strict 单调不增', () => {
    const scores = (['draft', 'standard', 'strict'] as QualityStandardKey[]).map((k) => ({
      key: k,
      r: checkPaperQuality(HOLLOW_X6, { citationCount: 0, externalRefs: true, standard: k }),
    }));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i].r.totalScore).toBeLessThanOrEqual(scores[i - 1].r.totalScore);
    }
  });

  it('高质量长文在 strict 档也能拿高分（引用强度充足、章节均衡、无套话时不再误伤）', () => {
    // 每章用不同句子（避免触发重复段落硬伤）、章节长度均衡、32 篇唯一引用
    const sectionBodies: Record<string, string> = {
      引言: '图结构数据广泛存在于分子建模与推荐系统中，其非欧几里得特性使传统卷积算子难以直接适用。图神经网络以节点间的消息传递为核心机制，为这类数据提供了端到端的表示学习框架，并已在多个基准任务上取得稳定收益。',
      相关工作: '谱域方法从图拉普拉斯出发推导卷积算子，计算复杂度受特征分解制约。空域方法直接在邻域上定义聚合规则，GraphSAGE 以邻居采样控制计算量，GAT 引入注意力权重区分邻居贡献，两类路线在基准数据集上互有胜负。',
      方法: '本文以消息生成、邻域聚合与状态更新三步刻画统一框架，聚合算子与更新函数均可替换。为缓解深层网络的过平滑，每层引入残差连接与层间归一化，并在训练期对边做随机丢弃以增强泛化。',
      实验: '在引文网络基准上，主流图卷积方法的节点分类准确率普遍高于多层感知机基线。消融实验显示聚合算子的选择贡献最大，注意力机制在稠密图上的增益更明显，稀疏图上则可能被噪声抵消。',
      讨论: '一阶消息传递在表达力上存在理论上界，无法区分部分非同构子结构，高阶结构编码被视为突破路径。大图上的采样效率与分布式训练仍是工程瓶颈，动态图与异质图缺乏统一评测协议。',
      结论: '本文以消息传递为主线梳理了方法谱系，并讨论了表达力上界与工程瓶颈两个开放问题。未来工作将围绕高阶结构编码与统一评测基准展开，同时探索更可解释的聚合机制。',
    };
    let body = '';
    for (const [title, text] of Object.entries(sectionBodies)) {
      body += `## ${title}\n\n${text.repeat(6)}\n\n`;
    }
    for (let i = 1; i <= 32; i++) body += `代表性工作见文献[${i}]。`;
    const r = checkPaperQuality(body, { citationCount: 32, externalRefs: true, standard: 'strict' });
    expect(r.standard.key).toBe('strict');
    expect(r.hardFails).toEqual([]);
    expect(r.totalScore).toBeGreaterThanOrEqual(75);
  });

  it('门禁及格线随标准变化（报告必须带 standard 元数据）', () => {
    for (const k of QUALITY_STANDARD_KEYS) {
      const r = checkPaperQuality(HOLLOW_X6, { standard: k });
      expect(r.standard.key).toBe(k);
      expect(r.standard.passScore).toBe(QUALITY_STANDARDS[k].passScore);
    }
  });

  it('旧调用（不传 standard）回落默认 standard 档且 minChars 覆盖仍生效（向后兼容）', () => {
    const r = checkPaperQuality(HOLLOW_X6, { citationCount: 0, externalRefs: true, minChars: 200, minSections: 2 });
    expect(r.standard.key).toBe('standard');
    // 显式 minChars 覆盖后篇幅维度不再被 4500 下限压死
    const length = r.dimensions.find((d) => d.key === 'length')!;
    expect(length.score).toBeGreaterThan(0);
  });
});
