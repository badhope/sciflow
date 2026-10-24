import type { SearchResult } from '../websearch/websearch.service';
import type { PaperHit } from '../references/references.service';

/**
 * 流水线联网检索：把 WebSearchService 的公开网页结果转成流水线可消费的 PaperHit。
 *
 * 背景（v1.0.0 审计 Medium）：websearch 五 provider 早已真实实现，但流水线的文献步骤
 * 只检索「本地文献库 + 知识库」——全新库 0 命中时完全依赖模型内部知识，
 * 用户看到「文献调研」步骤跑完却没有真实文献来源。
 *
 * 设计约束：
 *  - **默认关闭**（WEBSEARCH_IN_PIPELINE=on / app_setting websearch_in_pipeline=on 才启用）：
 *    联网属外部依赖，离线/内网环境必须优雅降级，不能因为搜不到而阻断流水线。
 *  - 结果只作为「写作参考线索」并入 prompt，并明确标注来源类型为 web，
 *    不与本地文献库的可核验条目混淆（引用渲染据此区分）。
 *  - 失败静默返回空数组，绝不抛错中断流水线。
 */

/** 每次流水线最多并入的联网结果数（超出会显著撑大 prompt 与 token 成本） */
const MAX_WEB_HITS = 6;

/** 联网检索开关：DB 设置优先，其次环境变量；未配置一律关闭 */
export function isWebSearchEnabled(readSetting: (key: string) => string): boolean {
  const flag = (readSetting('websearch_in_pipeline') || process.env.WEBSEARCH_IN_PIPELINE || '').trim().toLowerCase();
  return flag === 'on' || flag === '1' || flag === 'true';
}

/**
 * 搜索结果 → PaperHit[]：按 URL 去重、丢空标题、截断上限，
 * matchScore 以排名线性递减（0.9 → 0.5），与本地库的匹配度口径同域（0-1）。
 */
export function buildWebHits(results: SearchResult[]): PaperHit[] {
  const seen = new Set<string>();
  const out: PaperHit[] = [];
  for (const r of results) {
    const title = String(r.title || '').trim();
    if (!title) continue;
    const url = String(r.url || '').trim();
    const key = url || title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const rank = out.length;
    out.push({
      title: title.slice(0, 300),
      authors: [],
      year: null,
      venue: '联网检索',
      doi: '',
      url,
      abstract: String(r.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      source: 'manual',
      citationCount: 0,
      origin: 'web',
      matchScore: Math.max(0.5, Math.round((0.9 - rank * 0.08) * 100) / 100),
    });
    if (out.length >= MAX_WEB_HITS) break;
  }
  return out;
}
