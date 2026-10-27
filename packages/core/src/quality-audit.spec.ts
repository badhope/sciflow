import { describe, expect, it } from 'vitest';
import { checkPaperQuality } from './quality-audit';

/**
 * 客观质量检查器契约：确定性（同输入同分数）+ 硬伤封顶 + 各维度真实扣分。
 *
 * 这组测试的核心是「不许注水」：把同一篇文章跑 100 次必须分数完全一致；
 * 删掉引用、塞入占位符、拉长句子必须分别扣对应维度。
 */

const GOOD_PAPER = `## 引言

图神经网络在节点分类任务中被广泛采用。已有研究表明消息传递机制能够聚合邻居信息[1]，但深层堆叠会导致过平滑[2]。本文提出一种残差聚合方案以缓解该问题。

## 相关工作

主流方法包括 GCN[1]、GAT[2] 与 GraphSAGE[3]。其中 GCN 使用对称归一化邻接矩阵[1]，GAT 引入注意力权重[2]，GraphSAGE 采用采样聚合[3]。三者在同配图上的表现接近，但在异配图上差异明显。

## 方法

本文在每一层引入可学习的残差权重，将当前层表示与上一层表示按比例混合。给定节点表示 h，更新规则为加权求和，权重由节点度数与层数共同决定。为进一步稳定训练，采用层归一化与跳跃连接。

## 实验

在 Cora、Citeseer 与 Pubmed 三个数据集上进行评测。基线包括 GCN[1]、GAT[2] 与 GraphSAGE[3]。评价指标为分类准确率，每种配置运行五次取均值。结果显示残差聚合在同配图上与基线持平，在异配图上提升约两个百分点。

## 讨论

提升主要来自深层网络的梯度传播改善。局限性在于仅在三个引文网络上验证，尚未覆盖大规模异配图。未来工作将扩展到 Open Graph Benchmark 并比较更多聚合算子。

## 结论

本文提出的残差聚合方案在保持同配图性能的同时改善了深层网络的异配图表现。代码与实验配置将随论文公开，便于复现。

## 参考文献

[1] Kipf T N, Welling M. Semi-supervised classification with graph convolutional networks. ICLR, 2017.
[2] Veličković P, et al. Graph attention networks. ICLR, 2018.
[3] Hamilton W L, et al. Inductive representation learning on large graphs. NeurIPS, 2017.
`;

describe('checkPaperQuality 确定性', () => {
  it('同一文本运行 100 次分数与指纹完全一致', () => {
    const first = checkPaperQuality(GOOD_PAPER);
    for (let i = 0; i < 100; i++) {
      const r = checkPaperQuality(GOOD_PAPER);
      expect(r.totalScore).toBe(first.totalScore);
      expect(r.fingerprint).toBe(first.fingerprint);
      expect(r.dimensions.map((d) => d.score)).toEqual(first.dimensions.map((d) => d.score));
    }
  });

  it('输出包含五个维度与统计口径', () => {
    const r = checkPaperQuality(GOOD_PAPER);
    expect(r.dimensions.map((d) => d.key)).toEqual(['structure', 'length', 'citation', 'readability', 'rigor', 'integrity']);
    expect(r.stats.sections).toBeGreaterThanOrEqual(6);
    expect(r.stats.uniqueCitations).toBe(3);
    expect(r.stats.referenceEntries).toBe(3);
    expect(r.hardFails).toEqual([]);
  });

  it('质量良好的样稿达到较高分（≥75）', () => {
    const r = checkPaperQuality(GOOD_PAPER, { minChars: 200 });
    expect(r.totalScore).toBeGreaterThanOrEqual(75);
  });
});

