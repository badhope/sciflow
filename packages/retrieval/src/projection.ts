/**
 * 二维投影（PCA）— 用于知识库语义地图。
 *
 * 为什么手写而不是引 umap-js：需求只是「把 384 维向量压到 2D 看聚簇」，
 * UMAP/t-SNE 是几十 KB 起步的重依赖，而 PCA 这里只需 ~60 行线性代数，
 * 且结果稳定可复现（UMAP 有随机性，每次刷新图形会跳变）。
 * 若将来需要更好的局部结构保持，再按 §7 守则评估引入。
 *
 * 实现要点：
 *  - 先中心化（减去每维均值）
 *  - 用幂迭代求协方差矩阵前两个主成分（比完整特征分解快，且不需要依赖）
 *  - 输出归一化到 [0,1] 便于前端直接映射像素
 */

export interface ProjectedPoint {
  x: number;
  y: number;
}

/** 向量点积 */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 向量归一化（零向量返回原样） */
function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** 用幂迭代求矩阵乘向量的主特征向量 */
function powerIterate(
  applyMatrix: (v: number[]) => number[],
  dim: number,
  seed: number,
  iterations = 60,
): number[] {
  // 确定性初始化（不用 Math.random，保证同一输入每次投影结果一致）
  let v: number[] = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.7);
  v = normalize(v);
  for (let it = 0; it < iterations; it++) {
    const next = applyMatrix(v);
    const norm = Math.sqrt(dot(next, next));
    if (norm < 1e-12) break;
    for (let i = 0; i < dim; i++) next[i] /= norm;
    v = next;
  }
  return v;
}

/**
 * 把 N 个 D 维向量投影到 2D。
 * @param vectors 每个元素等长（维度不足时按 0 补齐）
 */
export function projectTo2D(vectors: ArrayLike<number>[]): ProjectedPoint[] {
  const n = vectors.length;
  if (n === 0) return [];
  const dim = Math.max(...vectors.map((v) => v.length));
  if (n === 1) return [{ x: 0.5, y: 0.5 }];

  // 1) 中心化
  const mean: number[] = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let d = 0; d < v.length; d++) mean[d] += v[d];
  }
  for (let d = 0; d < dim; d++) mean[d] /= n;

  const centered: number[][] = vectors.map((v) => {
    const out: number[] = new Array(dim).fill(0);
    for (let d = 0; d < dim; d++) out[d] = (v[d] ?? 0) - mean[d];
    return out;
  });

  // 2) 协方差矩阵的「乘向量」算子（避免显式构造 D×D 矩阵）
  const applyCov = (x: number[]): number[] => {
    const out: number[] = new Array(dim).fill(0);
    for (const c of centered) {
      const w = dot(c, x);
      for (let d = 0; d < dim; d++) out[d] += w * c[d];
    }
    return out;
  };

  const pc1 = powerIterate(applyCov, dim, 1.0);

  /**
   * 3) 第二个主成分：对协方差算子做**秩一压缩（deflation）**后再幂迭代。
   *
   * 正确形式是 B = A − λ₁·v₁v₁ᵀ，其中 λ₁ = v₁ᵀAv₁（v₁ 已单位化，故 Rayleigh 商即特征值）。
   *
   * 历史缺陷：压缩项写成 `(v₁ᵀx)·v₁·(v₁ᵀv₁)` —— 用 v₁ᵀv₁ ≈ 1 顶替了 λ₁，**特征值被整个丢掉**。
   * 于是 B 在 v₁ 方向上的特征值是 λ₁−1 而非 0；只要 |λ₁−1| > λ₂（协方差特征值极少恰好等于 1，
   * 实际几乎恒成立），第二次幂迭代照样收敛回 ±v₁，PC2 与 PC1 完全共线。
   *
   * 实测：构造一个 x 方向方差远大于 y 方向的三维数据集，投影后 |corr(x, y)| = 1.000000 ——
   * 知识库「语义地图」被压成一条直线，二维聚簇结构完全是假的。而这个 bug 肉眼极难发现：
   * 散点图照常渲染、点照常铺开（只是全落在一条斜线上），不会报错也不会留日志。
   */
  const lambda1 = dot(pc1, applyCov(pc1));
  const applyDeflated = (x: number[]): number[] => {
    const proj = dot(x, pc1);
    const out = applyCov(x);
    for (let d = 0; d < dim; d++) out[d] -= lambda1 * proj * pc1[d];
    return out;
  };
  const pc2 = powerIterate(applyDeflated, dim, 7.0);

  // 4) 投影
  const raw = centered.map((c) => ({ x: dot(c, pc1), y: dot(c, pc2) }));

  // 5) 归一化到 [0,1]（退化情况给 0.5）
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return raw.map((p) => ({
    x: (p.x - minX) / spanX,
    y: (p.y - minY) / spanY,
  }));
}

/** BLOB(Float32) → number[] */
export function blobToVector(blob: Buffer | Uint8Array | null | undefined): number[] {
  if (!blob) return [];
  const bytes = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  // 必须按字节偏移读取：Buffer 可能来自共享内存池，直接 .buffer 会读错区间
  const out: number[] = new Array(Math.floor(bytes.byteLength / 4));
  for (let i = 0; i < out.length; i++) out[i] = bytes.readFloatLE(i * 4);
  return out;
}

/**
 * 数据量大时下采样（保持各文档相对比例）。
 * 超过上限时按等间隔抽样，返回被选中的下标（确定性，不随机）。
 */
export function downsampleIndices(total: number, limit: number): number[] {
  if (total <= limit) return Array.from({ length: total }, (_, i) => i);
  if (limit <= 1) return [0];
  // 端点对齐：(total-1)/(limit-1) 保证首尾必选，尾部数据不再被系统性丢弃
  // （旧实现用 total/limit，1000 选 100 时最后一个下标只到 990，末 1% 永远看不到）
  const step = (total - 1) / (limit - 1);
  const out: number[] = [];
  for (let i = 0; i < limit; i++) out.push(Math.round(i * step));
  out[limit - 1] = total - 1;
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  return out;
}
