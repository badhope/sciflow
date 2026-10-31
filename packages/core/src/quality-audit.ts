/**
 * 客观质量检查器（确定性规则引擎，不调用 LLM）。
 *
 * 为什么需要：现有 7 维质量分由 LLM 打分，同一文本多次评分会漂移（实测 78→84→89），
 * 无法作为「是否变好」的稳定证据。本检查器只做可计算、可复现的硬指标判断，
 * 同一输入必然得到同一分数与同一证据列表（便于对比、回归与门禁）。
 *
 * 设计原则：
 *  - **确定性**：不含随机、不含时间、不调模型；纯函数输入文本 → 输出报告。
 *  - **可解释**：每个扣分项都带 evidence（命中的具体行/计数），不接受「感觉不好」。
 *  - **严格**：占位符、无来源断言、引用锚点断裂等属于硬伤，直接 0 分处理。
 */

export interface QualityDimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  evidence: string[];
}

export interface ObjectiveQualityReport {
  totalScore: number;
  dimensions: QualityDimension[];
  hardFails: string[];
  stats: {
    chars: number;
    cjkChars: number;
    englishWords: number;
    sections: number;
    paragraphs: number;
    sentences: number;
    citations: number;
    referenceEntries: number;
    uniqueCitations: number;
    avgSentenceChars: number;
    duplicateParagraphs: number;
    placeholderHits: number;
    /** v1.9.4：模板腔/套话命中数（「随着…的发展」「综上所述」类零信息量表述） */
    boilerplateHits: number;
    /** v1.9.4：最大章节字符占正文的份额（0-1；单章独大 = 结构失衡） */
    maxSectionShare: number;
  };
  /** 版本指纹：用于确认「同一文本同一分数」 */
  fingerprint: string;
  /** v1.9.4：本次评分采用的评审标准（多标准可切换） */
  standard: { key: string; label: string; passScore: number };
}

const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /（[^）]{0,20}(待补|待写|待填|TODO|TBD|占位|示例内容)[^）]{0,20}）/gi, label: '中文占位符' },
  { re: /\b(lorem ipsum|TODO|TBD|FIXME|placeholder)\b/gi, label: '英文占位符' },
  { re: /\[待补\]|\[待写\]|\[此处|\.\.\.\.\.\./g, label: '方括号占位' },
  { re: /(分章起草已禁用，正文为空|未检索到文献，将按通用学术结构起草)/g, label: '流水线兜底文案' },
  /**
   * 未渲染引用标记（[文献N] / [Ref:N] / [补充文献]）＝ 硬伤。
   * 背景：citation-renderer 对越界锚点的降级产物就是 [文献N]；模型绕过渲染直接输出的
   * [Ref:N] 同理。这类标记在读者眼里就是一条引用，但没有任何可溯源的文献——
   * 留在稿子里属于学术完整性硬伤，必须与「占位符」同级处理。
   * 此前不识别，导致空文献池产出的稿件（正文全是 [文献1][文献2]）引用维度 0 分
   * 却不触发任何硬伤，总分 77 可通过 80 分门禁线以下也不回炉醒目提示。
   */
  { re: /\[\s*文献\s*\d{1,3}\s*\]/g, label: '未渲染引用标记' },
  { re: /\[\s*(?:补充)?\s*Ref\s*[:：]\s*\d{1,3}\s*\]/gi, label: '未渲染引用标记' },
  { re: /\[\s*补充文献\s*\]/g, label: '未渲染引用标记' },
];

const HEDGE_OVERUSE = /(可能|也许|大概|或许|似乎|据说)/g;
const STRONG_CLAIM = /(证明了|充分证明|毋庸置疑|完全证明|必然|毫无疑问)/g;

/**
 * 名实不符检测（学术诚信硬伤）。
 *
 * 实测事故：流水线无人做实验，模型却在「结论」写「实验结果表明，该方法在真实与合成
 * 异配图上均取得了优于基线方法的性能」，同一篇文稿的「实验设置」章节又明确写
 * 「本节不报告新的原始实验」。这是编造研究成果，比文笔差严重得多，
 * 必须由确定性规则拦下（LLM 评审会给 42 分但不判硬伤）。
 */
