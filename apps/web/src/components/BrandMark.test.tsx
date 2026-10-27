import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, BrandMark } from './BrandMark';

/**
 * 品牌组件契约：logo 是品牌识别的唯一来源，改动必须锁住关键结构，
 * 防止后续被"顺手"改回圆环/去掉标语分隔线。
 */
describe('BrandMark', () => {
  it('渲染可访问的 SVG 且带 aria-label', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBe('SciFlow');
  });

  it('图形语义三层齐备：主流线 + 主笔 + 成果节点', () => {
    const { container } = render(<BrandMark variant="gradient" />);
    const paths = container.querySelectorAll('path');
    // 主流线（细）与主笔（粗）各一条
    expect(paths.length).toBeGreaterThanOrEqual(2);
    const widths = [...paths].map((p) => Number(p.getAttribute('stroke-width')));
    expect(Math.max(...widths)).toBeGreaterThan(5);
    expect(container.querySelectorAll('circle').length).toBe(2);
  });

  it('inverse 变体不使用渐变（放在品牌渐变底上需要纯色反白）', () => {
    const { container } = render(<BrandMark variant="inverse" />);
    expect(container.querySelector('linearGradient')).toBeNull();
    const stroke = container.querySelector('path')!.getAttribute('stroke');
    expect(stroke).toBe('currentColor');
  });
});

describe('BrandLockup', () => {
  it('词标拆分为 Sci + Flow，且标语可覆盖', () => {
    const { container } = render(<BrandLockup subtitle="自定义标语" />);
    expect(container.textContent).toContain('Sci');
    expect(container.textContent).toContain('Flow');
    expect(container.textContent).toContain('自定义标语');
  });

  it('默认副标保持品牌文案', () => {
    const { container } = render(<BrandLockup />);
    expect(container.textContent).toContain('让科研从想法到成文');
  });
});
