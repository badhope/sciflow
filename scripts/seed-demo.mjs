#!/usr/bin/env node
/**
 * 演示数据种子（可重复执行，全部走公开 REST API，不直接改库）
 *
 * 用途：本机首次体验 / 文档截图 / 演示视频。所有数据均为虚构示例，不含真实密钥。
 * 前置：后端已启动（建议 AI_MOCK=1 使用全新库）。
 *   AI_MOCK=1 DATABASE_PATH=/tmp/sciflow_demo.db PORT=3000 node apps/server/dist/apps/server/src/main.js
 *   node scripts/seed-demo.mjs            # 默认 http://127.0.0.1:3000
 *   BASE=http://127.0.0.1:3200 node scripts/seed-demo.mjs
 *   RUN_PIPELINE=1 node scripts/seed-demo.mjs   # 额外跑一遍全自动流水线（mock 约 30s）
 */

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const RUN_PIPELINE = process.env.RUN_PIPELINE === '1';

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return data;
}

const CONTENT = `# 摘要

分子性质预测是计算药物发现的核心任务之一。本文系统梳理了图神经网络（Graph Neural Network, GNN）在该任务中的技术演进：从谱方法到消息传递框架的范式转变，注意力机制对邻居重要性的显式建模，以及自监督预训练对标注数据稀缺问题的缓解。通过对代表性工作的归纳与比较，本文总结了当前方法在分布外泛化、数据效率与可解释性三方面的共性局限，并指出将主动学习与不确定性量化引入分子表征学习的可行方向。

**关键词**：图神经网络；分子性质预测；消息传递；自监督预训练；药物发现

## 1 引言

虚拟筛选与先导化合物优化高度依赖对分子理化性质与生物活性的准确预测。传统定量构效关系（QSAR）方法依赖人工设计的分子指纹（如 ECFP），其表达能力受限于特征工程[3]。图神经网络将分子建模为原子-键图，通过端到端学习获得数据驱动的分子表征，近年来在多个基准数据集上取得了优于经典指纹方法的预测精度[4]。

本文的归纳框架与已有综述的区别在于：以「消息传递范式的表达能力边界」为主线组织文献，将自监督预训练视为缓解标注瓶颈的手段而非独立方向。本文的主要贡献点包括：（1）按监督信号类型对代表性 GNN 架构进行统一分类；（2）归纳各架构在分子任务上的适用条件；（3）指出评估协议层面被普遍忽视的分布外泛化问题。

## 2 消息传递框架

### 2.1 从谱方法到空间域消息传递

早期图卷积网络基于谱图理论定义卷积算子，依赖拉普拉斯矩阵的特征分解，跨图泛化能力受限。Kipf 与 Welling 提出的一阶近似（GCN）将卷积简化为邻接矩阵归一化后的线性聚合，使模型可在空间域直接实现，成为后续工作的基线架构[1]。

### 2.2 注意力与方向感知机制

GCN 对邻居采用均匀加权，忽略了原子在化学环境中的差异性。图注意力网络（GAT）引入注意力系数对邻居贡献进行显式建模[2]。在分子任务中，消息传递范式（MPNN）进一步将各类架构统一为「消息函数—聚合函数—更新函数」三要素，并被直接应用于量子化学性质预测[3]；有向消息传递（D-MPNN）区分边的起点与终点方向，在 MoleculeNet 系列数据集上优于基于指纹的基线[4]。

两类机制的适用条件不同：均匀加权在官能团效应均匀分布的场合足够有效；当分子的局部化学环境差异成为预测关键（如毒性位点识别）时，注意力与方向感知机制的收益更明显。这一区分在已有综述中较少被显式讨论，却是架构选型时的实际问题。

## 3 自监督预训练

标注分子数据的获取成本高（毒性、活性实验周期长），限制了监督方法的规模扩展。对比学习范式（如 MolCLR）通过构造正负样本对进行图表征预训练，在下游性质预测任务上带来了稳定的精度提升[5]。属性掩码与上下文预测等策略也被证明可在标注稀缺场景下学习可迁移的化学结构知识[3][5]。

预训练策略的选择与下游任务的数据规模相关：当下游标注充足时，从随机权重出发的监督训练与预训练初始化的差距缩小；当标注稀缺时，预训练带来的增益显著且稳定。这提示在评价预训练方法时，应同时报告不同标注比例下的表现，而不是只给单一数据规模的结论。

## 4 讨论：开放挑战与未来方向

### 4.1 分布外泛化

现有评估协议多以随机划分报告精度，难以反映骨架跳跃（scaffold split）下的真实泛化能力；已有工作表明，多数 GNN 在骨架外分子上的性能显著下降[4][5]。这一现象说明：单点的精度数字不足以支撑方法比较，评估协议本身（划分方式、指标选择、重复实验）需要规范化，否则方法之间的优劣判断不可靠。

### 4.2 数据效率与可解释性

主动学习可在固定实验预算下提升标注效率；不确定性估计（如深度集成）为预测置信度提供了可行路径，但其在虚拟筛选排序中的校准性仍缺乏系统研究。可解释性方面，注意力权重常被当作解释依据，但其与化学子结构重要性的对应关系尚未得到一致验证，把它作为唯一解释手段的做法需要谨慎[2][3]。

### 4.3 局限性

本综述的归纳基于公开文献，未涉及未发表数据与工业界内部基准；对生成式分子设计方向的覆盖不足；此外，文中引用的精度结论来自各原文自报的实验设置，横向比较时存在协议差异，读者应谨慎对待跨文献的数值对比。

## 5 结论

本文按监督信号类型归纳了 GNN 在分子性质预测中的代表性架构与预训练策略，并指出评估协议规范化是当前比模型结构创新更紧迫的问题。未来工作将把评估协议的规范化作为独立研究对象，并系统考察不确定性量化在虚拟筛选排序中的实际收益。

## 参考文献

[1] Kipf T N, Welling M. Semi-Supervised Classification with Graph Convolutional Networks. ICLR 2017 (arXiv:1609.02907).
[2] Veličković P, et al. Graph Attention Networks. ICLR 2018 (arXiv:1710.10903).
[3] Gilmer J, et al. Neural Message Passing for Quantum Chemistry. ICML 2017 (arXiv:1704.01212).
[4] Yang K, et al. Analyzing Learned Molecular Representations for Property Prediction. J. Chem. Inf. Model., 2019 (arXiv:1904.01561).
[5] Wang Z, et al. Molecular Contrastive Learning of Representations via Graph Neural Networks. arXiv:2102.10252.
`;

