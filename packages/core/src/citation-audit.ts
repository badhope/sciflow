/**
 * 引用体检（确定性规则引擎，不调 LLM）— 纯函数，可在 server / CLI / 测试三处共用。
 *
 * 为什么单独抽出来：原实现内联在 DocumentsService 里，逐行 `db.select()` 查 reference
 * （N+1），且只检查「幽灵锚点 / 空表 / 无 DOI」三类。学术写作里真正会毁稿的还有：
 *  - **未引用条目**：参考文献表里有、正文从未引用（审稿人一眼能看出凑数）
 *  - **重复 DOI**：同一篇文献被重复录入，编号不一致
 *  - **锚点断号**：正文 [1][3] 却没有 [2]（顺序编码制断链）
 *  - **元数据不一致**：同一 DOI 在不同条目里年份/标题不同
 * 这里把判定集中为纯函数，输入是「正文 + citation 行 + reference 元数据」，
 * 输出带分级证据的报告，服务层只负责取数。
 */

export interface AuditReferenceMeta {
  id: string;
  title: string;
  doi: string;
  year: number | null;
  authors: string;
}

export interface AuditCitationRow {
  id: string;
  referenceId: string;
  /** 引用出现位置（章节名/段落） */
  location?: string;
  /** 引用上下文句 */
  context?: string;
  verified?: number;
}

export interface CitationAuditInput {
  content: string;
  citations: AuditCitationRow[];
  references: AuditReferenceMeta[];
  /** 尾部块标题词（默认与 pipeline/tail-blocks 一致） */
  tailHeadings?: string[];
}

export type CitationIssueLevel = 'red' | 'yellow' | 'info';

export interface CitationAuditIssue {
  level: CitationIssueLevel;
  code:
    | 'ghost-anchor'
    | 'empty-citation-table'
    | 'orphan-citation'
    | 'uncited-reference'
    | 'duplicate-doi'
    | 'anchor-gap'
    | 'missing-doi'
    | 'metadata-conflict'
    | 'residual-anchor'
    | 'no-anchor'
    | 'ok';
  message: string;
  /** 涉及的编号/ID（便于前端定位） */
  items?: (string | number)[];
}

export interface CitationAuditReport {
  /** 正文出现的不同锚点编号数 */
  anchorTotal: number;
  maxAnchor: number;
  /** 正文锚点中在 1..maxAnchor 里缺失的编号 */
  missingAnchors: number[];
  citationRows: number;
  verifiedCount: number;
  /** 未在正文出现的已落库引用（按编号无法判断，按 citation 行数比较） */
  uncitedCount: number;
  duplicateDoi: string[];
  noDoi: number;
  ghost: number;
  /** 正文残留的未渲染引用标记数（[文献N] / [Ref:N] / [补充Ref:N]）——渲染链路断裂的物证 */
  residualAnchors: number;
  /** 残留标记样本（去重，最多 10 条），供 UI 定位 */
  residualSamples: string[];
  score: number;
  /** 面向用户的文案（保持字符串数组的历史契约，前端/回归脚本无需改） */
  issues: string[];
  /** 结构化明细（level/code/items），供 UI 分级着色与精确定位 */
  details: CitationAuditIssue[];
}

const DEFAULT_TAIL = ['参考文献', '引用文献', '图表', '研究资料', 'references'];

/** 仅保留正文（剥掉尾部块），与 pipeline 的 tail-blocks 同口径 */
/** 正则元字符转义：tailHeadings 是调用方传入的普通字符串，不能直接拼进 RegExp */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function splitBodyForAudit(content: string, tailHeadings: string[] = DEFAULT_TAIL): string {
  /**
   * 过滤空串 + 逐条转义。历史缺陷：`tailHeadings.join('|')` 被原样拼进 new RegExp，
   *   - 数组里混入空串 → 交替分支变成 `(?:参考文献||图表)`，空分支可匹配任意位置，
   *     正文会从第一个换行处被整段截断（审计对象瞬间变成空文）；
   *   - 标题含正则元字符（如自定义尾部块名 `附录(A)`）→ new RegExp 直接抛 SyntaxError，
   *     整个体检接口 500。
   * 对 DEFAULT_TAIL 而言转义是恒等变换，既有行为不变。
   */
  const heads = (tailHeadings || []).map((h) => String(h ?? '').trim()).filter(Boolean).map(escapeRegExp);
  if (!heads.length) return String(content || '');
  const re = new RegExp(`\\n+#{1,3}\\s*(?:${heads.join('|')})(?=[\\s（(:：\\-—]|$)[^\\n]*`, 'gi');
  let cut = -1;
  for (const m of String(content || '').matchAll(re)) {
    const idx = m.index ?? -1;
    if (idx >= 0 && (cut === -1 || idx < cut)) cut = idx;
  }
  return cut >= 0 ? String(content).slice(0, cut) : String(content || '');
}

