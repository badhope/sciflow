import { describe, it, expect } from 'vitest';
import { buildWebHits, isWebSearchEnabled } from './pipeline-websearch';

/**
 * 流水线联网检索接入（Medium 修复）：
 * 此前 websearch 五 provider 已真实实现，但流水线文献步骤只搜本地库/知识库，
 * 全新库 0 命中时完全依赖模型内部知识。这里锁定「联网结果 → PaperHit」的转换契约。
 */

const hit = (title: string, url = 'https://example.org/a', snippet = '摘要') => ({ title, url, snippet });

describe('流水线联网检索', () => {
  it('联网结果转换为 PaperHit：source=manual、origin=web、matchScore 递减且落在 0-1', () => {
    const hits = buildWebHits([hit('Paper A', 'https://x/a'), hit('Paper B', 'https://x/b'), hit('Paper C', 'https://x/c')]);
    expect(hits).toHaveLength(3);
    expect(hits[0].origin).toBe('web');
    expect(hits[0].source).toBe('manual');
    expect(hits[0].title).toBe('Paper A');
    expect(hits[0].url).toBe('https://x/a');
    expect(hits[0].matchScore!).toBeGreaterThan(hits[2].matchScore!);
    for (const h of hits) {
      expect(h.matchScore!).toBeGreaterThanOrEqual(0);
      expect(h.matchScore!).toBeLessThanOrEqual(1);
    }
  });

  it('展示字段为空时给出安全默认（authors=[]、year=null、venue=联网检索）', () => {
    const [h] = buildWebHits([hit('Only Title')]);
    expect(h.authors).toEqual([]);
    expect(h.year).toBeNull();
    expect(h.venue).toBe('联网检索');
    expect(h.citationCount).toBe(0);
  });

  it('同一 URL 的重复结果去重；空标题条目丢弃', () => {
    const hits = buildWebHits([hit('A', 'https://x/1'), hit('A dup', 'https://x/1'), hit(''), hit('B', 'https://x/2')]);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.url)).toEqual(['https://x/1', 'https://x/2']);
  });

  it('超过上限时截断（结果多也不会把 prompt 撑爆）', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`P${i}`, `https://x/${i}`));
    expect(buildWebHits(many).length).toBeLessThanOrEqual(6);
  });

  it('开关：默认关闭（离线优先），app_setting websearch_in_pipeline=on 或 env 开启才启用', () => {
    const prev = process.env.WEBSEARCH_IN_PIPELINE;
    try {
      delete process.env.WEBSEARCH_IN_PIPELINE;
      expect(isWebSearchEnabled(() => '')).toBe(false);
      expect(isWebSearchEnabled(() => 'off')).toBe(false);
      expect(isWebSearchEnabled(() => 'on')).toBe(true);
      process.env.WEBSEARCH_IN_PIPELINE = 'on';
      expect(isWebSearchEnabled(() => '')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.WEBSEARCH_IN_PIPELINE;
      else process.env.WEBSEARCH_IN_PIPELINE = prev;
    }
  });
});
