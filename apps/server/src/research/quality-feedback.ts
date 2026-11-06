/**
 * 质量反馈结构化（纯函数）。
 *
 * 质量门的 feedback 是一段自然语言，之前拆条后只会挂一个整体维度名、sectionRef 恒为空，
 * 用户拿到的是「一堆没有落点的句子」。这里把每条反馈映射到：
 *  - section：命中的论文章节标题（从正文标题里找），找不到则为空（全局意见）；
 *  - severity：硬伤/致命 → blocker，明确缺陷 → major，其余 → minor；
 *  - dimension：可识别的维度 key（与质量报告 scores 的 key 一致），识别不出返回空。
 * 全部基于确定性关键词与标题匹配，同一输入必然同一输出。
 */

import { extractSections } from '../documents/section-restore';

export type FeedbackSeverity = 'blocker' | 'major' | 'minor';

export interface StructuredFeedback {
  text: string;
  section: string;
  severity: FeedbackSeverity;
  dimension: string;
}

const DIMENSION_RULES: { key: string; re: RegExp }[] = [
  { key: 'citation', re: /引用|文献|著录|参考文献|citation|reference/i },
  { key: 'language', re: /语言|表达|措辞|可读|语法|术语|language|readability|grammar/i },
  { key: 'structure', re: /结构|章节|层次|逻辑|组织|structure|organi[sz]ation/i },
  { key: 'figures', re: /图表|表格|图\s*\d|figure|table|plot/i },
  { key: 'format', re: /格式|摘要长度|关键词|单位|format|abstract length|keyword/i },
  { key: 'novelty', re: /创新|新颖|贡献|novelty|contribution/i },
  { key: 'literature', re: /综述|覆盖|研究现状|literature|survey|related work/i },
  { key: 'integrity', re: /诚信|编造|虚构|无法溯源|integrity|fabricat/i },
];

const SEVERITY_RULES: { level: FeedbackSeverity; re: RegExp }[] = [
  { level: 'blocker', re: /硬伤|致命|严重缺陷|无法通过|blocker|critical|fatal/i },
  { level: 'major', re: /缺失|不足|不一致|不符合|缺少|major|missing|inconsistent/i },
];

function severityOf(text: string): FeedbackSeverity {
  for (const rule of SEVERITY_RULES) {
    if (rule.re.test(text)) return rule.level;
  }
  return 'minor';
}

function dimensionOf(text: string): string {
  for (const rule of DIMENSION_RULES) {
    if (rule.re.test(text)) return rule.key;
  }
  return '';
}

function splitFeedback(feedback: string): string[] {
  return (feedback || '')
    .split(/[\n;；]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

/** 依据正文标题，把一条反馈定位到最可能的章节；无法定位返回空字符串。 */
function sectionOf(text: string, sectionTitles: string[]): string {
  const hay = text.toLowerCase();
  let best = '';
  for (const title of sectionTitles) {
    if (!title.trim()) continue;
    const needle = title.trim().toLowerCase();
    if (hay.includes(needle) && needle.length > best.length) best = title.trim();
  }
  // 未显式点名章节时，用「本节/该节/第 N 章」等泛指不定位（宁可空也不猜）
  return best;
}

/** 把一段质量反馈结构化为可定位、可定级、可勾选的条目。 */
export function structureFeedback(feedback: string, documentContent = ''): StructuredFeedback[] {
  const titles = extractSections(documentContent).map((s) => s.title).filter(Boolean);
  return splitFeedback(feedback).map((text) => ({
    text,
    section: sectionOf(text, titles),
    severity: severityOf(text),
    dimension: dimensionOf(text),
  }));
}