describe('checkPaperQuality 硬伤与扣分', () => {
  it('占位符 → 硬伤且总分封顶 40', () => {
    const r = checkPaperQuality(GOOD_PAPER.replace('本文提出一种残差聚合方案以缓解该问题。', '（待补）'));
    expect(r.hardFails.some((f) => f.includes('占位'))).toBe(true);
    expect(r.totalScore).toBeLessThanOrEqual(40);
  });

  it('正文有锚点、无内嵌列表且 citation 表为空 → 硬伤（符合仓库引用契约）', () => {
    const noRefs = GOOD_PAPER.split('## 参考文献')[0];
    // 不传 citationCount = citation 表未知/为空 → 无来源可渲染 → 硬伤
    const r = checkPaperQuality(noRefs);
    expect(r.hardFails.some((f) => f.includes('没有对应参考文献'))).toBe(true);
    expect(r.totalScore).toBeLessThanOrEqual(40);
  });

  it('正文无内嵌列表但 citation 表有记录 → 不算硬伤（列表由前端/导出渲染）', () => {
    const noRefs = GOOD_PAPER.split('## 参考文献')[0];
    const r = checkPaperQuality(noRefs, { citationCount: 3 });
    expect(r.hardFails.some((f) => f.includes('没有对应参考文献'))).toBe(false);
    expect(r.stats.referenceEntries).toBe(3);
    const cite = r.dimensions.find((d) => d.key === 'citation')!;
    expect(cite.score).toBeGreaterThanOrEqual(18);
  });

  it('悬空引用（[9] 无对应条目）→ 硬伤并点出编号', () => {
    const r = checkPaperQuality(GOOD_PAPER.replace('已有研究表明消息传递机制能够聚合邻居信息[1]', '已有研究表明消息传递机制能够聚合邻居信息[9]'));
    expect(r.hardFails.some((f) => f.includes('9'))).toBe(true);
  });

  it('无任何引用 → 引用维度 0 分', () => {
    const noCite = GOOD_PAPER.replace(/\[\d\]/g, '');
    const r = checkPaperQuality(noCite);
    const cite = r.dimensions.find((d) => d.key === 'citation')!;
    expect(cite.score).toBe(0);
    expect(cite.evidence.join()).toContain('无任何');
  });

  it('篇幅不足 → 篇幅维度低分', () => {
    const short = '## 引言\n\n太短了。\n\n## 方法\n\n也短。\n\n## 结果\n\n短。\n\n## 讨论\n\n短。\n\n## 结论\n\n短。\n\n## 参考文献\n\n[1] x.\n';
    const r = checkPaperQuality(short, { minChars: 3000 });
    const len = r.dimensions.find((d) => d.key === 'length')!;
    expect(len.score).toBeLessThanOrEqual(6);
  });

  it('超长句与超长段落 → 可读性扣分且有证据', () => {
    const longSentence = '这是一句非常长的句子'.repeat(12) + '。';
    const doc = `## 引言\n\n${longSentence}\n\n## 方法\n\n内容。\n\n## 结果\n\n内容。\n\n## 讨论\n\n内容。\n\n## 结论\n\n内容。\n\n## 参考文献\n\n[1] x.\n`;
    const r = checkPaperQuality(doc, { minChars: 10 });
    const read = r.dimensions.find((d) => d.key === 'readability')!;
    expect(read.evidence.join()).toMatch(/句长|超长段落/);
    expect(read.score).toBeLessThan(20);
  });

  it('强断言过多 → 严谨维度扣分', () => {
    const doc = GOOD_PAPER.replace('## 讨论\n', '## 讨论\n\n这充分证明该方法必然有效，毫无疑问，毋庸置疑，完全证明。\n\n');
    const r = checkPaperQuality(doc);
    const rigor = r.dimensions.find((d) => d.key === 'rigor')!;
    expect(rigor.score).toBeLessThan(20);
    expect(rigor.evidence.join()).toContain('强断言');
  });

  it('空文本 → 0 分且不留假绿灯', () => {
    const r = checkPaperQuality('');
    expect(r.totalScore).toBe(0);
    expect(r.stats.chars).toBe(0);
  });

  it('多组重复段落 → 硬伤', () => {
    const para = '这是一段被重复粘贴的正文内容，用于检测回炉叠加导致的重复段落问题。';
    const doc = GOOD_PAPER.replace('## 讨论\n', `## 讨论\n\n${para}\n\n${para}\n\n${para}\n\n${para}\n\n`);
    const r = checkPaperQuality(doc);
    expect(r.hardFails.some((f) => f.includes('重复段落'))).toBe(true);
  });
});