/** 提取正文锚点编号（兼容 [n] / [Ref:n] / 【n】；忽略尾部块） */
export function extractAnchorNumbers(content: string, tailHeadings?: string[]): number[] {
  const body = splitBodyForAudit(content, tailHeadings);
  const nums = new Set<number>();
  for (const m of body.matchAll(/\[\s*(?:Ref\s*[:：]\s*)?(\d{1,3})\s*\]/gi)) {
    const n = Number(m[1]);
    if (n > 0) nums.add(n);
  }
  for (const m of body.matchAll(/【\s*(\d{1,3})\s*】/g)) {
    const n = Number(m[1]);
    if (n > 0) nums.add(n);
  }
  return [...nums].sort((a, b) => a - b);
}

/**
 * 提取正文残留的「未渲染引用标记」。
 *
 * 背景：`citation-renderer` 把越界锚点降级为 `[文献N]`（不静默丢弃）；而渲染失败的
 * 另一常见形态是模型直接输出 `[Ref:N]` 但渲染器根本没跑（如手写正文）。
 * 这两类标记在「报告」语义上是「这条引用没有着落」，但在正文中看起来像引用——
 * 审计若不识别它们，就会把「引用全断」误报成「没有引用」（假绿 60 分）。
 */
export function extractResidualAnchors(content: string, tailHeadings?: string[]): string[] {
  const body = splitBodyForAudit(content, tailHeadings);
  const out: string[] = [];
  for (const m of body.matchAll(/\[\s*文献\s*\d{1,3}\s*\]/g)) out.push(m[0].replace(/\s+/g, ''));
  for (const m of body.matchAll(/\[\s*(?:补充)?\s*Ref\s*[:：]\s*\d{1,3}\s*\]/gi)) out.push(m[0].replace(/\s+/g, ''));
  for (const m of body.matchAll(/\[\s*补充文献\s*\]/g)) out.push(m[0].replace(/\s+/g, ''));
  return out;
}

/**
 * 主入口：引用体检。
 *
 * 评分口径（与历史回归契约兼容）：
 *  - 无锚点：基准 60（不是满分——没引用无法评估）
 *  - 有锚点但 citation 表为空：再扣 60（必然红牌）
 *  - 每个幽灵锚点 −20；每个无 DOI 引用 −5
 *  - 每条未引用条目 −5（上限 −20）；重复 DOI 每条 −5（上限 −10）
 * 极值夹取到 0-100。
 */
