import { describe, expect, it } from 'vitest';
import {
  classifyScholarSourceError,
  summarizeScholarSources,
  type ScholarSourceStatus,
} from './scholar-search.service';

const source = (name: ScholarSourceStatus['source'], ok: boolean, failed = 0, error?: string): ScholarSourceStatus => ({
  source: name,
  ok,
  success: ok ? 1 : 0,
  failed,
  error,
});

/**
 * 国内网络访问境外学术 API 的降级回归：
 *  - 网络失败不能误报成「没搜到相关论文」
 *  - 失败提示必须包含代理 / 本地替代路径
 *  - 部分源失败时保留其它源结果，但明确标记 degraded
 */
describe('ScholarSearchService 可达性提示', () => {
  it('把超时、DNS/网络失败、HTTP 限流归一成可行动原因', () => {
    expect(classifyScholarSourceError(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe('请求超时');
    expect(classifyScholarSourceError(new TypeError('fetch failed'))).toBe('网络不可达');
    expect(classifyScholarSourceError(new Error('HTTP 429'))).toBe('请求被限流（HTTP 429）');
    expect(classifyScholarSourceError(new Error('HTTP 503'))).toBe('服务端错误（HTTP 503）');
  });

  it('三源全部失败：offline，并引导代理与本地库', () => {
    const result = summarizeScholarSources(
      [
        source('openalex', false, 1, '网络不可达'),
        source('crossref', false, 1, '请求超时'),
        source('arxiv', false, 1, '网络不可达'),
      ],
      0,
    );
    expect(result.status).toBe('offline');
    expect(result.notice).toContain('全部不可达');
    expect(result.notice).toContain('代理');
    expect(result.notice).toContain('本地文献库');
  });

  it('部分源失败：degraded，保留命中数并点名失败源', () => {
    const result = summarizeScholarSources(
      [
        source('openalex', true),
        source('crossref', false, 1, '网络不可达'),
        source('arxiv', true),
      ],
      3,
    );
    expect(result.status).toBe('degraded');
    expect(result.notice).toContain('Crossref');
    expect(result.notice).toContain('已返回 3 条');
    expect(result.notice).toContain('代理');
  });

  it('三源正常但没有命中：ok，提示换检索词而不是网络问题', () => {
    const result = summarizeScholarSources(
      [source('openalex', true), source('crossref', true), source('arxiv', true)],
      0,
    );
    expect(result.status).toBe('ok');
    expect(result.notice).toContain('未命中');
    expect(result.notice).not.toContain('代理');
  });
});
