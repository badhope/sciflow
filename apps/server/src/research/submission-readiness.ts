import { checkPaperQuality } from '../common/quality-audit';
import { parseQualityStandard, type QualityStandard, type QualityStandardKey } from '../common/quality-standards';

export type ReadinessStatus = 'pass' | 'warn' | 'fail';

export interface SubmissionReadinessItem {
  key: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
}

export interface SubmissionReadinessStats {
  chars: number;
  sections: number;
  citations: number;
  uniqueCitations: number;
  referenceEntries: number;
  libraryReferences: number;
  citationLinks: number;
}

export interface SubmissionReadinessResult {
  ready: boolean;
  score: number;
  failCount: number;
  warnCount: number;
  standard: {
    key: string;
    label: string;
    passScore: number;
    minChars: number;
    minSections: number;
    minUniqueCitations: number;
  };
  items: SubmissionReadinessItem[];
  stats: SubmissionReadinessStats;
}

export interface SubmissionReadinessInput {
  title: string;
  content: string;
  /** 项目文献库条数 */
  libraryReferences: number;
  /** 文档级 citation 表记录数 */
  citationLinks: number;
  standard?: QualityStandardKey | QualityStandard;
}

const WEIGHTS: Record<string, number> = {
  title: 5,
  length: 15,
  structure: 15,
  citations: 20,
  references: 15,
  abstract: 10,
  keywords: 5,
  quality: 15,
};

/**
 * 投稿就绪口径：草稿档只服务写作流水线，不能作为“能不能交”的放行标准。
 * 项目仍是草稿档时自动抬到 SCI 通用期刊；会议/综述/顶刊保持用户选择。
 */
export function resolveReadinessStandard(value: unknown): QualityStandardKey {
  const key = parseQualityStandard(value).key;
  return key === 'draft' ? 'standard' : key;
}

