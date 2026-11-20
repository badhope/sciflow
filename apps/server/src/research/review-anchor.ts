/**
 * 审稿意见的段落级锚点（纯函数）。
 *
 * 目标：把审稿意见钉到正文中的一段原文，而不是只到章节。
 * - 保存精确引文 quote，以及它在文档正文中的 start/end 偏移；
 * - 只有在能唯一、确定地定位时才写入偏移，绝不猜；
 * - 调用方可以传 preferredStart（编辑器选区起点），用于区分重复出现的同一句话。
 */

export const MAX_REVIEW_QUOTE = 4000;

export interface ReviewAnchor {
  quote: string;
  start: number;
  end: number;
}

/**
 * 解析引文锚点。
 * @param content 文档全文
 * @param rawQuote 用户/评审选中的原文
 * @param preferredStart 可选：编辑器选区起点；仅当该位置确实匹配时才采用
 * @returns 命中返回 { quote, start, end }；空引文、过长、找不到或存在多个候选且无 preferredStart 时返回 null
 */
export function resolveReviewAnchor(
  content: string,
  rawQuote: string,
  preferredStart?: number | null,
): ReviewAnchor | null {
  const quote = (rawQuote || '').trim();
  if (quote.length < 2 || quote.length > MAX_REVIEW_QUOTE) return null;
  const text = content || '';

  if (typeof preferredStart === 'number' && Number.isInteger(preferredStart)) {
    const start = preferredStart;
    if (start >= 0 && start + quote.length <= text.length && text.slice(start, start + quote.length) === quote) {
      return { quote, start, end: start + quote.length };
    }
  }

  const first = text.indexOf(quote);
  if (first < 0) return null;
  // 同一句话在正文中重复出现时，不猜第一处；要求调用方带上精确选区起点。
  if (text.indexOf(quote, first + 1) >= 0) return null;
  return { quote, start: first, end: first + quote.length };
}
