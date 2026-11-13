/**
 * 学术检索（内置优势工具，免 Key）。
 *
 * 背景：流水线文献步骤只查「本地文献库 + 知识库」，全新项目必然 0 命中，
 * 导致起草无参考文献、引用闭环为空、客观质量分被引用维度拖死。
 * 这里接入三个公开学术 API（OpenAlex / Crossref / arXiv），按关键词检索真实论文元数据，
 * 去重后写入本地文献库，供起草与引用渲染使用。
 *
 * 约束：
 *  - 只用公开 https 端点，不携带任何用户凭据；失败静默降级（不阻塞流水线）。
 *  - 只写元数据（标题/作者/年份/期刊/DOI/摘要），不下载全文，不伪造字段。
 */
import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings } from '../db/schema';
import { tokenizeForMatch } from '../common/text';

export interface ScholarHit {
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: string;
  citationCount: number;
}

/** arXiv Atom 条目（removeNSPrefix 后标签为 title/author/name/published/doi/id/summary） */
interface AtomEntry {
  title?: unknown;
  author?: { name?: unknown } | { name?: unknown }[];
  published?: unknown;
  doi?: unknown;
  id?: unknown;
  summary?: unknown;
}

const UA = 'SciFlow/1.4 (+https://github.com/badhope/sciflow)';

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim();
}

/**
 * 命中与检索词的相关度：统计「不同 token」的命中数（标题命中权重 ×2）。
 * 实测教训：OpenAlex `sort=cited_by_count:desc` 会把「heterophilic」命中生物学
 * （heterophilic adhesion）之类的高被引离题论文顶到最前，污染整池参考文献；
 * 所以必须按相关度过滤+排序，引用数只作同分排序。
 */
/**
 * 中文通用二元组：只表达「这是一篇论文」而不表达领域。
 * 不过滤会让「…对…的影响/实验研究」这类医学/护理标题凭两个泛化词混进任何主题的文献池
 * （实测：图神经网络选题的新颖性预检返回子痫前期与宫颈癌护理论文）。
 */
const GENERIC_CN_BIGRAMS = new Set([
  '影响', '实验', '研究', '分析', '方法', '结果', '基于', '中的', '一个', '本文', '我们',
  '以及', '通过', '进行', '不同', '可以', '这个', '这些', '问题', '系统', '数据', '模型',
  '训练', '性能', '提高', '降低', '作用', '机制', '关系', '应用', '设计', '实现', '评估',
  '比较', '验证', '发现', '表明', '提出', '构建', '生成', '处理', '学习', '综述', '讨论',
  '结论', '背景', '现状', '发展', '趋势', '挑战', '展望', '方面', '角度', '层面', '过程',
  '方式', '内容', '指标', '特征', '结构', '功能', '效果', '患者', '术后', '临床', '治疗',
]);

/** 去掉只表达「论文体裁」的中文二元组，保留领域词 */
function meaningfulTokens(text: string): string[] {
  return tokenizeForMatch(text).filter((t) => !(t.length === 2 && GENERIC_CN_BIGRAMS.has(t)));
}

function relevanceOf(hit: ScholarHit, termSet: Set<string>): { titleHits: number; absHits: number } {
  if (!termSet.size) return { titleHits: 0, absHits: 0 };
  const titleT = new Set(meaningfulTokens(hit.title));
  const absT = new Set(meaningfulTokens(hit.abstract));
  let titleHits = 0;
  let absHits = 0;
  for (const t of termSet) {
    if (titleT.has(t)) titleHits += 1;
    else if (absT.has(t)) absHits += 1;
  }
  return { titleHits, absHits };
}

/**
 * 命中覆盖了「几个检索词分组」。
 *
 * 为什么需要：单看 token 重合度时，「Contextual Residual Aggregation for Ultra
 * High-Resolution Image Inpainting」会命中 residual+aggregation 两个 token 而混进
 * 图神经网络主题的参考文献池（实测事故：DeepLab / 图像修复 / 遥感超分 5 篇）。
 * 真正相关的论文通常同时命中「任务组（node classification）」与「领域组
 * （heterophilic graph）」；跨域论文只命中一个泛化词组。
 */
function groupCoverage(hit: ScholarHit, groups: Set<string>[]): number {
  const titleT = new Set([...meaningfulTokens(hit.title), ...meaningfulTokens(hit.abstract)]);
  let covered = 0;
  for (const g of groups) {
    let any = false;
    for (const t of g) { if (titleT.has(t)) { any = true; break; } }
    if (any) covered += 1;
  }
  return covered;
}

