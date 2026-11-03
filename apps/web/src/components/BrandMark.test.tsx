import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLockup, BrandMark } from './BrandMark';

/**
 * 品牌组件契约：logo 是品牌识别的唯一来源，改动必须锁住关键结构。
 *
 * 2026-11 契约变更（朱印 1.0）：图形从「主流线 + 主笔 + 节点外环」三层
 * 简化为「主笔 + 收笔朱点」两层——轨道线与节点外环是 AI 产品图标的模板件，
 * 与「自己的品牌」相悖，已删除且不允许改回（防止被"顺手"复原成三层结构）。
 * 「Flow」词标固定朱砂色（字标即印文），不再吃品牌渐变裁切。
 */
describe('BrandMark', () => {
  it('渲染可访问的 SVG 且带 aria-label', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('role')).toBe('img');
    expect(svg!.getAttribute('aria-label')).toBe('SciFlow');
  });

  it('图形语义两层齐备：主笔（粗）+ 收笔朱点，且不再有主流线/外环', () => {
    const { container } = render(<BrandMark variant="brand" />);
    // 恰好一条主笔 path
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(Number(paths[0].getAttribute('stroke-width'))).toBeGreaterThan(4);
    // 恰好一个收笔点（旧版的双 circle：实心 + 外环，已删）
    expect(container.querySelectorAll('circle').length).toBe(1);
  });

  it('brand 变体主笔走品牌 token，收笔点固定朱砂色', () => {
    const { container } = render(<BrandMark variant="brand" />);
    expect(container.querySelector('path')!.getAttribute('stroke')).toBe('var(--brand-600, #2F5480)');
    const dot = container.querySelector('circle')!.getAttribute('fill');
    expect(dot).toContain('brand-seal');
  });

  it('inverse 变体主笔纯白（放在朱砂印底上需要反白），朱点用暗底提亮档', () => {
    const { container } = render(<BrandMark variant="inverse" />);
    expect(container.querySelector('linearGradient')).toBeNull();
    expect(container.querySelector('path')!.getAttribute('stroke')).toBe('#ffffff');
    expect(container.querySelector('circle')!.getAttribute('fill')).toContain('on-dark');
  });

  it('mono 变体整体跟随 currentColor（单色/暗底场景）', () => {
    const { container } = render(<BrandMark variant="mono" />);
    expect(container.querySelector('path')!.getAttribute('stroke')).toBe('currentColor');
    expect(container.querySelector('circle')!.getAttribute('fill')).toBe('currentColor');
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

  it('「Flow」词标用朱砂签名色（不再用渐变裁切文字）', () => {
    const { container } = render(<BrandLockup />);
    const flow = [...container.querySelectorAll('span')].find((s) => s.textContent === 'Flow');
    expect(flow?.className).not.toContain('brand-gradient-text');
    expect(flow?.className).toContain('brand-seal');
  });
});
