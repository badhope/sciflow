import { describe, expect, it } from 'vitest';
import type { ScholarHit, ScholarSourceStatus } from './scholar-search.service';
import { NoveltyService } from './novelty.service';

const hit = (title: string, year = 2022): ScholarHit => ({
  title,
  authors: ['A. Author'],
  year,
  venue: 'Test Venue',
  doi: '10.1000/test',
  url: 'https://example.org/paper',
  abstract: 'abstract',
  source: 'openalex',
  citationCount: 12,
});

const source = (name: ScholarSourceStatus['source'], ok: boolean, failed = 0, error?: string): ScholarSourceStatus => ({
  source: name,
  ok,
  success: ok ? 1 : 0,
  failed,
  error,
});

const service = (opts: {
  enabled?: boolean;
  hits?: ScholarHit[];
  sources?: ScholarSourceStatus[];
  throws?: boolean;
}) =>
  new NoveltyService({
    isEnabledNow: () => opts.enabled ?? true,
    searchWithStatus: async () => {
      if (opts.throws) throw new Error('network down');
      return { hits: opts.hits ?? [], sources: opts.sources ?? [source('openalex', true)] };
    },
  } as never);

describe('NoveltyService', () => {
  it('三源正常时返回联网查新结论与相近工作', async () => {
    const r = await service({
      hits: [hit('Heterophilic Graph Node Classification'), hit('Graph Learning for Heterophilic Nodes', 2021)],
      sources: [source('openalex', true), source('crossref', true), source('arxiv', true)],
    }).check('heterophilic graph node classification', 'p-test');

    expect(r.status).toBe('ok');
    expect(r.enabled).toBe(true);
    expect(r.offline).toBe(false);
    expect(r.basis).toBe('scholar');
    expect(r.overlap).toBe(100);
    expect(r.similar[0].url).toBe('https://example.org/paper');
    expect(r.notice).toBe('');
  });

  it('中文选题 + 英文检索词时，重叠度对英文标题仍有效', async () => {
    const r = await service({
      hits: [hit('Heterophilic Graph Node Classification')],
      sources: [source('openalex', true), source('crossref', true), source('arxiv', true)],
    }).check('异质图节点分类', 'p-test', 'heterophilic graph node classification');

    expect(r.overlap).toBe(100);
    expect(r.advice).toContain('重叠度');
  });

  it('三源全不可达时标记 offline，并给出代理/本地库提示', async () => {
    const r = await service({
      sources: [
        source('openalex', false, 1, '网络不可达'),
        source('crossref', false, 1, '网络不可达'),
        source('arxiv', false, 1, '网络不可达'),
      ],
    }).check('heterophilic graph node classification', 'p-test');

    expect(r.status).toBe('offline');
    expect(r.offline).toBe(true);
    expect(r.basis).toBe('offline-fallback');
    expect(r.notice).toContain('可能需要代理');
    expect(r.notice).toContain('本地文献库');
    expect(r.advice).not.toContain('选题可能较新');
  });

  it('部分源不可达且无命中时，不误报选题很新', async () => {
    const r = await service({
      sources: [source('openalex', true), source('crossref', false, 1, 'HTTP 429')],
    }).check('heterophilic graph node classification', 'p-test');

    expect(r.status).toBe('degraded');
    expect(r.notice).toContain('Crossref');
    expect(r.advice).toContain('不能据此判断');
  });

  it('学术检索关闭时用本地库降级，并明确状态', async () => {
    const r = await service({ enabled: false }).check('heterophilic graph node classification', 'p-test');

    expect(r.status).toBe('disabled');
    expect(r.enabled).toBe(false);
    expect(r.basis).toBe('offline-fallback');
    expect(r.notice).toContain('SCHOLAR_SEARCH=off');
  });

  it('请求异常时降级而不是抛出 500', async () => {
    const r = await service({ throws: true }).check('heterophilic graph node classification', 'p-test');

    expect(r.status).toBe('offline');
    expect(r.notice).toContain('请求异常');
  });
});
