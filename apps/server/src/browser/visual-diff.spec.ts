import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { comparePngs } from './visual-diff';

/**
 * 视觉回归的判据必须可被单测钉死，否则「比图」很容易退化成「总是通过」。
 * 这里不启浏览器：直接合成 PNG 字节，覆盖尺寸不一致、完全一致、局部变化、阈值边界四种情况。
 */
function makePng(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const [r, g, b] = paint(x, y);
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const white: [number, number, number] = [255, 255, 255];
const black: [number, number, number] = [0, 0, 0];

describe('视觉回归比对', () => {
  it('完全一致 → 通过且差异为 0', () => {
    const a = makePng(20, 20, () => white);
    const b = makePng(20, 20, () => white);
    const r = comparePngs(a, b);
    expect(r.ok).toBe(true);
    expect(r.diffPixels).toBe(0);
    expect(r.diffRatio).toBe(0);
    expect(r.sizeMismatch).toBe(false);
    expect(r.diffPng).toBeInstanceOf(Buffer);
  });

  it('尺寸不同 → 直接失败（不被比例掩盖）', () => {
    const a = makePng(20, 20, () => white);
    const b = makePng(20, 21, () => white);
    const r = comparePngs(a, b);
    expect(r.ok).toBe(false);
    expect(r.sizeMismatch).toBe(true);
    expect(r.expected).toEqual({ width: 20, height: 20 });
    expect(r.actual).toEqual({ width: 20, height: 21 });
    expect(r.diffPng).toBeUndefined();
  });

  it('局部变色：默认 1% 阈值下小面积差异通过，大面积失败', () => {
    const base = makePng(100, 100, () => white);
    // 50 个像素 = 0.5%，低于默认阈值
    const small = makePng(100, 100, (x, y) => (y === 0 && x < 50 ? black : white));
    const smallDiff = comparePngs(base, small);
    expect(smallDiff.diffPixels).toBeGreaterThan(0);
    expect(smallDiff.diffRatio).toBeCloseTo(0.005, 3);
    expect(smallDiff.ok).toBe(true);

    // 半屏变黑 = 50%，任何合理阈值都应判失败
    const big = makePng(100, 100, (_x, y) => (y < 50 ? black : white));
    const bigDiff = comparePngs(base, big);
    expect(bigDiff.diffRatio).toBeGreaterThan(0.4);
    expect(bigDiff.ok).toBe(false);
  });

  it('阈值可调：同样的差异在放宽阈值后通过', () => {
    const base = makePng(100, 100, () => white);
    const changed = makePng(100, 100, (_x, y) => (y < 5 ? black : white)); // 5%
    expect(comparePngs(base, changed).ok).toBe(false);
    expect(comparePngs(base, changed, { maxDiffRatio: 0.1 }).ok).toBe(true);
  });

  it('非法 PNG 给出可读错误', () => {
    expect(() => comparePngs(Buffer.from('not a png'), makePng(4, 4, () => white))).toThrow(/不是合法 PNG/);
  });
});
