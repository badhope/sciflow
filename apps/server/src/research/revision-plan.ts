/**
 * 评审意见 → 结构化修改计划（纯函数，确定性，无 AI 调用）。
 *
 * 评审闭环的第一环：把自由文本的审稿意见解析成逐条 RevisionItem
 * （类别 / 严重度 / 建议动作），供回复信生成、流水线修改任务与
 * reflexion_log 回链共用。解析只做结构切分与关键词归类，不改写内容。
 */

export type RevisionCategory = 'experiment' | 'method' | 'citation' | 'writing' | 'structure';

export interface RevisionItem {
  id: string;
  excerpt: string;
  category: RevisionCategory;
  severity: 'major' | 'minor';
  suggestedAction: string;
}

const ITEM_SPLIT_RE = /(?:^|\n)\s*(?=(?:\d+[).、])|(?:-\s)|(?:\*\s)|(?:Major\s*[:.\d]*)|(?:Minor\s*[:.\d]*))/i;

const CATEGORY_RULES: { category: RevisionCategory; re: RegExp }[] = [
  { category: 'experiment', re: /实验|数据集|baseline|对比|结果|dataset|experiment|evaluation|指标/i },
  { category: 'method', re: /方法|模型|算法|公式|理论|method|model|algorithm|approach|收敛/i },
  { category: 'citation', re: /引用|文献|著录|参考文献|citation|reference|bibliography/i },
  { category: 'writing', re: /语言|表达|错别字|措辞|润色|口语|grammar|typo|writing|wording/i },
  { category: 'structure', re: /结构|章节|组织|逻辑|贡献|outline|section|organization|structure|贡献点/i },
];

const ACTIONS: Record<RevisionCategory, string> = {
  experiment: '补充或重做实验：明确数据集、基线与评测指标，把结果写入相应章节并用引用标注来源',
  method: '澄清方法：补全算法描述、公式与假设条件，确保可复现',
  citation: '核对引用：按所选著录规范修正参考文献格式，补齐缺失引用并清理无锚点引用',
  writing: '语言润色：消除口语化表达与错别字，统一术语',
  structure: '调整结构：按 IMRaD 重组章节，突出贡献点与局限性',
};

function classify(text: string): RevisionCategory {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) return rule.category;
  }
  return 'structure';
}

function severityOf(text: string, inMajorBlock: boolean): 'major' | 'minor' {
  if (/\bminor\b|小修/i.test(text)) return 'minor';
  if (/\bmajor\b|大修/i.test(text)) return 'major';
  return inMajorBlock ? 'major' : 'minor';
}

function splitItems(comments: string): string[] {
  const trimmed = comments.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(ITEM_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  // 无编号标记的整段文本按空行分组；单段则整段作为一条
  if (parts.length <= 1) {
    return trimmed.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  }
  return parts;
}

/** 把审稿意见解析为逐条修改计划；空输入返回空数组。 */
export function buildRevisionPlan(reviewComments: string): RevisionItem[] {
  const chunks = splitItems(reviewComments);
  let inMajorBlock = /\bmajor\b|大修/i.test(reviewComments);
  const items: RevisionItem[] = [];
  for (const chunk of chunks) {
    const category = classify(chunk);
    items.push({
      id: `R${items.length + 1}`,
      excerpt: chunk.replace(/\s+/g, ' ').slice(0, 300),
      category,
      severity: severityOf(chunk, inMajorBlock),
      suggestedAction: ACTIONS[category],
    });
    if (/\bminor\b|小修/i.test(chunk)) inMajorBlock = false;
  }
  return items;
}
