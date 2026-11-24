/**
 * SciFlow 品牌标志 ·「朱印 3.0 · 回锋」
 *
 * 造型只保留两层：
 *  1. 回锋主笔：一条连续 S 形线，起笔略提、中宫转折、收笔回收——
 *     科研流程不是一次冲到底，而是走到证据处再回锋。
 *  2. 押角：右下一点纸白，像钤印时留下的印角。
 * 没有渐变、没有光晕、没有轨道节点；红色印底只在 `.brand-logo` 出现。
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
  /** mono=跟随 currentColor；brand=黛蓝主笔+朱砂押角（浅底）；inverse=纸白主笔+纸白押角（朱砂印底/深底） */
  variant?: 'mono' | 'brand' | 'inverse';
}) {
  const isMono = variant === 'mono';
  const isInverse = variant === 'inverse';
  const stroke = isMono ? 'currentColor' : isInverse ? '#F5F4F0' : 'var(--brand-600, #2F5480)';
  const dotFill = isMono ? 'currentColor' : isInverse ? '#F5F4F0' : 'var(--brand-seal-light, #BE3B2A)';
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={title} fill="none">
      {/* 主笔：单条连续 S 形水流，起笔细、中宫厚、收笔出锋 */}
      <path
        d="M32.34 15C32.34 10.78 26.25 9.84 22.03 11.48C17.34 13.36 16.41 18.28 20.16 21.09C23.91 23.91 29.06 22.03 30.7 25.31C32.34 28.83 29.06 33.28 23.91 33.52C19.69 33.75 16.41 32.34 15.47 30"
        stroke={stroke}
        strokeWidth={4.32}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 押角：全品牌的签名细节 */}
      <circle cx="34.6" cy="34.6" r="1.55" fill={dotFill} />
    </svg>
  );
}

/**
 * 品牌组合：标志 + 词标 + 标语。
 *
 * 3.0 排版规则：
 *  - 词标「Sci」墨色 + 「Flow」朱砂——字标即印文，与印底同源；
 *  - 标语前保留 1px 竖分隔线（期刊页眉式的分栏感），字距 0.14em。
 */
export function BrandLockup({ subtitle = '让科研从想法到成文' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-logo flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px]">
        <BrandMark className="h-[27px] w-[27px]" variant="inverse" />
      </div>
      <div className="min-w-0 leading-none">
        <div className="flex items-baseline gap-[1px]">
          <span className="brand-wordmark text-[18px] font-semibold tracking-[-0.015em] text-slate-900 dark:text-slate-50">Sci</span>
          <span className="brand-wordmark text-[18px] font-bold tracking-[-0.015em] text-[color:var(--brand-seal-light,#BE3B2A)] dark:text-[color:var(--brand-seal-on-dark,#D4674F)]">
            Flow
          </span>
        </div>
        <div className="mt-[6px] flex items-center gap-1.5">
          <span className="h-[9px] w-px bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
          <span className="brand-tagline text-[10px] font-medium tracking-[0.13em] text-slate-500 dark:text-slate-400">{subtitle}</span>
        </div>
      </div>
    </div>
  );
}
