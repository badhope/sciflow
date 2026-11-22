/**
 * 研究计划一致性审计（确定性规则，不调用 LLM）。
 *
 * 为什么需要：
 *  - 模型能写出结构完整的研究计划，但常在样本流、周期间隔、构念来源、
 *    量表具体性、查新证据、选刊具体性上出现内部矛盾；这些错误适合用规则先拦。
 *  - 结果是“可执行门禁”，不是论文质量评分：blocker 存在时，计划不能标为可执行。
 *
 * 设计边界：
 *  - 只做文本规则检查，不理解领域语义；宁可选“警告”也不做过度判断。
 *  - 兼容中英文数字、全角/半角标点与常见 Markdown 表格。
 */

export type PlanAuditSeverity = 'blocker' | 'warning' | 'info';

export type PlanAuditCategory =
  | 'sample'
  | 'timeline'
  | 'construct'
  | 'measurement'
  | 'novelty'
  | 'journal'
  | 'references'
  | 'terminology';

export interface PlanAuditFinding {
  id: string;
  severity: PlanAuditSeverity;
  category: PlanAuditCategory;
  message: string;
  evidence?: string;
  suggestion: string;
}

export interface PlanAuditMetrics {
  t1Target?: number;
  pairedTarget?: number;
  attritionPct?: number;
  t1Weeks?: string;
  t2Weeks?: string;
  gapWeeks?: number;
  lagWeeks?: number;
}

export interface PlanAuditResult {
  ok: boolean;
  title: string;
  chars: number;
  score: number;
  blockers: number;
  warnings: number;
  findings: PlanAuditFinding[];
  metrics: PlanAuditMetrics;
  summary: string;
}

/** 全角数字/破折号归一，避免模型混用标点导致规则漏检。 */
function normalize(text: string): string {
  return String(text || '')
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[–—]/g, '-')
    .replace(/[～]/g, '~')
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',');
}