const NO_EXPERIMENT_DISCLAIMER = [
  /(?:不报告|未开展|没有开展|未进行|没有进行|不包含|不含)[^。；\n]{0,12}(?:新的)?(?:原始)?(?:实验|实证)/g,
  /(?:本节|本文)[^。；\n]{0,20}仅(?:给出|提供|为)[^。；\n]{0,12}实验设计/g,
  /(?:具体)?(?:实验)?结果(?:将)?(?:在后续章节|另文|后续工作)[^。；\n]{0,8}(?:报告|给出|讨论)/g,
  /(?:综述|归纳|总结)[^。；\n]{0,20}(?:已有|现有)研究[^。；\n]{0,10}(?:发现|结果)/g,
];
const EXPERIMENT_RESULT_CLAIM = [
  /实验(?:结果)?(?:表明|显示|证实|证明|发现)[^。；\n]{0,60}(?:优于|超过|提升|改善|有效|显著)/g,
  /(?:本文|本研究|我们)[^。；\n]{0,40}(?:实验|实证)[^。；\n]{0,20}(?:表明|显示|证实|证明)[^。；\n]{0,40}(?:有效|优于|提升|改善)/g,
  /(?:验证|证明)了[^。；\n]{0,30}(?:方法|框架|机制|模块)[^。；\n]{0,10}(?:的)?有效性/g,
];
/** 原始实验证据：结果表 / 带数值的指标 / 数据集划分描述 */
const EXPERIMENT_EVIDENCE = [
  /^\s*\|.+\|\s*$/m,
  // 指标数值必须是真数字（百分数或小数），不能是 [3] 这种引用编号
  /\b(?:accuracy|f1|auc|precision|recall|mae|rmse)\b[^。；\n]{0,24}?\d+(?:\.\d+)?\s*(?:%|percent)/i,
  /(?:准确率|精确率|召回率|F1\s*值?|AUC|RMSE|MAE)[^。；\n]{0,24}?\d+(?:\.\d+)?\s*(?:%|个百分点)/,
  /(?:数据集|dataset)[^。；\n]{0,40}(?:训练集|测试集|划分|split)\b/i,
];


/**
 * 无状态正则测试。
 * 这些模式带 /g（用于计数），而 RegExp.prototype.test 在 /g 模式下会推进 lastIndex，
 * 同一正则第二次调用会从中间开始匹配——实测导致「综述类」判定时假（isReviewLike=false），
 * 结构维度按实证论文标准误判缺章。这里统一克隆成正则后再测。
 */
function testAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => new RegExp(re.source, re.flags.replace('g', '')).test(text));
}

function matchCount(text: string, patterns: RegExp[]): { n: number; first: string } {
  let n = 0;
  let first = '';
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      n += 1;
      if (!first) first = m[0].slice(0, 80);
      if (n > 500) return { n, first };
    }
  }
  return { n, first };
}

