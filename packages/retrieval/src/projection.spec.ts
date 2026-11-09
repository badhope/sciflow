import { describe, expect, it } from 'vitest';

/**
 * 秩一压缩（deflation）回归。
 *
 * 缺陷：第二个主成分的压缩项写成 `(v₁ᵀx)·v₁·(v₁ᵀv₁)`，用 v₁ᵀv₁≈1 顶替了特征值 λ₁，
 * 等于 B = A − v₁v₁ᵀ 而非 B = A − λ₁v₁v₁ᵀ。v₁ 方向上的特征值因此是 λ₁−1 而不是 0，
 * 第二次幂迭代仍收敛回 ±v₁ → PC2 与 PC1 完全共线 → 语义地图塌成一条直线。
 * 实测修复前 |corr(x,y)| = 1.000000。
 */
describe('projectTo2D 第二主成分正交性', () => {
  const dataset = () => {
    const out: number[][] = [];
    for (let i = 0; i < 60; i++) {
      const t = (i / 59) * 2 * Math.PI;
      // x 方向方差远大于 y、z：λ₁ 明显不等于 1，正是触发旧缺陷的条件
      out.push([10 * Math.cos(t) + 0.01 * i, 1.0 * Math.sin(t), 0.5 * Math.cos(2 * t)]);
    }
    return out;
  };

  const pearson = (xs: number[], ys: number[]) => {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };

  it('x/y 两轴不共线（语义地图真的展开成二维）', () => {
    const pts = projectTo2D(dataset());
    const r = Math.abs(pearson(pts.map((p) => p.x), pts.map((p) => p.y)));
    expect(r).toBeLessThan(0.5);
  });

  it('y 轴有真实展开度，不是 x 的线性重标定', () => {
    const pts = projectTo2D(dataset());
    const ys = pts.map((p) => p.y);
    // 归一化后 y 必然铺满 [0,1]；关键是中间值也要有分布，而不是只剩两端
    const mid = ys.filter((v) => v > 0.2 && v < 0.8).length;
    expect(mid).toBeGreaterThan(ys.length * 0.2);
  });

  it('同一输入两次投影结果完全一致（确定性契约未被破坏）', () => {
    const a = projectTo2D(dataset());
    const b = projectTo2D(dataset());
    expect(a).toEqual(b);
  });
});

import { projectTo2D, blobToVector, downsampleIndices } from './projection';

/**
 * 2D 投影（PCA）回归。
 *
 * 验收标准来自路线图 F-2.2：语义相近的块在地图上应彼此靠近。
 * 这里用合成的「两簇」数据验证：同簇点的投影距离必须显著小于跨簇距离。
 */

/** 生成两簇高维向量：簇心相距很远，簇内加小扰动 */
function twoClusters(nPerCluster = 20, dim = 32): { vectors: number[][]; labels: number[] } {
  const vectors: number[][] = [];
  const labels: number[] = [];
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < nPerCluster; i++) {
      const v: number[] = new Array(dim).fill(0);
      for (let d = 0; d < dim; d++) {
        // 簇心：第 c 簇在偶数维为正、奇数维为负（两簇方向相反）
        const center = d % 2 === 0 ? (c === 0 ? 1 : -1) : c === 0 ? -1 : 1;
        v[d] = center + Math.sin(i * 1.7 + d) * 0.05;
      }
      vectors.push(v);
      labels.push(c);
    }
  }
  return { vectors, labels };
}

describe('projectTo2D', () => {
  it('空输入返回空数组', () => {
    expect(projectTo2D([])).toEqual([]);
  });

  it('单点映射到中心', () => {
    expect(projectTo2D([[1, 2, 3]])).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('输出归一化到 [0,1]', () => {
    const { vectors } = twoClusters(10, 16);
    const pts = projectTo2D(vectors);
    expect(pts).toHaveLength(vectors.length);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('同簇点距离显著小于跨簇距离（语义可分离）', () => {
    const { vectors, labels } = twoClusters(20, 32);
    const pts = projectTo2D(vectors);
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

    const intra: number[] = [];
    const inter: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        (labels[i] === labels[j] ? intra : inter).push(dist(pts[i], pts[j]));
      }
    }
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(avg(intra)).toBeLessThan(avg(inter) * 0.6);
  });

  it('确定性：同一输入两次投影结果完全一致', () => {
    const { vectors } = twoClusters(8, 12);
    expect(projectTo2D(vectors)).toEqual(projectTo2D(vectors));
  });

  it('维度不齐时按 0 补齐，不抛错', () => {
    const pts = projectTo2D([[1, 2], [1, 2, 3], [0, 0, 0, 5]]);
    expect(pts).toHaveLength(3);
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it('全同向量（零方差）不产生 NaN', () => {
    const same = new Array(5).fill([1, 1, 1]);
    const pts = projectTo2D(same);
    for (const p of pts) {
      expect(Number.isNaN(p.x)).toBe(false);
      expect(Number.isNaN(p.y)).toBe(false);
    }
  });
});

describe('blobToVector', () => {
  it('Float32 BLOB 往返一致', () => {
    const original = [0.5, -1.25, 3];
    const buf = Buffer.alloc(original.length * 4);
    original.forEach((v, i) => buf.writeFloatLE(v, i * 4));
    expect(blobToVector(buf)).toEqual(original);
  });

  it('空值返回空数组', () => {
    expect(blobToVector(null)).toEqual([]);
    expect(blobToVector(undefined)).toEqual([]);
  });

  it('非 4 字节对齐的缓冲按整 4 字节截断', () => {
    const buf = Buffer.alloc(7);
    buf.writeFloatLE(1.5, 0);
    expect(blobToVector(buf)).toHaveLength(1);
  });
});

describe('downsampleIndices', () => {
  it('未超限返回全部下标', () => {
    expect(downsampleIndices(10, 100)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('超限时返回恰好 limit 个且覆盖全区间', () => {
    const idx = downsampleIndices(1000, 100);
    expect(idx).toHaveLength(100);
    // 首尾必须精确落在两端：原断言 `last < 1000` 对「只取前 100 条」同样成立（突变未捕获）
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(999);
    // 步长均匀：任意相邻间隔不超过 ceil((n-1)/(limit-1))，防止前半密后半疏
    for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBeLessThanOrEqual(11);
    // 递增（无重复）
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });

  it('确定性', () => {
    expect(downsampleIndices(500, 50)).toEqual(downsampleIndices(500, 50));
  });
});