function clampInt(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function firstLine(text: string, max = 180): string {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  return line.trim().slice(0, max);
}

/** 从某个标题行截到下一个同级或更高级标题；用于把“目标期刊”与“参考文献里的刊名”分开。 */
function extractSection(text: string, heading: RegExp): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return '';
  const level = (lines[start].match(/^#+/)?.[0] || '#').length;
  const out: string[] = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const nextLevel = (lines[i].match(/^#+/)?.[0] || '').length;
    if (nextLevel && nextLevel <= level) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function findNumber(label: RegExp, text: string): number | undefined {
  const m = text.match(label);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function findRange(label: RegExp, text: string): { min: number; max: number; evidence: string } | undefined {
  const m = text.match(label);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { min: Math.min(a, b), max: Math.max(a, b), evidence: m[0] };
}

function parseWeekRange(line: string): { start: number; end: number } | undefined {
  const m = line.match(/W\s*(\d+)(?:\s*[-~至]\s*W?\s*(\d+))?/i);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** 找包含 T1/T2 的表格行或任务行，并解析其中的周区间。 */
function findWaveWeeks(text: string, wave: 'T1' | 'T2'): { start: number; end: number; evidence: string } | undefined {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes(wave)) continue;
    const range = parseWeekRange(line);
    if (!range) continue;
    // 只接受同时含任务语义的行，避免把“W1–W12 时间表”这种标题当成数据收集周。
    if (!/数据|收集|问卷|调查|招募|回收|T1|T2/.test(line)) continue;
    return { ...range, evidence: line.trim().slice(0, 180) };
  }
  return undefined;
}

function add(
  findings: PlanAuditFinding[],
  id: string,
  severity: PlanAuditSeverity,
  category: PlanAuditCategory,
  message: string,
  suggestion: string,
  evidence?: string,
): void {
  findings.push({ id, severity, category, message, suggestion, evidence });
}

/** 样本流：T1 目标 → 流失率 → 配对样本；不一致直接 blocker。 */
function auditSample(text: string, findings: PlanAuditFinding[], metrics: PlanAuditMetrics): void {
  const t1 = findRange(/T1[^。\n]{0,50}?(\d{2,4})(?:\s*[-~至]\s*(\d{2,4}))?\s*(?:人|名|份)/, text);
  const paired = findNumber(/(?:配对样本|配对数据|有效配对)[^。\n]{0,25}?(?:≥|>=|不低于|至少|不少于)\s*(\d{2,4})/, text)
    ?? findNumber(/T2[^。\n]{0,30}?(?:≥|>=|不低于|至少|不少于)\s*(\d{2,4})\s*(?:人|名|份)/, text);
  const attrition = findNumber(/(?:流失率|损耗率|脱落率)[^。\n]{0,15}?(\d{1,2})\s*%/, text);
  if (t1) metrics.t1Target = t1.max;
  if (paired) metrics.pairedTarget = paired;
  if (attrition !== undefined) metrics.attritionPct = attrition;

  if (!t1 || !paired) return;
  const expected = Math.floor(t1.max * (attrition === undefined ? 1 : 1 - attrition / 100));
  if (expected < paired) {
    add(
      findings,
      'sample-flow',
      'blocker',
      'sample',
      `样本流不闭合：T1 上限 ${t1.max} 人、流失率 ${attrition === undefined ? '未写' : `${attrition}%`}，最多得到约 ${expected} 个配对样本，但计划要求 ${paired} 个。`,
      `二选一：把 T1 提高到至少 ${Math.ceil(paired / (attrition === undefined ? 1 : 1 - attrition / 100))} 人；或把配对目标降到 ${expected} 人并重算间接效应检验力。`,
      t1.evidence,
    );
  } else {
    add(
      findings,
      'sample-flow-ok',
      'info',
      'sample',
      `样本流可闭合：T1 上限 ${t1.max} 人，按流失率 ${attrition === undefined ? 0 : attrition}% 估算可得到约 ${expected} 个配对样本，覆盖目标 ${paired} 个。`,
      '保持 T1 与 T2 的样本口径一致，并在方法部分报告实际流失率。',
      t1.evidence,
    );
  }
}

/** 周期间隔：T1 结束到 T2 开始的周数必须 ≥ 计划声明的间隔。 */
function auditTimeline(text: string, findings: PlanAuditFinding[], metrics: PlanAuditMetrics): void {
  const t1 = findWaveWeeks(text, 'T1');
  const t2 = findWaveWeeks(text, 'T2');
  const lag = findNumber(/间隔\s*(?:约\s*)?(\d{1,2})\s*周/, text);
  if (t1) metrics.t1Weeks = `W${t1.start}-W${t1.end}`;
  if (t2) metrics.t2Weeks = `W${t2.start}-W${t2.end}`;
  if (lag !== undefined) metrics.lagWeeks = lag;

  if (t1 && t2) {
    const gap = t2.start - t1.end;
    metrics.gapWeeks = gap;
    if (gap < 0) {
      add(
        findings,
        'timeline-overlap',
        'blocker',
        'timeline',
        `排期重叠：T1 在 W${t1.start}-W${t1.end} 收集，T2 却在 W${t2.start} 开始，T2 早于 T1 结束。`,
        '把 T2 起点推到 T1 结束之后，并按个体 T1 完成时间计算间隔。',
        `${t1.evidence} / ${t2.evidence}`,
      );
    } else if (lag !== undefined && gap < lag) {
      add(
        findings,
        'timeline-lag',
        'blocker',
        'timeline',
        `间隔不成立：计划写“间隔 ${lag} 周”，但 T1 在 W${t1.end} 结束、T2 在 W${t2.start} 开始，实际只有 ${gap} 周。`,
        `把 T2 改到 W${t1.end + lag} 之后，或把间隔改成 ${gap} 周并说明对因果推断的影响；不要只加一句“需前移”。`,
        `${t1.evidence} / ${t2.evidence}`,
      );
    }
  }

  const irbLine = text.split(/\r?\n/).find((l) => /IRB|伦理审查|伦理审批/.test(l) && /W\s*\d+/i.test(l));
  const irb = irbLine ? parseWeekRange(irbLine) : undefined;
  if (irb && t1) {
    const gap = t1.start - irb.start;
    if (gap <= 0) {
      add(
        findings,
        'timeline-irb',
        'blocker',
        'timeline',
        `伦理审批与数据收集冲突：IRB 在 W${irb.start}，T1 在 W${t1.start}，没有等待审批的时间。`,
        '把 IRB 提交提前到数据收集前至少 4 周，并在计划里写清审批周期假设。',
        irbLine,
      );
    } else if (gap < 4) {
      add(
        findings,
        'timeline-irb-short',
        'warning',
        'timeline',
        `IRB 到 T1 只有 ${gap} 周；若机构审批超过 ${gap} 周，数据收集会整体延后。`,
        '在风险表里写清审批周期，或把 T1 起点后移；不要把“提交 IRB”当成“拿到批号”。',
        irbLine,
      );
    }
  }

  const recruit = findRange(/招募[^。\n]{0,30}?(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*周/, text);
  if (recruit && t1) {
    const t1Weeks = t1.end - t1.start + 1;
    if (recruit.min > t1Weeks) {
      add(
        findings,
        'timeline-recruit',
        'warning',
        'timeline',
        `招募周期 ${recruit.min}-${recruit.max} 周，但 T1 数据收集只排了 ${t1Weeks} 周；招募与收集可能重叠或冲突。`,
        '把招募起点放在 T1 之前，或延长 T1 窗口；在时间表里分别列出“招募”和“T1 收集”。',
        recruit.evidence,
      );
    }
  }
}

/** 构念：IV 与中介不能同源同词，尤其不能都是员工自评“感知”。 */
function auditConstruct(text: string, findings: PlanAuditFinding[]): void {
  const lines = text.split(/\r?\n/);
  const tableRows = lines.filter((l) => l.trim().startsWith('|'));
  const ivRow = tableRows.find((l) => /自变量/.test(l) && /HR|人力资源|实践/.test(l));
  const mediatorRow = tableRows.find((l) => /中介/.test(l) && /感知|可用|心理/.test(l));
  const selfReport = /自评|员工评|员工报告|自我报告/;
  if (ivRow && mediatorRow && selfReport.test(ivRow) && selfReport.test(mediatorRow)) {
    add(
      findings,
      'construct-same-source',
      'blocker',
      'construct',
      '自变量与中介都来自员工自评，且都涉及“感知/实践”；H2 可能变成同源构念互测，区分效度难以成立。',
      '把自变量改为 HR 经理报告、企业档案或制度文本；若做不到，把中介改成心理可得性/资源获取，并报告区分效度与共同方法偏差。',
      `${ivRow.trim()} / ${mediatorRow.trim()}`,
    );
  }

  const routePerception = /员工对\s*HR\s*实践的感知|员工对人力资源实践的感知/.test(text);
  const orgProvision = /组织提供(?:的)?\s*HR\s*实践|组织提供(?:的)?\s*人力资源实践/.test(text);
  if (routePerception && orgProvision) {
    add(
      findings,
      'construct-definition-conflict',
      'blocker',
      'construct',
      '同一份计划里，路线 B 把“员工对 HR 实践的感知”当自变量，RQ 又把“组织提供的 HR 实践”当自变量；这不是同一个构念。',
      '二选一：自变量用组织侧数据（HR 经理/档案/制度文本），或把 RQ 改成“员工感知的 HR 实践”；不要在同一研究里混用两种定义。',
      firstLine(text, 220),
    );
  }

  if (orgProvision && /感知可用/.test(text) && !/HR\s*经理|HR经理|企业档案|制度文本|主管评/.test(text)) {
    add(
      findings,
      'construct-org-source',
      'warning',
      'construct',
      '计划用“组织提供”作为自变量，但没有写清组织侧来源；若仍由员工填写，就会和“感知可用性”重叠。',
      '在测量表增加“评定来源”一列：组织提供由谁评、感知可用由谁评、因变量由谁评。',
      firstLine(text, 220),
    );
  }
}

/** 测量：量表不能只写“已发表量表”；自编量表需要够用的预试证据。 */
function auditMeasurement(text: string, findings: PlanAuditFinding[]): void {
  const vagueScale = /具体量表须检索|本计划不指定具体条目|已发表量表（具体|量表待定/.test(text);
  const named = /(UWES|Utrecht|MBI|Maslach|JD-R|Job Demands|AMO|HR system strength|心理可得性量表)/i.test(text);
  if (vagueScale || !named) {
    add(
      findings,
      'measurement-vague',
      'warning',
      'measurement',
      '测量方案没有点名可核验的量表：读者无法判断条目、信度、授权与中文版是否存在。',
      '至少点名 2 个候选量表，写清作者/年份/条目数/中文版授权状态；找不到就列“量表检索记录”，不要只写“已发表量表”。',
      firstLine(text, 220),
    );
  }

  const selfMade = /自编|改编量表/.test(text);
  const pilot = findRange(/(?:预试|预调查|认知访谈)[^。\n]{0,30}?(\d{1,3})\s*[-~至]\s*(\d{1,3})\s*人/, text);
  if (selfMade && pilot && pilot.max < 30) {
    add(
      findings,
      'measurement-pilot-small',
      'warning',
      'measurement',
      `自编/改编量表只安排了 ${pilot.min}-${pilot.max} 人预试；这个量级做不了稳定的 EFA，也不足以支持新构念。`,
      '把预试扩到至少 100-200 人做 EFA，再用独立正式样本做 CFA；或改用成熟量表。',
      pilot.evidence,
    );
  }
}

/** 查新：核心理论缺口不能只写“需核实”而没有检索记录。 */
function auditNovelty(text: string, findings: PlanAuditFinding[]): void {
  const gapSection = /理论缺口|研究缺口|novelty/i.test(text);
  const needsCheck = /需(?:要)?(?:通过)?系统检索|尚未核验|需核实|不得直接作为新颖性主张/.test(text);
  const hasSearchRecord =
    /OpenAlex|Crossref|Web of Science|CNKI|知网|PubMed|arXiv|Google Scholar/.test(text) ||
    /(?:检索记录|命中数|检索命中)[^。\n]{0,16}\d+/.test(text);
  if (gapSection && needsCheck && !hasSearchRecord) {
    add(
      findings,
      'novelty-unverified',
      'blocker',
      'novelty',
      '核心理论缺口只写了“需核实/需系统检索”，没有任何检索式、数据库或命中记录；RQ 仍建立在这个未核验缺口上。',
      '先调用 research.novelty 或 literature.discover，把检索式、库、命中数和最相近的 3 篇写进文档；确认缺口后再定 RQ。',
      firstLine(text, 240),
    );
  }

  if (gapSection && !/最相近|相近工作|重叠|增量|已有研究做到/.test(text)) {
    add(
      findings,
      'novelty-no-comparison',
      'warning',
      'novelty',
      '理论缺口段落没有列出最相近的研究与本文增量；审稿人会问“这和已有研究有什么不同”。',
      '补一张“最相近 3-5 篇 / 它们做了什么 / 本文改变什么”的对比表。',
      firstLine(text, 240),
    );
  }
}

/** 选刊：可以不给 IF，但不能只有“三区/四区”而没有具体刊名。 */
function auditJournal(text: string, findings: PlanAuditFinding[]): void {
  const section = extractSection(text, /^#{2,4}\s*.*(?:目标期刊|选刊|投稿风险|期刊分层|期刊匹配|选刊策略|期刊)/m);
  const scoped = section || text;
  const hasJournalHeading = Boolean(section);
  const tierOnly = /三区|四区|二区|一区|CSSCI|SSCI/.test(scoped);
  const namedJournal = /(Human Resource Management|Journal of Management|Personnel Psychology|Personnel Review|International Journal of Human Resource|Academy of Management|Journal of Organizational Behavior|Journal of Managerial Psychology)/i.test(scoped);
  if ((hasJournalHeading || /目标期刊|选刊|投稿风险|期刊分层|期刊匹配|选刊策略/.test(text)) && tierOnly && !namedJournal) {
    add(
      findings,
      'journal-no-name',
      'warning',
      'journal',
      '选刊只给了分区/层级，没有具体刊名；作者无法据此查 scope、字数和审稿周期。',
      '调用 submission.match 生成 3-6 本候选，写清刊名、scope 匹配理由、待核验的 IF/分区；不要用“三区/四区”代替选刊。',
      firstLine(text, 220),
    );
  }
}

/** 文献时效：计划里应能看到近五年的核心文献，而不是只有经典理论。 */
function auditReferences(text: string, findings: PlanAuditFinding[]): void {
  const refIndex = text.search(/^#{2,3}\s*(?:\d+\.?\s*)?参考文献/m);
  if (refIndex < 0) return;
  const refs = text.slice(refIndex);
  const years = [...refs.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
  if (!years.length) return;
  const currentYear = new Date().getFullYear();
  const recent = years.filter((y) => y >= currentYear - 5).length;
  const maxYear = Math.max(...years);
  if (recent < 3 || maxYear < currentYear - 5) {
    add(
      findings,
      'references-stale',
      'warning',
      'references',
      `参考文献里近五年（${currentYear - 5}-${currentYear}）只有 ${recent} 条，最新年份 ${maxYear}；理论经典不能替代近期实证。`,
      '补 2020 年以来的 HRM 实施、HR 系统强度、员工体验/感知可用性文献，至少 3-5 条，并逐条核对卷期 DOI。',
      `近五年 ${recent} 条 / 最新 ${maxYear}`,
    );
  }
}

/** 术语：横断与纵向不能混成一个设计名。 */
function auditTerminology(text: string, findings: PlanAuditFinding[]): void {
  if (/横断\s*[-—~至]\s*纵向|横断.*纵向混合/.test(text)) {
    add(
      findings,
      'terminology-design',
      'warning',
      'terminology',
      '“横断—纵向混合设计”不是标准术语：两波追踪就是纵向设计；横断+纵向是两种设计，不能合成一个名字。',
      '改成“两波时间滞后设计（two-wave lagged design）”；若只有一波，就写“横断面设计”。',
      firstLine(text, 180),
    );
  }
}

export function auditResearchPlan(content: string, title = ''): PlanAuditResult {
  const text = normalize(content);
  const findings: PlanAuditFinding[] = [];
  const metrics: PlanAuditMetrics = {};

  if (text.trim().length < 50) {
    add(
      findings,
      'plan-too-short',
      'blocker',
      'terminology',
      '计划正文过短（少于 50 字），无法进行一致性审计；空文档不能标为可执行。',
      '先写入完整的研究问题、样本、测量、排期与查新记录，再运行审计。',
    );
  }

  auditSample(text, findings, metrics);
  auditTimeline(text, findings, metrics);
  auditConstruct(text, findings);
  auditMeasurement(text, findings);
  auditNovelty(text, findings);
  auditJournal(text, findings);
  auditReferences(text, findings);
  auditTerminology(text, findings);

  const blockers = findings.filter((f) => f.severity === 'blocker').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const score = clampInt(100 - blockers * 18 - warnings * 6);
  const ok = blockers === 0;
  const summary = ok
    ? warnings
      ? `通过硬门禁，但有 ${warnings} 条警告；可执行，需在投稿前关闭警告。`
      : '通过硬门禁，未发现样本流、排期、构念同源、查新证据等硬冲突。'
    : `未通过：${blockers} 个 blocker、${warnings} 个警告；先修 blocker，再谈可执行/可投稿。`;

  return {
    ok,
    title: String(title || '').trim(),
    chars: String(content || '').length,
    score,
    blockers,
    warnings,
    findings,
    metrics,
    summary,
  };
}