/** OpenAlex：覆盖面最广，含引用数与被引链接 */
async function searchOpenAlex(query: string, limit: number): Promise<ScholarHit[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=id,doi,title,publication_year,authorships,primary_location,cited_by_count,abstract_inverted_index`;
  const data = (await getJson(url)) as {
    results?: {
      id?: string;
      doi?: string;
      title?: string;
      publication_year?: number;
      authorships?: { author?: { display_name?: string } }[];
      primary_location?: { source?: { display_name?: string } };
      cited_by_count?: number;
      abstract_inverted_index?: Record<string, number[]>;
    }[];
  };
  const out: ScholarHit[] = [];
  for (const w of data.results || []) {
    if (!w.title) continue;
    // 摘要用倒排索引还原（OpenAlex 规则：按 position 排序取词）
    let abstract = '';
    if (w.abstract_inverted_index) {
      const words: { pos: number; word: string }[] = [];
      for (const [word, positions] of Object.entries(w.abstract_inverted_index)) {
        for (const pos of positions) words.push({ pos, word });
      }
      abstract = words.sort((a, b) => a.pos - b.pos).map((x) => x.word).join(' ').slice(0, 2000);
    }
    out.push({
      title: w.title.trim(),
      authors: (w.authorships || []).map((a) => a.author?.display_name || '').filter(Boolean).slice(0, 8),
      year: w.publication_year ?? null,
      venue: w.primary_location?.source?.display_name || '',
      doi: String(w.doi || '').replace(/^https:\/\/doi.org\//, ''),
      url: w.doi ? String(w.doi) : String(w.id || ''),
      abstract,
      source: 'openalex',
      citationCount: w.cited_by_count ?? 0,
    });
  }
  return out;
}

/** Crossref：出版社元数据（含 DOI 与期刊） */
async function searchCrossref(query: string, limit: number): Promise<ScholarHit[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=DOI,title,author,issued,container-title,abstract,is-referenced-by-count`;
  const data = (await getJson(url)) as {
    message?: {
      items?: {
        DOI?: string;
        title?: string[];
        author?: { given?: string; family?: string }[];
        issued?: { 'date-parts'?: number[][] };
        'container-title'?: string[];
        abstract?: string;
        'is-referenced-by-count'?: number;
      }[];
    };
  };
  const out: ScholarHit[] = [];
  for (const w of data.message?.items || []) {
    const title = (w.title || [])[0];
    if (!title) continue;
    out.push({
      title: title.trim(),
      authors: (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).slice(0, 8),
      year: w.issued?.['date-parts']?.[0]?.[0] ?? null,
      venue: (w['container-title'] || [])[0] || '',
      doi: w.DOI || '',
      url: w.DOI ? `https://doi.org/${w.DOI}` : '',
      abstract: String(w.abstract || '').replace(/<[^>]+>/g, '').slice(0, 2000),
      source: 'crossref',
      citationCount: w['is-referenced-by-count'] ?? 0,
    });
  }
  return out;
}

