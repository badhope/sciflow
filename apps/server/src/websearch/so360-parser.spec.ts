import { describe, expect, it } from 'vitest';
import { parseSo360Html } from './so360-parser';

/**
 * 360 搜索结果页解析回归（v1.9.2 新增 provider 的护栏）。
 *
 * 背景：原「零配置兜底」DuckDuckGo 在国内网络不可达（实测连接超时），且其
 * Instant Answer API 本身只返回实体摘要而非网页搜索结果——号称「通用搜索」
 * 实际恒为空，失败还静默返回 []。so360 是国内可达的免 Key 兜底源。
 * 解析逻辑改动时，本文件保证：改版返回 0 条会走降级链出 notice，而不是静默假数据。
 */

const FIXTURE = `
<html><body>
<ul class="res-list">
<li class="res-list">
  <h3 class="res-title"><a href="https://www.so.com/link?m=abc&amp;d=1" target="_blank">图神经网络综述 Survey on Graph Neural Network</a></h3>
  <p class="res-desc">本文系统综述了图神经网络的消息传递范式与代表性变体。</p>
</li>
<li class="res-list">
  <h3 class="res-title "><a href="https://example.com/paper2">GNN 图神经网络 通俗理解</a></h3>
  <div class="res-rich">面向初学者的 GNN 入门讲解，覆盖 GCN / GraphSAGE / GAT。</div>
</li>
<li class="res-list">
  <h3 class="res-title"><a href="/relative/path">无域名相对链接结果（应保留链接原文）</a></h3>
  <p>描述文本。</p>
</li>
<li class="res-list">
  <h3 class="res-title"><a href="https://ad.example.com">广告位（无 res-desc）</a></h3>
</li>
</ul>
</body></html>
`;

describe('parseSo360Html', () => {
  it('解析标题与链接，HTML 实体反转义，标题去标签', () => {
    const r = parseSo360Html(FIXTURE);
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r[0].title).toBe('图神经网络综述 Survey on Graph Neural Network');
    expect(r[0].url).toBe('https://www.so.com/link?m=abc&d=1');
    expect(r[0].snippet).toContain('消息传递范式');
  });

  it('res-desc 缺失时摘要为空串而不是上一块的内容（块间隔离）', () => {
    const r = parseSo360Html(FIXTURE);
    const ad = r.find((x) => x.title.includes('广告位'));
    expect(ad).toBeTruthy();
    // 广告块后面没有同块正文，摘要不应吞进页面尾部无关文本
    expect((ad!.snippet || '').length).toBeLessThanOrEqual(260);
  });

  it('maxResults 生效（截断到上限）', () => {
    expect(parseSo360Html(FIXTURE, 2)).toHaveLength(2);
  });

  it('改版/空页面返回 0 条（调用方据此走降级链出 notice，而不是抛错）', () => {
    expect(parseSo360Html('<html><body>verifying you are human</body></html>')).toEqual([]);
    expect(parseSo360Html('')).toEqual([]);
  });
});
