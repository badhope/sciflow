/**
 * SciFlow 品牌标志 ·「朱印 1.0」
 *
 * 4.0 相对 3.0 的重做原因（去 AI 模板化，2026-11）：
 *  3.0 的「主笔 + 主流线 + 成果节点外环」三件套，在市面上与大量 AI 产品的
 *  「一笔流 + 轨道 + 节点」图标同构，用户看到的第一眼仍是「AI 工具」。
 *  4.0 回到东方学术批注的源头——**朱砂印**：审阅、评定、定稿的印记。
 *  全标只有两个颜色（墨黛 / 朱砂）、两个形状（一笔 S + 收笔一点），
 *  没有渐变、没有光晕、没有轨道——印章的干脆就是辨识度。
 *
 * 造型语言（两层）：
 *  1. 主笔：单条连续 S 形水流（右上 → 中宫 → 左下），科研全流程一笔贯通。
 *  2. 朱点：收笔处一点朱砂，「流程走完，落下一个审阅的印记」——
 *     这是全品牌的签名细节，深浅色下都保持朱砂色（mono 场景随 currentColor）。
 *
 * 几何：48×48 视框、≥2px 安全边距；16/24/32/48/64 下等比可辨识。
 */
export function BrandMark({
  className = 'h-5 w-5',
  title = 'SciFlow',
  variant = 'mono',
}: {
  className?: string;
  title?: string;
  /** mono=跟随 currentColor（单色场景）；brand=黛蓝主笔+朱点（浅底场景）；inverse=白主笔+朱点（印底/深底场景） */
  variant?: 'mono' | 'gradient' | 'brand' | 'inverse';
}) {
  // 兼容旧调用点：'gradient' 是 3.0 时代的 API 名，4.0 起渲染为平涂品牌色（黛蓝）
  const stroke = variant === 'mono' ? 'currentColor' : variant === 'inverse' ? '#ffffff' : 'var(--brand-600, #2F5480)';
  // 朱点固定朱砂色，深浅色各一档；mono 下跟随文字色，避免脱离语境
  const dotFill =
    variant === 'mono' ? 'currentColor' : `var(--brand-seal-${variant === 'inverse' ? 'on-dark' : 'light'}, #BE3B2A)`;
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={title} fill="none">
      {/* 主笔：单条连续 S 形水流，起笔细、中宫厚、收笔出锋 */}
      <path
        d="M32.4 16.05a8.25 8.25 0 1 0-8.4 7.95 8.25 8.25 0 1 1-8.4 7.95"
        stroke={stroke}
        strokeWidth={4.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 收笔一点朱砂：全品牌的签名细节 */}
      <circle cx="14.55" cy="33" r="2.6" fill={dotFill} />
    </svg>
  );
}

/**
 * 品牌组合：标志 + 词标 + 标语。
 *
 * 4.0 排版规则：
 *  - 词标「Sci」墨色 + 「Flow」朱砂——字标即印文，与印底同源；
 *  - 标语前保留 1px 竖分隔线（期刊页眉式的分栏感），字距 0.14em。
 */
export function BrandLockup({ subtitle = '让科研从想法到成文' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-logo flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]">
        <BrandMark className="h-[25px] w-[25px]" variant="inverse" />
      </div>
      <div className="min-w-0 leading-none">
        <div className="flex items-baseline gap-[1px]">
          <span className="brand-wordmark text-[17px] font-semibold text-slate-900 dark:text-slate-50">Sci</span>
          <span className="brand-wordmark text-[17px] font-bold text-[color:var(--brand-seal-light,#BE3B2A)] dark:text-[color:var(--brand-seal-on-dark,#D4674F)]">
            Flow
          </span>
        </div>
        <div className="mt-[5px] flex items-center gap-1.5">
          <span className="h-[9px] w-px bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
          <span className="brand-tagline text-[10px] font-medium tracking-[0.14em] text-slate-500 dark:text-slate-400">{subtitle}</span>
        </div>
      </div>
    </div>
  );
}