describe('checkPaperQuality 长篇零引用', () => {
  it('5000 字以上无任何引用 → 硬伤', () => {
    const filler = '这是一段没有任何引用的长篇正文，用于验证长篇零引用必须被判硬伤。'.repeat(200);
    const body = ['## 引言', '', filler, '', '## 方法', '', '内容。', '', '## 结果', '', '内容。', '', '## 讨论', '', '内容。', '', '## 结论', '', '内容。'].join(String.fromCharCode(10));
    const r = checkPaperQuality(body);
    expect(r.stats.chars).toBeGreaterThan(5000);
    expect(r.hardFails.some((f) => f.includes('没有任何 [n] 引用锚点'))).toBe(true);
  });
});

describe('checkPaperQuality 学术诚信（名实相符）', () => {
  const fabricate = (extra: string) =>
    GOOD_PAPER.replace('## 结论\n', `## 结论\n\n${extra}\n`).replace('## 实验\n', '## 实验\n\n本节不报告新的原始实验，仅归纳已有研究发现。\n');

  it('自述无原始实验却声称「实验结果表明优于基线」→ 硬伤且封顶 40', () => {
    const doc = fabricate('实验结果表明，该方法在真实与合成异配图上均取得了优于基线方法的性能，验证了所提框架的有效性。');
    const r = checkPaperQuality(doc, { minChars: 200 });
    expect(r.hardFails.some((f) => f.includes('名实不符'))).toBe(true);
    expect(r.totalScore).toBeLessThanOrEqual(40);
    expect(r.dimensions.find((d) => d.key === 'integrity')!.score).toBe(0);
  });

  it('同稿把结论改为「本综述归纳了…」→ 不判硬伤', () => {
    const doc = fabricate('本综述归纳了现有研究在异配图上的主要发现，并指出证据边界。');
    const r = checkPaperQuality(doc, { minChars: 200 });
    expect(r.hardFails.some((f) => f.includes('名实不符'))).toBe(false);
  });

  it('真有结果表与数值指标的实验稿 → 不误伤', () => {
    const doc = GOOD_PAPER.replace('## 讨论\n', '## 讨论\n\n| 模型 | Cora | 异配图 |\n| --- | --- | --- |\n| GCN | 81.5 | 62.3 |\n| 本文 | 82.1 | 68.7 |\n');
    const r = checkPaperQuality(doc, { minChars: 200 });
    expect(r.hardFails.some((f) => f.includes('名实不符'))).toBe(false);
  });

  it('诚信维度计入总分归一（六维等权）', () => {
    const r = checkPaperQuality(GOOD_PAPER, { minChars: 200 });
    expect(r.dimensions).toHaveLength(6);
    expect(r.dimensions.find((d) => d.key === 'integrity')!.score).toBeGreaterThanOrEqual(10);
    expect(r.totalScore).toBeGreaterThanOrEqual(75);
  });
});

describe('checkPaperQuality 换行鲁棒性（CRLF）', () => {
  it('LF 与 CRLF 文本必须得到同一分数与指纹', () => {
    const lf = checkPaperQuality(GOOD_PAPER, { minChars: 200 });
    const crlf = checkPaperQuality(GOOD_PAPER.replace(/\n/g, '\r\n'), { minChars: 200 });
    expect(crlf.totalScore).toBe(lf.totalScore);
    expect(crlf.fingerprint).toBe(lf.fingerprint);
    expect(crlf.stats.sections).toBe(lf.stats.sections);
  });

  it('指标后面跟 [n] 引用编号不算实验数据证据', () => {
    const doc = GOOD_PAPER
      .replace('## 结论\n', '## 结论\n\n实验结果表明，该方法取得了优于基线的性能，验证了框架的有效性。\n')
      .replace('## 实验\n', '## 实验\n\n本节不报告新的原始实验，仅归纳已有研究。评价指标采用准确率与宏平均F1分数[1][2][3]。\n');
    const r = checkPaperQuality(doc, { minChars: 200 });
    expect(r.hardFails.some((f) => f.includes('名实不符'))).toBe(true);
  });
});