/** arXiv：预印本（Atom XML，用 fast-xml-parser 解析；正则切 XML 在命名空间/CDATA/转义上不可靠） */
async function searchArxiv(query: string, limit: number): Promise<ScholarHit[]> {
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:${query}`)}&max_results=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true, textNodeName: '#text' });
  const doc = parser.parse(xml) as { feed?: { entry?: AtomEntry | AtomEntry[] } };
  const rawEntries = doc.feed?.entry;
  if (!rawEntries) return [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
  const text = (v: unknown): string => {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text'] ?? '');
    return '';
  };
  const out: ScholarHit[] = [];
  for (const e of entries) {
    const title = text(e.title).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const rawAuthors = e.author == null ? [] : Array.isArray(e.author) ? e.author : [e.author];
    const authors = rawAuthors.map((a) => text(a.name).trim()).filter(Boolean).slice(0, 8);
    const published = text(e.published);
    out.push({
      title,
      authors,
      year: published ? Number(published.slice(0, 4)) || null : null,
      venue: 'arXiv',
      doi: text(e.doi),
      url: text(e.id),
      abstract: text(e.summary).replace(/\s+/g, ' ').trim().slice(0, 2000),
      source: 'arxiv',
      citationCount: 0,
    });
  }
  return out;
}

@Injectable()
export class ScholarSearchService {
  private readonly logger = new Logger(ScholarSearchService.name);

  /**
   * 是否启用（SCHOLAR_SEARCH=off 或 app_setting scholar_search=off 关闭）。
   * AI_MOCK=1（CI / 验收 / 离线）时不访问外网：真实 HTTP 会把 mock 流水线拖到分钟级，
   * 使 final_acceptance 的 interrupt 等待（30s）超时。
   */
  isEnabled(readSetting: (key: string) => string): boolean {
    if (process.env.AI_MOCK === '1') return false;
    const flag = (readSetting('scholar_search') || process.env.SCHOLAR_SEARCH || 'on').trim().toLowerCase();
    return flag !== 'off' && flag !== '0' && flag !== 'false';
  }

  /** 供 HTTP 入口使用：自己读 app_setting（与流水线同一开关，避免「流水线关了、文献页还在联网」） */
  isEnabledNow(): boolean {
    return this.isEnabled((key) => {
      try {
        return db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? '';
      } catch {
        return '';
      }
    });
  }

  /**
   * 多关键词检索并合并去重（按 DOI / 规范化标题）。
   * 任一源失败只记 warn，不影响其它源。
   * 相关性门禁：标题至少命中 1 个检索词 token，且标题+摘要合计命中 ≥2 个；
   * 按相关度降序、引用数作同分排序——引用数排序会引入大量高被引离题论文（实测事故）。
   */
  async search(keywords: string[], perQuery = 8): Promise<ScholarHit[]> {
    const queries = keywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 4);
    if (!queries.length) return [];
    /**
     * 进程内 TTL 缓存（默认 10 分钟，SCHOLAR_CACHE_TTL_MS 可调，0=关闭）。
     *
     * 为什么必须有：学术 API 是外部公共端点，同一主题在「新颖性预检 → 文献调研 →
     * 多轮回炉起草」里会被反复查询；无缓存时每轮都打 3 个源 × N 个关键词，
     * 既慢又容易触发 OpenAlex/Crossref 的礼貌限流。
     * 键 = 排序后的查询词 + 条数（与关键词顺序无关）。
     */
    const cacheKey = `${[...queries].sort().join('|')}::${perQuery}`;
    const ttl = Number(process.env.SCHOLAR_CACHE_TTL_MS ?? 600_000);
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.at < ttl) return cached.value;

    const termSet = new Set(meaningfulTokens(queries.join(' ')));
    // 检索词分组：按每条 query 各自成组（"heterophilic graph" / "node classification" / "residual aggregation"）。
    // 一条相关论文通常能同时命中多组；只命中一组泛化词的多半是跨域论文。
    const domainGroups = queries
      .map((q) => new Set(meaningfulTokens(q)))
      .filter((g) => g.size > 0);
    const seen = new Map<string, ScholarHit>();
    // 三个源 × 每个关键词**并行**（原实现按 query 串行：4 关键词 × 3 源 = 12 次串行往返）
    const perQueryResults = await Promise.all(
      queries.map(async (q) => {
        const tasks = [
          searchOpenAlex(q, perQuery).catch((e: unknown) => { this.logger.warn(`OpenAlex 检索失败（${q}）：${String((e as Error)?.message || e)}`); return [] as ScholarHit[]; }),
          searchCrossref(q, perQuery).catch((e: unknown) => { this.logger.warn(`Crossref 检索失败（${q}）：${String((e as Error)?.message || e)}`); return [] as ScholarHit[]; }),
          searchArxiv(q, perQuery).catch((e: unknown) => { this.logger.warn(`arXiv 检索失败（${q}）：${String((e as Error)?.message || e)}`); return [] as ScholarHit[]; }),
        ];
        return Promise.all(tasks);
      }),
    );
    for (const sourceResults of perQueryResults) {
      for (const hits of sourceResults) {
        for (const h of hits) {
          const key = h.doi ? `doi:${h.doi.toLowerCase()}` : `t:${normTitle(h.title)}`;
          if (!key || seen.has(key)) continue;
          // 只保留有标题且有年份或 DOI 的条目，避免脏数据进入参考文献
          if (!h.title || (!h.year && !h.doi)) continue;
          seen.set(key, h);
        }
      }
    }
    const scored = [...seen.values()]
      .map((h) => ({ h, ...relevanceOf(h, termSet), groups: groupCoverage(h, domainGroups) }))
      // 至少命中标题 1 个 token、合计 2 个 token，且跨过 ≥2 个检索词分组
      .filter((x) => x.titleHits >= 1 && x.titleHits + x.absHits >= 2 && x.groups >= Math.min(2, domainGroups.length));
    if (!scored.length) {
      this.logger.warn(`学术检索：${seen.size} 条原始命中全部未过相关性门禁（检索词 ${[...termSet].slice(0, 8).join(',')}）`);
      this.remember(cacheKey, []);
      return [];
    }
    const result = scored
      .sort((a, b) => b.groups - a.groups || b.titleHits * 2 + b.absHits - (a.titleHits * 2 + a.absHits) || b.h.citationCount - a.h.citationCount)
      .slice(0, 20)
      .map((x) => x.h);
    this.remember(cacheKey, result);
    return result;
  }

  /** 搜索缓存（进程内 LRU 上限 200 条，避免长跑内存滞留） */
  private readonly cache = new Map<string, { at: number; value: ScholarHit[] }>();

  private remember(key: string, value: ScholarHit[]): void {
    const ttl = Number(process.env.SCHOLAR_CACHE_TTL_MS ?? 600_000);
    if (!(ttl > 0)) return;
    this.cache.set(key, { at: Date.now(), value });
    while (this.cache.size > 200) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
