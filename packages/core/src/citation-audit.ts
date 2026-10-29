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
  score: number;
  /** 面向用户的文案（保持字符串数组的历史契约，前端/回归脚本无需改） */
  issues: string[];
  /** 结构化明细（level/code/items），供 UI 分级着色与精确定位 */
  details: CitationAuditIssue[];
}

const DEFAULT_TAIL = ['参考文献', '引用文献', '图表', '研究资料', 'references'];

/** 仅保留正文（剥掉尾部块），与 pipeline 的 tail-blocks 同口径 */
export function splitBodyForAudit(content: string, tailHeadings: string[] = DEFAULT_TAIL): string {
  const re = new RegExp(`\\n+#{1,3}\\s*(?:${tailHeadings.join('|')})(?=[\\s（(:：\\-—]|$)[^\\n]*`, 'gi');
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
  const ghost = maxAnchor > resolvable ? maxAnchor - resolvable : 0;

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

  const issues: CitationAuditIssue[] = [];
  if (ghost > 0) {
    issues.push({
      level: 'red',
      code: 'ghost-anchor',
      message: `红牌：${ghost} 个锚点编号超出已落库引用（幽灵引用），请重跑引用渲染或检查文献库`,
      items: anchors.filter((n) => n > resolvable),
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

  const noAnchors = anchors.length === 0;
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
  const score = Math.max(
    0,
    Math.min(
      100,
      base -
        ghost * 20 -
        (rows.length === 0 && anchors.length > 0 ? 60 : 0) -
        noDoi * 5 -
        Math.min(20, uncitedCount * 5) -
        Math.min(10, duplicateDoi.length * 5),
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
    score,
    issues: issues.map((i) => i.message),
    details: issues,
  };
}
