import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/**
 * 视觉回归比对：把「这次截图」与「上次认可的截图」逐像素比，给出差异比例。
 *
 * 为什么不自己解码 PNG：PNG 有滤波、调色板、隔行等分支，手写解码器是最容易埋坑的地方；
 * pngjs 是 Playwright 自身打包依赖里同源的成熟实现，pixelmatch 是 Playwright
 * 视觉断言背后的同一套算法（YIQ 色差 + 抗锯齿检测）。
 *
 * 判据是**差异像素占比**而不是「完全一致」：
 *  - 同一台机器上字体渲染稳定，静态页面通常 0 差异；
 *  - 但只要页面有日期、随机数、动画，就必然出现少量差异，所以用比例阈值而不是零容忍；
 *  - 尺寸不一致直接判失败：视口固定时尺寸变化意味着布局结构变了，不该被比例掩盖。
 */

export interface PngSize {
  width: number;
  height: number;
}

export interface VisualDiff {
  /** 尺寸一致且差异比例不超过阈值 */
  ok: boolean;
  expected: PngSize;
  actual: PngSize;
  sizeMismatch: boolean;
  diffPixels: number;
  totalPixels: number;
  /** 差异像素 / 总像素，0..1 */
  diffRatio: number;
  /** 允许的最大差异比例 */
  threshold: number;
  /** 差异图（红色标出不同像素）；尺寸不一致时不生成 */
  diffPng?: Buffer;
}

export interface CompareOptions {
  /** 允许的最大差异比例，默认 0.01（1%） */
  maxDiffRatio?: number;
  /** 单像素色差阈值（YIQ），越大越宽松，默认 0.1 */
  pixelThreshold?: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function readPng(buf: Buffer, label: string): PNG {
  try {
    return PNG.sync.read(buf);
  } catch {
    throw new Error(`${label}不是合法 PNG`);
  }
}

export function comparePngs(expectedBuf: Buffer, actualBuf: Buffer, opts: CompareOptions = {}): VisualDiff {
  const threshold = clamp01(opts.maxDiffRatio ?? 0.01);
  const pixelThreshold = clamp01(opts.pixelThreshold ?? 0.1);
  const expected = readPng(expectedBuf, '基线图');
  const actual = readPng(actualBuf, '当前截图');
  const expectedSize = { width: expected.width, height: expected.height };
  const actualSize = { width: actual.width, height: actual.height };

  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      ok: false,
      expected: expectedSize,
      actual: actualSize,
      sizeMismatch: true,
      diffPixels: expected.width * expected.height,
      totalPixels: expected.width * expected.height,
      diffRatio: 1,
      threshold,
    };
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
    threshold: pixelThreshold,
    includeAA: false,
    alpha: 0.5,
  });
  const totalPixels = expected.width * expected.height;
  const diffRatio = totalPixels > 0 ? diffPixels / totalPixels : 0;

  return {
    ok: diffRatio <= threshold,
    expected: expectedSize,
    actual: actualSize,
    sizeMismatch: false,
    diffPixels,
    totalPixels,
    diffRatio,
    threshold,
    diffPng: PNG.sync.write(diff),
  };
}