/** 摘要 / 关键词块检测：只认行首或标题行，不把正文里顺带提到的“摘要”当成结构块 */
const ABSTRACT_BLOCK = /(^|\n)\s*(?:#{1,6}\s*)?(摘要|abstract)\s*(?:[:：]|\n|$)/i;
const KEYWORDS_BLOCK = /(^|\n)\s*(?:#{1,6}\s*)?(关键词|关键字|keywords?)\s*(?:[:：]|\n|$)/i;

function item(key: keyof typeof WEIGHTS, label: string, status: ReadinessStatus, detail: string): SubmissionReadinessItem {
  return { key, label, status, detail };
}

/**
 * 投稿就绪检查（确定性，不调模型）。
 *
 * 与「质量评审」的分工：质量评审回答“稿子好不好”，这里回答“能不能交”。
 * 复用 `checkPaperQuality` 的同一套客观标准（SCI 通用/顶刊/综述/会议），
 * 但草稿迭代档不能作为投稿放行口径，会先抬到 SCI 通用期刊。
 * 额外核对项目文献库、citation 表、摘要/关键词块和标题，避免出现
 * “质量分够高、但文献库是空的、正文引用锚点全是断的”这种假就绪。
 */
export function assessSubmissionReadiness(input: SubmissionReadinessInput): SubmissionReadinessResult {
  const standard = parseQualityStandard(input.standard);
  const content = String(input.content || '').replace(/\r\n?/g, '\n');
  const report = checkPaperQuality(content, {
    citationCount: input.citationLinks,
    standard,
  });
  const stats = report.stats;
  const items: SubmissionReadinessItem[] = [];

  const title = String(input.title || '').trim();
  if (!title || title === '未命名' || title === '未命名论文') {
    items.push(item('title', '稿件标题', 'fail', '标题为空或仍是占位标题，投稿系统无法识别。'));
  } else if (title.length < 4) {
    items.push(item('title', '稿件标题', 'warn', `标题仅 ${title.length} 个字，建议改成可检索的完整题目。`));
  } else {
    items.push(item('title', '稿件标题', 'pass', `标题：${title}`));
  }

  const fatal = report.hardFails.some((f) => f.includes('正文为空') || f.includes('正文过短'));
  if (fatal || stats.chars < 500) {
    items.push(item('length', '正文篇幅', 'fail', `正文 ${stats.chars} 字，低于 500 字硬伤线；请先补齐正文。`));
  } else if (stats.chars < standard.minChars) {
    items.push(
      item('length', '正文篇幅', 'warn', `正文 ${stats.chars} 字，低于「${standard.label}」要求的 ${standard.minChars} 字。`),
    );
  } else {
    items.push(item('length', '正文篇幅', 'pass', `正文 ${stats.chars} 字，达到「${standard.label}」的 ${standard.minChars} 字线。`));
  }

  const structure = report.dimensions.find((d) => d.key === 'structure');
  const structureScore = structure?.score ?? 0;
  if (structureScore >= 16) {
    items.push(item('structure', '章节结构', 'pass', `二级章节 ${stats.sections} 个，结构维度 ${structureScore}/20。`));
  } else if (structureScore >= 10) {
    items.push(item('structure', '章节结构', 'warn', `二级章节 ${stats.sections} 个，结构维度仅 ${structureScore}/20，建议补齐 IMRaD。`));
  } else {
    items.push(item('structure', '章节结构', 'fail', `结构维度 ${structureScore}/20，章节不足或严重失衡。`));
  }

  const unique = stats.uniqueCitations;
  if (input.citationLinks === 0 || unique === 0) {
    items.push(
      item('citations', '正文引用闭环', 'fail', `正文 [n] 锚点 ${unique} 个、citation 表 ${input.citationLinks} 条；没有可溯源引用不能投。`),
    );
  } else if (unique < standard.minUniqueCitations) {
    items.push(
      item(
        'citations',
        '正文引用闭环',
        'warn',
        `正文唯一引用 ${unique} 个，低于「${standard.label}」的 ${standard.minUniqueCitations} 个；citation 表 ${input.citationLinks} 条。`,
      ),
    );
  } else {
    items.push(item('citations', '正文引用闭环', 'pass', `正文唯一引用 ${unique} 个，citation 表 ${input.citationLinks} 条。`));
  }

  if (input.libraryReferences === 0) {
    items.push(item('references', '项目文献库', 'fail', '文献库为空；投稿前至少要有可核验的参考文献条目。'));
  } else if (input.libraryReferences < standard.minUniqueCitations) {
    items.push(
      item('references', '项目文献库', 'warn', `文献库 ${input.libraryReferences} 条，少于「${standard.label}」建议的 ${standard.minUniqueCitations} 条。`),
    );
  } else {
    items.push(item('references', '项目文献库', 'pass', `文献库 ${input.libraryReferences} 条，覆盖标准要求。`));
  }

  if (ABSTRACT_BLOCK.test(content.slice(0, 8000))) {
    items.push(item('abstract', '摘要块', 'pass', '检测到摘要/Abstract 结构块。'));
  } else {
    items.push(item('abstract', '摘要块', 'warn', '未检测到「摘要 / Abstract」结构块；多数期刊要求独立摘要。'));
  }

  if (KEYWORDS_BLOCK.test(content.slice(0, 8000))) {
    items.push(item('keywords', '关键词块', 'pass', '检测到关键词/Keywords 结构块。'));
  } else {
    items.push(item('keywords', '关键词块', 'warn', '未检测到「关键词 / Keywords」结构块；投稿系统通常必填。'));
  }

  if (report.hardFails.length > 0) {
    items.push(item('quality', '质量门', 'fail', `客观检查有硬伤：${report.hardFails.slice(0, 2).join('；')}`));
  } else if (report.totalScore < standard.passScore) {
    items.push(
      item('quality', '质量门', 'fail', `客观质量分 ${report.totalScore}，低于「${standard.label}」及格线 ${standard.passScore}。`),
    );
  } else {
    items.push(item('quality', '质量门', 'pass', `客观质量分 ${report.totalScore}，达到及格线 ${standard.passScore}。`));
  }

  const failCount = items.filter((i) => i.status === 'fail').length;
  const warnCount = items.filter((i) => i.status === 'warn').length;
  const weighted = items.reduce((sum, i) => {
    const weight = WEIGHTS[i.key] ?? 0;
    if (i.status === 'pass') return sum + weight;
    if (i.status === 'warn') return sum + weight * 0.5;
    return sum;
  }, 0);
  const maxWeight = items.reduce((sum, i) => sum + (WEIGHTS[i.key] ?? 0), 0);

  return {
    ready: failCount === 0,
    score: maxWeight ? Math.round((weighted / maxWeight) * 100) : 0,
    failCount,
    warnCount,
    standard: {
      key: standard.key,
      label: standard.label,
      passScore: standard.passScore,
      minChars: standard.minChars,
      minSections: standard.minSections,
      minUniqueCitations: standard.minUniqueCitations,
    },
    items,
    stats: {
      chars: stats.chars,
      sections: stats.sections,
      citations: stats.citations,
      uniqueCitations: stats.uniqueCitations,
      referenceEntries: stats.referenceEntries,
      libraryReferences: input.libraryReferences,
      citationLinks: input.citationLinks,
    },
  };
}
