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

const CONTENT = `# 引言

图神经网络（Graph Neural Network, GNN）在分子性质预测、虚拟筛选与药物-靶点相互作用预测中显著优于传统分子指纹方法[1]。分子天然表示为原子-键图，消息传递机制使模型能够在图上进行端到端表征学习[2]。

## 方法

### 消息传递框架

GCN 通过对归一化邻接矩阵聚合邻居信息；GAT 引入注意力权重区分邻居重要性；E(3) 等变网络进一步保证旋转平移等变[2]。

### 自监督预训练

属性掩码与对比学习在标注数据稀缺场景下带来稳定增益，已成为分子表征学习的主流范式[3]。

## 结论

数据稀缺、分布外泛化与可解释性仍是主要瓶颈，未来需要结合主动学习与不确定性估计[1][3]。
`;

const REFS = [
  { title: 'Graph Neural Networks: A Review', authors: ['Alice Zhang', 'Wei Wang'], year: 2020, venue: 'IEEE TKDE', doi: '10.1109/TKDE.2020.3047454' },
  { title: 'Message Passing in Molecular Graphs', authors: ['Bob Li'], year: 2021, venue: 'J. Chem. Inf. Model.', doi: '10.1021/acs.jcim.1c00123' },
  { title: 'Self-supervised Pretraining for Molecules', authors: ['Chen Yu', 'Dan Wu'], year: 2022, venue: 'Nature Machine Intelligence', doi: '10.1038/s42256-022-00456' },
  { title: 'GNN 讲义（消息传递）', authors: ['课程组'], year: 2023, venue: '课程讲义', doi: '' },
];

async function main() {
  const projects = await call('GET', '/api/projects');
  if (projects.length) {
    console.log(`已有 ${projects.length} 个项目，跳过种子（避免污染现有数据）。需要干净演示库请换 DATABASE_PATH 重跑。`);
    return;
  }
  const project = await call('POST', '/api/projects', { name: 'GNN 药物发现研究' });
  console.log('project', project.id);

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
    projectId: project.id, name: 'GNN 讲义（消息传递）.md', type: 'markdown',
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