const REFS = [
  { title: 'Semi-Supervised Classification with Graph Convolutional Networks', authors: ['Thomas N. Kipf', 'Max Welling'], year: 2017, venue: 'ICLR 2017 (arXiv:1609.02907)', doi: '' },
  { title: 'Graph Attention Networks', authors: ['Petar Veličković', 'Guillem Cucurull', 'Arantxa Casanova', 'Adriana Romero', 'Pietro Liò', 'Yoshua Bengio'], year: 2018, venue: 'ICLR 2018 (arXiv:1710.10903)', doi: '' },
  { title: 'Neural Message Passing for Quantum Chemistry', authors: ['Justin Gilmer', 'Samuel S. Schoenholz', 'Patrick F. Riley', 'Oriol Vinyals', 'George E. Dahl'], year: 2017, venue: 'ICML 2017 (arXiv:1704.01212)', doi: '' },
  { title: 'Analyzing Learned Molecular Representations for Property Prediction', authors: ['Kevin Yang', 'Kyle Swanson', 'Wengong Jin', 'Connor Coley', 'Klavs F. Jensen', 'Regina Barzilay'], year: 2019, venue: 'J. Chem. Inf. Model. (arXiv:1904.01561)', doi: '' },
  { title: 'Molecular Contrastive Learning of Representations via Graph Neural Networks', authors: ['Zichen Wang', 'Huan Wang'], year: 2021, venue: 'arXiv:2102.10252', doi: '' },
];

async function main() {
  const projects = await call('GET', '/api/projects');
  if (projects.length) {
    console.log(`已有 ${projects.length} 个项目，跳过种子（避免污染现有数据）。需要干净演示库请换 DATABASE_PATH 重跑。`);
    return;
  }
  const project = await call('POST', '/api/projects', { name: 'GNN 药物发现研究' });
  console.log('project', project.id);

  // 演示库使用「草稿迭代」评审标准：与演示文档的体量匹配，展览分数自洽（真实库请按目标期刊选档）
  await call('POST', '/api/customization/pipeline-settings', { qualityStandard: 'draft' });

  const doc = await call('POST', '/api/documents', { projectId: project.id, title: 'GNN 药物发现综述' });
  await call('PATCH', `/api/documents/${doc.id}`, { content: CONTENT });

  for (const r of REFS) await call('POST', '/api/references', { projectId: project.id, hit: r });
  await call('POST', '/api/quality', { documentId: doc.id, title: 'GNN 药物发现综述', content: CONTENT });
  await call('POST', '/api/memory', {
    type: 'procedural', projectId: project.id,
    content: '写作偏好：先给结论，再给证据链；引用统一使用 [n] 锚点；术语首次出现给英文全称。',
    keywords: ['写作', '引用', '术语'],
  });
  await call('POST', '/api/submission/track', {
    projectId: project.id, journalName: '计算机学报', documentId: doc.id, currentStatus: 'submitted', note: '首投',
  });
  await call('POST', '/api/knowledge/upload', {
    projectId: project.id, name: '消息传递机制笔记.md', type: 'markdown',
    content: '消息传递机制：邻居聚合、更新与读出。GCN 使用归一化邻接矩阵；GAT 使用注意力权重。',
  });
  await call('POST', '/api/knowledge/upload', {
    projectId: project.id, name: '药物发现数据集笔记.md', type: 'markdown',
    content: '常用数据集：BBBP、Tox21、MUTAG、ogbg-molhiv。评估指标：ROC-AUC、PR-AUC。',
  });
  await call('POST', '/api/experiments/run', {
    projectId: project.id, goal: '验证消息传递聚合实现的数值稳定性',
    code: 'import math\nresult = sum(math.sqrt(i) for i in range(1,101))\nprint(f"sqrt(1..100) 之和 = {result:.4f}")',
  });
  await call('POST', '/api/research/design', {
    projectId: project.id,
    question: '时序感知聚合在动态图节点分类中是否优于均匀采样？',
  });
  console.log('seed done: 1 项目 / 1 文档 / 4 文献 / 1 质量报告 / 1 投稿 / 2 资料 / 1 实验 / 1 实验设计稿');

  if (RUN_PIPELINE) {
    const task = await call('POST', '/api/pipeline', { projectId: project.id, topic: '图神经网络在药物发现中的应用' });
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const t = await call('GET', `/api/pipeline/${task.id}`);
      if (t.status === 'awaiting_confirmation') await call('POST', `/api/pipeline/${task.id}/confirm-outline`, {});
      if (t.status === 'completed' || t.status === 'failed') {
        console.log('pipeline', t.status);
        return;
      }
    }
    console.log('pipeline still running（超时退出，可在流水线页查看）');
  }
}

main().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
