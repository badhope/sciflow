import { describe, expect, it } from 'vitest';
import { normalizeLimit, normalizeOffset, paginate } from './paginate';

const rows = Array.from({ length: 25 }, (_, i) => ({ id: i }));

describe('paginate', () => {
  it('returns the full array when no paging params are given', () => {
    expect(paginate(rows)).toEqual(rows);
  });

  it('slices when limit is given', () => {
    const page = paginate(rows, 10) as { items: { id: number }[]; total: number; hasMore: boolean };
    expect(page.items.length).toBe(10);
    expect(page.total).toBe(25);
    expect(page.hasMore).toBe(true);
  });

  it('supports offset', () => {
    const page = paginate(rows, 10, 20) as { items: { id: number }[]; hasMore: boolean };
    expect(page.items.map((r) => r.id)).toEqual([20, 21, 22, 23, 24]);
    expect(page.hasMore).toBe(false);
  });

  it('clamps limit to 200', () => {
    expect(normalizeLimit(9999)).toBe(200);
  });

  it('falls back to 50 for invalid limit', () => {
    expect(normalizeLimit('abc')).toBe(50);
    expect(normalizeLimit(0)).toBe(50);
    expect(normalizeLimit(-3)).toBe(50);
  });

  it('treats negative offsets as zero', () => {
    expect(normalizeOffset(-10)).toBe(0);
    expect(normalizeOffset('x')).toBe(0);
  });

  it('handles offset past the end', () => {
    const page = paginate(rows, 10, 100) as { items: unknown[]; hasMore: boolean };
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
