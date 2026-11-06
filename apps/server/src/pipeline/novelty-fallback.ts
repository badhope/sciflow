/**
 * 新颖性预检的确定性降级（纯函数）。
 *
 * 学术库不可达/关闭时，之前只返回 `skipped: true` —— 用户拿到的是「不知道」。
 * 这里用两组本地证据做出可解释的降级判断，绝不假装联网查过：
 *   1) 项目内已有文献/知识库命中（本地库是用户自己的证据池）；
 *   2) 选题自身的「特异性信号」：是否含具体方法/数据集/限定语，还是泛泛的大词。
 * 输出始终标记 basis='offline-fallback'，UI 必须展示该来源，避免被误读为联网检索结论。
 */

export interface NoveltyFallbackInput {
  topic: string;
  /** 本地库中与选题相关的条目标题（项目文献 + 知识库文档名） */
  localTitles: string[];
}

export interface NoveltyFallbackResult {
  skipped: false;
  offline: true;
  basis: 'offline-fallback';
  overlap: number;
  specificity: number;
  advice: string;
}

/** 过泛的选题大词：只由这些词构成的选题基本无法做新颖性判断 */
const GENERIC_TERMS = [
  '研究', '分析', '综述', '应用', '方法', '技术', '系统', '模型', '算法', '进展', '探讨', '初探',
  'research', 'analysis', 'review', 'survey', 'application', 'method', 'approach', 'study', 'system', 'model',
];

/** 特异性信号：具体到方法/数据/场景/评价的限定语 */
const SPECIFIC_HINTS = [
  /数据集|dataset|benchmark|评测|评估协议/i,
  /基于|面向|under|via|using/i,
  /对比|比较|消融|ablation|comparison/i,
  /约束|限制|constraint|robust|鲁棒/i,
  /图|graph|序列|sequence|多模态|multimodal|时序|time.?series/i,
  /小样本|few.?shot|零样本|zero.?shot|长尾|long.?tail/i,
];

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** 选题与本地库标题的重叠度（0-100，以选题 token 为分母）。 */
function overlapWithLocal(topic: string, titles: string[]): number {
  const topicTokens = new Set(tokenize(topic));
  if (!topicTokens.size || !titles.length) return 0;
  let best = 0;
  for (const title of titles) {
    const titleTokens = new Set(tokenize(title));
    let hit = 0;
    for (const t of topicTokens) if (titleTokens.has(t)) hit += 1;
    best = Math.max(best, Math.round((hit / topicTokens.size) * 100));
  }
  return best;
}

/** 特异性 0-100：命中越多具体限定语、越少纯通用词，越具体。 */
function specificityOf(topic: string): number {
  const tokens = tokenize(topic);
  if (!tokens.length) return 0;
  const generic = tokens.filter((t) => GENERIC_TERMS.includes(t)).length;
  const hints = SPECIFIC_HINTS.filter((re) => re.test(topic)).length;
  const lengthScore = Math.min(tokens.length, 8) / 8;
  const raw = hints * 22 + lengthScore * 40 - generic * 8;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** 离线降级判断：给出可解释结论与「下一步该做什么」，而非沉默跳过。 */
export function noveltyFallback(input: NoveltyFallbackInput): NoveltyFallbackResult {
  const overlap = overlapWithLocal(input.topic, input.localTitles);
  const specificity = specificityOf(input.topic);
  let advice: string;
  if (overlap >= 60) {
    advice = `本地库已有高度相近条目（重叠 ${overlap}%）：先在文献页人工核对这几条，再决定选题是否需要收窄`;
  } else if (specificity < 35) {
    advice = '选题过于宽泛（缺少具体方法/数据/场景限定）：先把研究问题收敛到一个可验证的具体命题，再做联网查新';
  } else {
    advice = '本地库未发现明显重复，选题具备具体限定；学术库恢复联网后建议再复核一次（离线结论不能替代联网查新）';
  }
  return { skipped: false, offline: true, basis: 'offline-fallback', overlap, specificity, advice };
}