function countMatches(text: string, re: RegExp): number {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let n = 0;
  while (r.exec(text) !== null) {
    n += 1;
    if (n > 10_000) break; // 防御性上限
  }
  return n;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** 章节：Markdown 二级标题为主要章节 */
function splitSections(text: string): { title: string; body: string }[] {
  const lines = text.split('\n');
  const out: { title: string; body: string }[] = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      if (current) out.push({ title: current.title, body: current.body.join('\n') });
      current = { title: m[1].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) out.push({ title: current.title, body: current.body.join('\n') });
  return out;
}

function cjkCount(text: string): number {
  return (text.match(/[\u4e00-\u9fa5]/g) || []).length;
}

function englishWordCount(text: string): number {
  return (text.match(/\b[a-zA-Z][a-zA-Z'-]*\b/g) || []).length;
}

function sentenceCount(text: string): number {
  return (text.match(/[^。！？.!?]+[。！？.!?]/g) || []).length || 1;
}

/** FNV-1a 32-bit：稳定、无依赖 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `q${h.toString(16).padStart(8, '0')}`;
}

/**
 * 主入口：对一篇论文正文做确定性质量检查。
 * @param content 文档正文（可含尾部「## 参考文献」块；会自动分离统计）
 * @param opts.minChars 最低正文字数要求（默认 3000）
 */
import {
  countBoilerplate,
  parseQualityStandard,
  type QualityStandard,
  type QualityStandardKey,
} from './quality-standards';

export function checkPaperQuality(
  content: string,
  opts: { minChars?: number; minSections?: number; citationCount?: number; externalRefs?: boolean; standard?: QualityStandardKey | QualityStandard } = {},
): ObjectiveQualityReport {
  /**
   * 评审标准（v1.9.4）：阈值不再散落在函数体里，而是由「标准档位」统一给出。
   * - 未传 standard → standard（SCI 通用期刊档）：默认门槛比旧行为收紧
   *   （旧行为 3000 字/4 章/0 引用要求 → 新默认 4500 字/5 章/15 引用）。
   * - 显式传 minChars/minSections 仍生效（向后兼容旧调用与单测），并覆盖标准档对应字段。
   * - 篇幅下限的硬伤边界（500 字）保持不变——那是「空文」判据，不是标准差异。
   */
  const std = typeof opts.standard === 'string' || !opts.standard
    ? parseQualityStandard(opts.standard)
    : opts.standard;
  const minChars = opts.minChars ?? std.minChars;
  const minSections = opts.minSections ?? std.minSections;
  /**
   * 本仓库的引用契约（ARCHITECTURE §2.10 第 7 条）：正文只放 [n] 锚点，
   * 参考文献列表由前端按 CSL 样式从 citation 表渲染、导出时由 exportMarkdown 生成。
   * 因此「正文里没有 ## 参考文献 块」**不是**缺陷——只有「正文有锚点但 citation 表为空」才是。
   */
  const dbCitationCount = typeof opts.citationCount === 'number' ? Math.max(0, opts.citationCount) : null;
  // 统一换行：Windows/导出链路会把 \n 变成 \r\n，若不正则会话，所有以 ^ / $ 锚定的规则（章节、
  // 参考文献块、表格、占位符）在 CRLF 文本上全部失效——实测同一文本 LF 得 97、CRLF 得 82。
  const text = String(content || '').replace(/\r\n?/g, '\n');
  const hardFails: string[] = [];

  // 拆分正文与参考文献块（参考文献不计入正文统计，但单独核对锚点）
  const refSplit = /(^|\n)##\s*(参考文献|References)\s*\n/i.exec(text);
  const body = refSplit ? text.slice(0, refSplit.index) : text;
  const refBlock = refSplit ? text.slice(refSplit.index) : '';

  const chars = body.replace(/\s/g, '').length;
  const cjk = cjkCount(body);
  const words = englishWordCount(body);
  const sections = splitSections(body);
  const paragraphs = splitParagraphs(body);
  const sentences = sentenceCount(body);
  const citationNumbers = [...body.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
  const uniqueCitations = new Set(citationNumbers);
  const refEntries = [...refBlock.matchAll(/^\s*(?:\[(\d{1,3})\]|\d{1,3}[.、])/gm)].map((m) => Number(m[1] ?? 0)).filter((n) => n > 0);

  // 空文/过短：直接硬伤（不允许「结构 17 分」这种空文得分的假绿灯）
  if (chars === 0) hardFails.push('正文为空');
  else if (chars < 500) hardFails.push(`正文过短（${chars} 字符，最低 500）`);
  /**
   * 篇幅未达所选标准 → 硬伤（v1.9.5）。
   *
   * 实测事故：一篇 2307 字的稿子在「SCI 通用期刊」档（要求 4500 字）只拿到篇幅 5/20，
   * 却因为结构/引用/可读性等维度都是满分，总分 **89 通过 80 分门禁**。
   * 篇幅是最容易判断的硬指标：正文不到标准下限，说明这篇稿子根本没到该级别的基本体量，
   * 不该由其他维度的「形式分」把它救回来。这也是用户反馈「打分太潦草」的直接原因之一。
   * 门槛取标准下限的 90%（保留一点余量，避免 4400 字这种临界值直接被判死）。
   */
  else if (chars < minChars * 0.9) {
    hardFails.push(`篇幅未达「${std.label}」要求（${chars} 字符 < 下限 ${minChars} 的 90%，即 ${Math.round(minChars * 0.9)}）`);
  }

  // 占位符检测
  let placeholderHits = 0;
  const placeholderEvidence: string[] = [];
  for (const p of PLACEHOLDER_PATTERNS) {
    const n = countMatches(body, p.re);
    if (n > 0) {
      placeholderHits += n;
      placeholderEvidence.push(`${p.label} × ${n}`);
    }
  }
  if (placeholderHits > 0) hardFails.push(`正文含占位/兜底文案 ${placeholderHits} 处（${placeholderEvidence.join('、')}）`);

  // 重复段落
  const seen = new Map<string, number>();
  for (const p of paragraphs) {
    const key = p.slice(0, 120);
    if (key.length < 30) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  // 重复段落计数：同内容出现 ≥3 次即一组重复（回炉叠加的典型特征）
  const duplicateParagraphs = [...seen.values()].filter((n) => n >= 3).length;
  if (duplicateParagraphs >= 1) hardFails.push(`重复段落 ${duplicateParagraphs} 组（同段出现 ≥3 次，疑似拼接/回炉叠加）`);

  // 长篇正文零引用 → 硬伤（SCI 论文不可能没有任何文献支撑；短稿/回归 fixture 不触发）
  if (chars >= 5000 && citationNumbers.length === 0) hardFails.push(`长篇正文（${chars} 字符）没有任何 [n] 引用锚点`);

  // 引用锚点：正文有锚点但既无内嵌列表、citation 表也没有 → 硬伤
  const maxCitation = citationNumbers.length ? Math.max(...citationNumbers) : 0;
  /**
   * externalRefs：正文只有 [n] 锚点、参考文献列表由前端/导出统一渲染的场景（本仓库的正式契约）。
   * 离线检查一份「纯正文」文件时必须显式声明，否则会把「列表不在文件里」误判成硬伤。
   */
  const externalRefs = opts.externalRefs === true;
  if (!externalRefs && citationNumbers.length > 0 && refBlock.trim() === '' && (dbCitationCount === null || dbCitationCount === 0)) {
    hardFails.push('正文含 [n] 引用锚点但没有对应参考文献（正文无列表且 citation 表为空）');
  }
  if (maxCitation > 0 && refEntries.length > 0) {
    const refSet = new Set(refEntries);
    const dangling = [...uniqueCitations].filter((n) => !refSet.has(n));
    if (dangling.length > 0) hardFails.push(`引用锚点无对应文献条目：${dangling.slice(0, 8).join(', ')}${dangling.length > 8 ? ' …' : ''}`);
  }

  // 维度 1：结构完整性（20 分）
  const structureEvidence: string[] = [];
  let structureScore = 20;
  if (sections.length < minSections) {
    structureScore -= Math.min(12, (minSections - sections.length) * 4);
    structureEvidence.push(`二级章节 ${sections.length} 个（要求 ≥${minSections}）`);
  }
  /**
   * IMRaD 要素按文章类型判定。
   *
   * 历史缺陷：固定要求「方法 + 结果」，把诚实的框架/综述稿判成缺章——
   * 而本系统的流水线不运行实验（见 DRAFT_SECTION 名实相符约束），
   * 硬要「结果」章节只会逼模型编造实验结论。因此：
   *  - 实证类（有结果表/数值指标/自述做了实验）→ 要求 引言/方法/结果/讨论/结论；
   *  - 综述/框架类 → 要求 引言/综述或分析/讨论/结论（「方法」可由「框架/机理/评估协议」承担）。
   */
  const empiricalSignal = testAny(EXPERIMENT_EVIDENCE, body);
  const isReviewLike = !empiricalSignal && testAny(NO_EXPERIMENT_DISCLAIMER, body);
  const required = isReviewLike
    ? ['引言', '讨论', '结论']
    : ['引言', '方法', '结果', '讨论', '结论'];
  const hasReviewBody = /(相关工作|文献综述|研究现状|机理|框架|评估协议|方法)/.test(sections.map((s) => s.title).join(' '));
  const SYNONYMS: Record<string, string[]> = { 方法: ['方法', '框架', '机理'], 结果: ['结果', '实验', '评估', '分析'] };
  const missing = required.filter((r) => {
    const hit = sections.some((s) => (SYNONYMS[r] || [r]).some((k) => s.title.includes(k)));
    if (!hit && r === '方法' && hasReviewBody) return false;
    return !hit;
  });
  if (missing.length) {
    structureScore -= Math.min(12, missing.length * 3);
    structureEvidence.push(`缺少标准章节：${missing.join('、')}`);
  }
  if (sections.length >= minSections && !missing.length) {
    structureEvidence.push(`章节齐全（${sections.length} 个，${isReviewLike ? '综述/框架类要素' : '含 IMRaD 要素'}）`);
  }

  // 维度 2：篇幅（20 分）——满分线由标准档给出（fullChars），不再是 minChars*1.5
  const lengthEvidence: string[] = [];
  let lengthScore = 0;
  if (chars >= std.fullChars) lengthScore = 20;
  else if (chars >= minChars) lengthScore = Math.round(12 + 8 * (chars - minChars) / Math.max(1, std.fullChars - minChars));
  else if (chars >= minChars * 0.7) lengthScore = 9;
  else if (chars >= minChars * 0.4) lengthScore = 5;
  lengthScore = Math.max(0, Math.min(20, lengthScore));
  lengthEvidence.push(`正文 ${chars} 字符（${std.label}：要求 ≥${minChars}，满分 ${std.fullChars}）`);
  if (cjk > 0) lengthEvidence.push(`中文字符 ${cjk}，英文词 ${words}`);

  // 维度 3：引用闭环（20 分）——闭环之外加「引用强度」：唯一引用数与每章密度按标准档打折
  const citeEvidence: string[] = [];
  let citeScore = 0;
  if (citationNumbers.length === 0) {
    citeScore = 0;
    citeEvidence.push('正文无任何 [n] 引用锚点');
  } else {
    const density = citationNumbers.length / Math.max(1, sections.length);
    citeScore = 20;
    if (refBlock.trim() === '') citeScore -= 12;
    if (externalRefs && refBlock.trim() === '') citeEvidence.push('参考文献列表由前端/导出渲染（纯正文文件，按契约不判硬伤）');
    if (refEntries.length > 0 || (dbCitationCount ?? 0) > 0) {
      const refSet = new Set(refEntries);
      // 正文 [n] 与「参考文献条目编号」对齐；citation 表只提供总数时无法逐条比对，按总数判定覆盖
      const dangling = refEntries.length > 0 ? [...uniqueCitations].filter((n) => !refSet.has(n)) : [];
      const ratio = refEntries.length > 0 ? 1 - dangling.length / Math.max(1, uniqueCitations.size) : Math.min(1, (dbCitationCount ?? 0) / Math.max(1, uniqueCitations.size));
      citeScore = Math.round(20 * ratio);
      citeEvidence.push(`引用 ${uniqueCitations.size} 个编号，文献条目 ${refEntries.length || dbCitationCount} 条，可对上 ${Math.round(uniqueCitations.size * ratio)} 个`);
      if (dangling.length) citeEvidence.push(`悬空锚点：${dangling.slice(0, 8).join(', ')}`);
    } else {
      citeEvidence.push(`引用 ${uniqueCitations.size} 个编号，但未解析到参考文献条目`);
    }
    /**
     * 引用强度（v1.9.4）：闭环只保证「引了」不保证「引够」。
     * 唯一引用数低于标准下限 → 按比例打折；每章密度低于下限 → 再打八折。
     * 这是「像相对论这种级别才满分」诉求的直接落点：顶刊档 30 篇起步，
     * 一篇只引 3 篇的稿子无论格式多规范都拿不到引用满分。
     */
    const uniqRatio = Math.min(1, uniqueCitations.size / Math.max(1, std.minUniqueCitations));
    const densityRatio = Math.min(1, density / Math.max(0.1, std.minCitationsPerSection));
    const strengthFactor = Math.round(uniqRatio * densityRatio * 100) / 100;
    if (strengthFactor < 1) {
      citeScore = Math.round(citeScore * strengthFactor);
      citeEvidence.push(
        `引用强度不足（${std.label}：唯一引用 ≥${std.minUniqueCitations}、每章 ≥${std.minCitationsPerSection}；实际 ${uniqueCitations.size} / ${density.toFixed(1)}，强度系数 ${strengthFactor.toFixed(2)}）`,
      );
    }
    citeEvidence.push(`平均每章 ${density.toFixed(1)} 处引用`);
  }

  // 维度 4：可读性（20 分）——句长与段落长度；句长上限由标准档给出
  const readEvidence: string[] = [];
  const avgSentenceChars = Math.round(chars / Math.max(1, sentences));
  let readScore = 20;
  if (avgSentenceChars > std.maxAvgSentenceChars + 25) { readScore -= 8; readEvidence.push(`平均句长 ${avgSentenceChars} 字（过长，${std.label}要求 ≤${std.maxAvgSentenceChars}）`); }
  else if (avgSentenceChars > std.maxAvgSentenceChars) { readScore -= 4; readEvidence.push(`平均句长 ${avgSentenceChars} 字（偏长，${std.label}要求 ≤${std.maxAvgSentenceChars}）`); }
  else readEvidence.push(`平均句长 ${avgSentenceChars} 字（符合 ${std.label} ≤${std.maxAvgSentenceChars}）`);
  const longParagraphs = paragraphs.filter((p) => p.replace(/\s/g, '').length > 900).length;
  if (longParagraphs > 0) { readScore -= Math.min(6, longParagraphs * 2); readEvidence.push(`超长段落 ${longParagraphs} 个（>900 字）`); }
  const shortParaRatio = paragraphs.length ? paragraphs.filter((p) => p.length < 30).length / paragraphs.length : 0;
  if (shortParaRatio > 0.3) { readScore -= 3; readEvidence.push(`过短段落占比 ${(shortParaRatio * 100).toFixed(0)}%`); }
  readScore = Math.max(0, readScore);

  // 维度 5：修辞严谨（20 分）
  const rigorEvidence: string[] = [];
  let rigorScore = 20;
  const hedges = countMatches(body, HEDGE_OVERUSE);
  const strong = countMatches(body, STRONG_CLAIM);
  const perK = chars > 0 ? (hedges / chars) * 1000 : 0;
  if (perK > 8) { rigorScore -= Math.min(8, Math.round(perK)); rigorEvidence.push(`模糊限定词密度 ${perK.toFixed(1)}/千字（过高）`); }
  else rigorEvidence.push(`模糊限定词 ${hedges} 处（密度 ${perK.toFixed(1)}/千字）`);
  if (strong > 3) { rigorScore -= Math.min(8, (strong - 3) * 2); rigorEvidence.push(`强断言 ${strong} 处（无证据的「证明了」类表述）`); }
  else rigorEvidence.push(`强断言 ${strong} 处（阈值 ≤3）`);
  if (placeholderHits > 0) { rigorScore -= 8; }
  rigorScore = Math.max(0, rigorScore);

  /**
   * 维度 6：学术诚信（20 分）——名实相符。
   *
   * 规则：稿中同时出现
   *   (a) 自述「没有原始实验 / 只是归纳已有研究」的免责表述，且
   *   (b) 「实验结果表明…优于/提升/有效」类实证结论，
   * 且全文找不到任何原始实验证据（结果表 / 带数值的指标 / 数据集划分）→ 硬伤。
   * 这条规则只对「自相矛盾」的稿子开火，真正做了实验并给出数据的稿子不会误伤。
   */
  const integrityEvidence: string[] = [];
  let integrityScore = 20;
  const disclaimer = matchCount(body, NO_EXPERIMENT_DISCLAIMER);
  const claim = matchCount(body, EXPERIMENT_RESULT_CLAIM);
  const hasRawEvidence = testAny(EXPERIMENT_EVIDENCE, body);
  if (disclaimer.n > 0 && claim.n > 0 && !hasRawEvidence) {
    integrityScore = 0;
    integrityEvidence.push(
      `自述未开展原始实验（${disclaimer.n} 处，如「${disclaimer.first}」），` +
        `却给出实证结论（${claim.n} 处，如「${claim.first}」），且全文无结果表/数值指标/数据集划分`,
    );
    hardFails.push(`名实不符：声称实验结论但无任何原始实验证据（${claim.n} 处实证断言 vs ${disclaimer.n} 处无实验声明）`);
  } else if (claim.n > 0 && !hasRawEvidence && chars >= minChars) {
    // 只有实证结论、没有任何数据支撑：降分但不硬伤（可能是方法/框架稿的合理推断）
    integrityScore = 10;
    integrityEvidence.push(`实证结论 ${claim.n} 处但无结果数据支撑（无表格/指标数值/数据集划分）`);
  } else if (claim.n > 0 && hasRawEvidence) {
    integrityEvidence.push(`实证结论 ${claim.n} 处，且有结果数据支撑`);
  } else {
    integrityEvidence.push('未发现「无实验却声称实验结论」的名实不符');
  }

  /**
   * 维度 7（v1.9.4 新增）：信息密度（20 分）——针对「形式规整但内容空洞拿高分」的直接补丁。
   * 两个子项各 10 分：
   *  a) 模板腔密度：「随着…的发展」「综上所述」类零信息量表述，每千字超过标准上限按比例扣；
   *  b) 章节均衡：最大章节占正文份额超过标准上限（单章独大 = 其余章节是凑数）按比例扣。
   * 这两个信号都是确定性统计，与 LLM 无关，保持「同文同分」的契约。
   */
  const densityEvidence: string[] = [];
  let densityScore = 20;
  const boilerplateHits = countBoilerplate(body);
  const boilerplatePerKilo = chars > 0 ? (boilerplateHits / chars) * 1000 : 0;
  if (boilerplatePerKilo > std.maxBoilerplatePerKilo) {
    const sub = Math.min(10, Math.round(((boilerplatePerKilo - std.maxBoilerplatePerKilo) / Math.max(1, std.maxBoilerplatePerKilo)) * 10));
    densityScore -= sub;
    densityEvidence.push(`模板腔 ${boilerplateHits} 处（${boilerplatePerKilo.toFixed(1)}/千字，${std.label}上限 ${std.maxBoilerplatePerKilo}）——如「随着…的发展」「综上所述」类空转表述`);
  } else {
    densityEvidence.push(`模板腔 ${boilerplateHits} 处（${boilerplatePerKilo.toFixed(1)}/千字，符合 ${std.label} ≤${std.maxBoilerplatePerKilo}）`);
  }
  const sectionCharsList = sections.map((s) => s.body.replace(/\s/g, '').length);
  const maxSectionShare = chars > 0 ? Math.max(...sectionCharsList, 0) / chars : 0;
  if (sections.length >= 2 && maxSectionShare > std.maxSectionShare) {
    const sub = Math.min(10, Math.round(((maxSectionShare - std.maxSectionShare) / Math.max(0.05, 1 - std.maxSectionShare)) * 10));
    densityScore -= sub;
    const biggest = sections.reduce((m, s) => (s.body.length > m.body.length ? s : m), sections[0]);
    densityEvidence.push(`章节失衡：「${biggest.title}」独占 ${(maxSectionShare * 100).toFixed(0)}% 正文（${std.label}上限 ${(std.maxSectionShare * 100).toFixed(0)}%），其余章节疑似凑数`);
  } else {
    densityEvidence.push(`章节均衡（最大章占比 ${(maxSectionShare * 100).toFixed(0)}%，符合 ${std.label} ≤${(std.maxSectionShare * 100).toFixed(0)}%）`);
  }
  densityScore = Math.max(0, densityScore);

  // 七个维度各 20 分 → 归一到 100（信息密度与诚信同权重：内容空洞与学术不端同级别扣分）
  const dimensions: QualityDimension[] = [
    { key: 'structure', label: '结构完整性', score: Math.max(0, Math.round(structureScore)), weight: 1, evidence: structureEvidence },
    { key: 'length', label: '篇幅达标', score: lengthScore, weight: 1, evidence: lengthEvidence },
    { key: 'citation', label: '引用闭环与强度', score: Math.max(0, Math.round(citeScore)), weight: 1, evidence: citeEvidence },
    { key: 'readability', label: '可读性', score: readScore, weight: 1, evidence: readEvidence },
    { key: 'rigor', label: '修辞严谨', score: rigorScore, weight: 1, evidence: rigorEvidence },
    { key: 'integrity', label: '学术诚信', score: integrityScore, weight: 1, evidence: integrityEvidence },
    { key: 'density', label: '信息密度', score: densityScore, weight: 1, evidence: densityEvidence },
  ];

  const weighted = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
  const normalized = Math.round((weighted / (dimensions.length * 20)) * 100);
  // 硬伤封顶：空文/过短直接 0；其它硬伤封顶 40（不论其他维度多好）
  const fatal = hardFails.some((f) => f.includes('正文为空') || f.includes('正文过短'));
  const totalScore = fatal ? 0 : hardFails.length > 0 ? Math.min(40, normalized) : normalized;

  return {
    totalScore,
    dimensions,
    hardFails,
    stats: {
      chars, cjkChars: cjk, englishWords: words, sections: sections.length, paragraphs: paragraphs.length,
      sentences, citations: citationNumbers.length,
      uniqueCitations: uniqueCitations.size,
      referenceEntries: refEntries.length || (dbCitationCount ?? 0),
      avgSentenceChars, duplicateParagraphs, placeholderHits,
      boilerplateHits,
      maxSectionShare: Math.round(maxSectionShare * 100) / 100,
    },
    standard: { key: std.key, label: std.label, passScore: std.passScore },
    fingerprint: fnv1a(`${std.key}|${totalScore}|${chars}|${sections.length}|${citationNumbers.length}|${text.length}`),
  };
}