export function auditCitations(input: CitationAuditInput): CitationAuditReport {
  const anchors = extractAnchorNumbers(input.content, input.tailHeadings);
  const anchorSet = new Set(anchors);
  const refById = new Map(input.references.map((r) => [r.id, r]));
  const rows = input.citations || [];

  const orphanRows = rows.filter((r) => !r.referenceId || !refById.has(r.referenceId));
  const resolvableRows = rows.filter((r) => r.referenceId && refById.has(r.referenceId));
  const resolvable = resolvableRows.length;

  const maxAnchor = anchors.length ? anchors[anchors.length - 1] : 0;
  /**
   * 幽灵锚点 = 编号超出「已落库可解析引用数」的锚点，与下面 issues[].items **同源**。
   *
   * 历史缺陷：写成 `maxAnchor - resolvable`（最大编号 − 可解析条数）。只有当锚点是
   * 1..maxAnchor 连续时两者才相等；一旦正文断号（如 [1][2][10]），该式把「断号」重复计成
   * 「幽灵」：3 个锚点算出 ghost = 7，而同时下发的 items 只有 [10] 一条 —— 报告里的数字
   * 与它自己给出的证据对不上。更糟的是每个虚增幽灵按 −20 扣分，一处断号就能把分数打到 0，
   * 而断号本身只该按黄牌（anchor-gap）处理。
   */
  const ghostAnchors = anchors.filter((n) => n > resolvable);
  const ghost = ghostAnchors.length;

  // 断号：1..maxAnchor 中正文未出现的编号
  const missingAnchors: number[] = [];
  for (let i = 1; i <= maxAnchor; i++) if (!anchorSet.has(i)) missingAnchors.push(i);

  // 未引用条目：落库引用按编号与正文对应，锚点数小于引用行数即存在「列了但没引」
  const uncitedCount = Math.max(0, resolvable - anchors.length);

  const noDoi = resolvableRows.filter((r) => {
    if (r.verified) return false;
    const ref = refById.get(r.referenceId);
    return !ref?.doi;
  }).length;

  // 重复 DOI（大小写不敏感；空 DOI 不参与）
  const doiMap = new Map<string, string[]>();
  for (const r of resolvableRows) {
    const doi = (refById.get(r.referenceId)?.doi || '').trim().toLowerCase();
    if (!doi) continue;
    const list = doiMap.get(doi) || [];
    list.push(r.referenceId);
    doiMap.set(doi, list);
  }
  const duplicateDoi = [...doiMap.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([doi]) => doi);

  // 元数据冲突：同一 DOI 指向不同标题（说明重复录入后各自被改过）
  const titleByDoi = new Map<string, Set<string>>();
  for (const r of resolvableRows) {
    const ref = refById.get(r.referenceId);
    const doi = (ref?.doi || '').trim().toLowerCase();
    if (!doi || !ref?.title) continue;
    const set = titleByDoi.get(doi) || new Set<string>();
    set.add(ref.title.trim().toLowerCase());
    titleByDoi.set(doi, set);
  }
  const conflictDois = [...titleByDoi.entries()].filter(([, titles]) => titles.size > 1).map(([doi]) => doi);

  // 残留未渲染标记（[文献N] / [Ref:N] / [补充文献]）：引用渲染链路断裂的物证。
  // 单独统计是因为 audit 之前的口径只认 [n]/[Ref:n]/【n】三类锚点，
  // 而渲染器自己产出的降级形态 [文献N] 不在其中 → 「引用全断」被误报成「没有引用」。
  const residualSamples = extractResidualAnchors(input.content, input.tailHeadings);
  const residualAnchors = residualSamples.length;

  const issues: CitationAuditIssue[] = [];
  if (residualAnchors > 0) {
    const uniq = [...new Set(residualSamples)];
    issues.push({
      level: 'red',
      code: 'residual-anchor',
      message: `红牌：${residualAnchors} 处未渲染的引用标记（${uniq.slice(0, 4).join(' ')}${uniq.length > 4 ? ' …' : ''}）——引用渲染未覆盖或锚点越界，读者会看到无法溯源的伪引用`,
      items: uniq.slice(0, 10),
    });
  }
  if (ghost > 0) {
    issues.push({
      level: 'red',
      code: 'ghost-anchor',
      message: `红牌：${ghost} 个锚点编号超出已落库引用（幽灵引用），请重跑引用渲染或检查文献库`,
      items: ghostAnchors,
    });
  }
  if (resolvable === 0 && anchors.length > 0) {
    issues.push({ level: 'red', code: 'empty-citation-table', message: '红牌：正文有锚点但无可用引用——文档未经引用渲染流程或引用的文献已删除' });
  }
  if (orphanRows.length > 0) {
    issues.push({
      level: 'red',
      code: 'orphan-citation',
      message: `红牌：${orphanRows.length} 条引用指向已删除文献（孤儿引用），请重新渲染引用`,
      items: orphanRows.map((r) => r.id),
    });
  }
  if (missingAnchors.length > 0) {
    issues.push({
      level: 'yellow',
      code: 'anchor-gap',
      message: `黄牌：正文锚点断号（缺 ${missingAnchors.slice(0, 10).join(', ')}${missingAnchors.length > 10 ? ' …' : ''}），顺序编码制下会导致编号与文末列表错位`,
      items: missingAnchors,
    });
  }
  if (uncitedCount > 0) {
    issues.push({
      level: 'yellow',
      code: 'uncited-reference',
      message: `黄牌：${uncitedCount} 条引用已落库但正文无对应锚点（参考文献表凑数/漏引），审稿人会直接质疑`,
      items: [uncitedCount],
    });
  }
  if (duplicateDoi.length > 0) {
    issues.push({
      level: 'yellow',
      code: 'duplicate-doi',
      message: `黄牌：${duplicateDoi.length} 个 DOI 被重复引用（同一文献多条记录）`,
      items: duplicateDoi,
    });
  }
  if (conflictDois.length > 0) {
    issues.push({
      level: 'yellow',
      code: 'metadata-conflict',
      message: `黄牌：${conflictDois.length} 个 DOI 对应不同标题（元数据冲突），需人工核对`,
      items: conflictDois,
    });
  }
  if (noDoi > 0) {
    issues.push({ level: 'yellow', code: 'missing-doi', message: `黄牌：${noDoi} 条已绑定引用无 DOI，可信度待核` });
  }

  const noAnchors = anchors.length === 0 && residualAnchors === 0;
  if (noAnchors) {
    issues.push({
      level: 'info',
      code: 'no-anchor',
      message: '提示：正文未检测到引用锚点（[n] / [Ref:n] / 【n】），无法评估引用完整性',
    });
  } else if (issues.length === 0) {
    issues.push({ level: 'info', code: 'ok', message: '绿牌：全部锚点已绑定且具备 DOI 可信度' });
  }

  const base = noAnchors ? 60 : 100;
  // 「引用断链」按性质重罚：残留标记每处 −10（不封顶，出现越多说明渲染链路断得越彻底）；
  // 落库引用为空但正文有锚点（含残留伪锚点）再 −60 —— 与历史「有锚点空表」口径一致。
  const brokenChain = rows.length === 0 && (anchors.length > 0 || residualAnchors > 0) ? 60 : 0;
  const score = Math.max(
    0,
    Math.min(
      100,
      base -
        ghost * 20 -
        brokenChain -
        noDoi * 5 -
        Math.min(20, uncitedCount * 5) -
        Math.min(10, duplicateDoi.length * 5) -
        residualAnchors * 10,
    ),
  );

  return {
    anchorTotal: anchors.length,
    maxAnchor,
    missingAnchors,
    citationRows: rows.length,
    verifiedCount: rows.filter((r) => r.verified).length,
    uncitedCount,
    duplicateDoi,
    noDoi,
    ghost,
    residualAnchors,
    residualSamples,
    score,
    issues: issues.map((i) => i.message),
    details: issues,
  };
}
