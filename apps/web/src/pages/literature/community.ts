/**
 * Label Propagation 社区检测（F-2.3）。
 *
 * 用途：文献引用网络里把"互相引用紧密"的文献聚成社区，用颜色区分，
 * 比单纯按期刊着色更能反映研究主题聚类。
 *
 * 为什么手写：需求是「无向图的快速社区划分」，label propagation 本体只有 ~40 行；
 * 引入 graphology-communities-louvain 会多一个依赖，而这里对精度要求不高
 * （只要视觉上能把明显聚簇分开）。按 §7 守则，几行纯算法不引库。
 *
 * 算法：
 *  1. 每个节点初始化独立标签
 *  2. 反复让每个节点采纳「邻居中出现最多的标签」（并列时保留原标签，保证稳定）
 *  3. 直到标签不再变化或达到最大轮数
 *
 * 确定性：按节点 id 排序后遍历，不依赖 Map 插入顺序，保证同一图每次结果一致。
 */

export interface LabelGraph {
  nodes(): string[];
  neighbors(id: string): string[];
}

const MAX_ROUNDS = 20;

export function labelPropagation(graph: LabelGraph): Map<string, number> {
  // 稳定遍历顺序：排序后处理，避免不同引擎的 Map 顺序差异导致结果抖动
  const nodes = [...graph.nodes()].sort();
  const label = new Map<string, string>();
  for (const n of nodes) label.set(n, n);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const n of nodes) {
      const counts = new Map<string, number>();
      for (const nb of graph.neighbors(n)) {
        const l = label.get(nb);
        if (!l) continue; // 邻居不在图中（防御）
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      if (counts.size === 0) continue;

      // 取票数最高的标签；并列时保留当前标签（避免来回震荡）
      let best = label.get(n)!;
      let bestCount = counts.get(best) ?? 0;
      for (const [l, c] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (c > bestCount) {
          best = l;
          bestCount = c;
        }
      }
      if (best !== label.get(n)) {
        label.set(n, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 标签字符串 → 连续整数（按首次出现顺序，保证颜色索引稳定）
  const toIndex = new Map<string, number>();
  const result = new Map<string, number>();
  for (const n of nodes) {
    const l = label.get(n)!;
    if (!toIndex.has(l)) toIndex.set(l, toIndex.size);
    result.set(n, toIndex.get(l)!);
  }
  return result;
}

/** 便于测试/展示：返回 社区号 → 节点列表 */
export function groupByCommunity(labels: Map<string, number>): Map<number, string[]> {
  const out = new Map<number, string[]>();
  // 按社区号升序，社区内按文献 id 稳定排序（历史实现误用 key(id) 排序，sort 形同虚设）
  for (const [id, c] of [...labels.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))) {
    const arr = out.get(c);
    if (arr) arr.push(id);
    else out.set(c, [id]);
  }
  return out;
}
