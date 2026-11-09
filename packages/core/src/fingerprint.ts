import { createHash } from 'node:crypto';

/** 主归一化：小写 + 只保留 ASCII 字母数字与 CJK 统一表意文字（历史口径，已落库） */
const PRIMARY = /[^a-z0-9\u4e00-\u9fff]/g;

/**
 * 兜底归一化：保留任意 Unicode 字母/数字（谚文、假名、带变音符的拉丁字母等）。
 *
 * 为什么需要：主口径的字符类只认 ASCII 与 CJK 表意文字，遇到**不含汉字**的标题
 * （纯谚文「논문 제목」、纯假名「かなのみのタイトル」）会把所有字符都剥掉 →
 * norm 为空 → 返回 ''。调用方一律 `if (fp)` 守卫，于是这类文献的**项目内去重静默失效**：
 * 同一篇韩文/日文文献可以被反复导入而不被判重。
 *
 * 为什么只在主口径为空时才启用：`fingerprint` 已持久化在 references.fingerprint 列，
 * 直接改主口径会让所有历史行的指纹与新算法对不上（含「Étude」这类带变音符的拉丁标题），
 * 反而造成更大范围的去重漏判。当前写法保证：
 *   - 主口径非空的标题 → 输出与历史完全一致，无需数据迁移；
 *   - 主口径为空的标题 → 从「全部碰撞成 ''」变为「各自稳定唯一」，严格变好。
 */
const FALLBACK = /[^\p{L}\p{N}]/gu;

/**
 * 标题归一化指纹（全项目统一来源：knowledge + references + pipeline 共用）
 * 规则：lowercase + 去标点空白（保留字母数字与中日韩），取短 md5（项目内去重依据）
 */
export function fingerprint(title: string): string {
  const lower = (title || '').toLowerCase();
  let norm = lower.replace(PRIMARY, '');
  // 主口径剥完为空（纯谚文/纯假名等）→ 用 Unicode 字母数字兜底，避免指纹退化为 ''
  if (!norm) norm = lower.replace(FALLBACK, '');
  if (!norm) return '';
  return createHash('md5').update(norm).digest('hex').slice(0, 16);
}
