/**
 * 360 搜索结果页 HTML 解析（纯函数，便于单测）。
 *
 * 为什么不用 HTML 解析库：只需两段正则（结果块 + 去标签），引 cheerio/jsdom
 * 属于依赖膨胀；如果 360 改版导致解析失败，searchSo360 抛错走降级链并出 notice，
 * 不会静默返回假数据。
 */

export interface So360Result {
  title: string;
  url: string;
  snippet: string;
}

/** 解析 so.com 结果页：h3.res-title > a 给标题与链接，同块内剩余文本作摘要 */
export function parseSo360Html(html: string, maxResults = 6): So360Result[] {
  const out: So360Result[] = [];
  const blockRe = /<h3[^>]*class="res-title[^"]*"[^>]*>([\s\S]{0,800}?)<\/h3>/g;
  for (const m of String(html || '').matchAll(blockRe)) {
    if (out.length >= Math.max(1, maxResults)) break;
    const a = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(m[1]);
    if (!a) continue;
    const title = a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const url = a[1].replace(/&amp;/g, '&').trim();
    if (!title || !url) continue;
    // 摘要：h3 之后到下一个 h3 之间的纯文本首段（近似 result 片段）
    const after = String(html).slice((m.index ?? 0) + m[0].length);
    const next = after.search(/<h3[^>]*class="res-title/);
    const scope = next >= 0 ? after.slice(0, next) : after.slice(0, 3000);
    const snippet = scope
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 260);
    out.push({ title: title.slice(0, 160), url, snippet });
  }
  return out;
}