describe('checkPaperQuality 结构按文章类型判定', () => {
  const REVIEW_PAPER = `## 引言

异配图节点分类是图学习的重要任务[1]。已有研究指出同配假设在异配图上会失效[2]。

## 相关工作与文献综述

已有工作从聚合方式[1]、残差连接[3]与结构学习[2]三个方向展开。

## 机理分析框架

本节从误差分解角度构建分析框架，指出聚合误差可分为随机误差与结构性偏差[2][3]。

## 评估协议设计

本节不报告新的原始实验，而是给出可执行的评估协议设计，包括数据集选择、划分与指标定义[1]。

## 讨论

框架的适用边界取决于异配程度与标签噪声水平[2]。

## 结论

本框架统一了现有设计视角，未开展新的原始实验，后续需实证检验。

## 参考文献

[1] Kipf T N, Welling M. Semi-supervised classification with graph convolutional networks. ICLR, 2017.
[2] Zhu J, et al. Beyond Homophily in Graph Neural Networks. NeurIPS, 2020.
[3] Xu K, et al. Representation learning on graphs with jumping knowledge networks. ICML, 2018.
`;

  it('综述/框架类（自述无原始实验）不因缺「方法/结果」章节扣结构分', () => {
    const r = checkPaperQuality(REVIEW_PAPER, { minChars: 200 });
    const s = r.dimensions.find((d) => d.key === 'structure')!;
    expect(s.score).toBe(20);
    expect(s.evidence.join()).toContain('综述/框架类要素');
  });

  it('实证类（有结果表）仍要求 方法/结果 章节', () => {
    const empirical = GOOD_PAPER.replace('## 方法\n', '## 方法\n\n| 模型 | 准确率 |\n| --- | --- |\n| GCN | 81.5% |\n');
    const r = checkPaperQuality(empirical, { minChars: 200 });
    const s = r.dimensions.find((d) => d.key === 'structure')!;
    expect(s.score).toBe(20);
    expect(s.evidence.join()).toContain('IMRaD');
  });
});

describe('checkPaperQuality 正则状态隔离', () => {
  it('同一输入连续 50 次调用，结构维度与硬伤必须恒定（防 /g lastIndex 污染）', () => {
    const doc = GOOD_PAPER.replace('## 实验\n', '## 实验\n\n本节不报告新的原始实验，仅归纳已有研究。\n');
    const first = checkPaperQuality(doc, { minChars: 200 });
    for (let i = 0; i < 50; i++) {
      const r = checkPaperQuality(doc, { minChars: 200 });
      expect(r.dimensions.find((d) => d.key === 'structure')!.score).toBe(first.dimensions.find((d) => d.key === 'structure')!.score);
      expect(r.hardFails.length).toBe(first.hardFails.length);
      expect(r.totalScore).toBe(first.totalScore);
    }
  });
});

describe('checkPaperQuality 纯正文文件（externalRefs）', () => {
  const bodyOnly = GOOD_PAPER.replace(/## 参考文献[\s\S]*$/, '');

  it('默认（库内文档契约缺失）判硬伤：正文有锚点却无任何来源', () => {
    const r = checkPaperQuality(bodyOnly, { minChars: 200 });
    expect(r.hardFails.some((f) => f.includes('没有对应参考文献'))).toBe(true);
  });

  it('externalRefs=true（列表由前端/导出渲染）不判硬伤', () => {
    const r = checkPaperQuality(bodyOnly, { minChars: 200, externalRefs: true });
    expect(r.hardFails.some((f) => f.includes('没有对应参考文献'))).toBe(false);
    expect(r.dimensions.find((d) => d.key === 'citation')!.evidence.join()).toContain('由前端/导出渲染');
  });
});
