import { useId } from 'react';

/**
 * SciFlow 品牌标志 ·「墨流 3.0 · Current」
 *
 * 3.0 相对 2.0 的重做原因（品牌体检结论）：
 *  2.0 的 S 是「两段同心圆弧拼 S」，在 24px 以下会退化成两个圈，且与
 *  众多 AI 产品惯用的「圆环 + 渐变」非常接近 —— 一眼就是模板产物。
 *  3.0 改为**单一连续笔势**：一条从右上落笔、经中宫转折、左下收笔的
 *  粗细渐变水流（模拟书法运笔的提按），配合一道贯穿的细「主流线」与
 *  一个实心「成果节点」。图形语义唯一、缩到 16px 仍能读出方向感。
 *
 * 造型语言（三层）：
 *  1. 主笔：粗细渐变的 S 形水流（右上 → 左下），表达「想法流经流程」。
 *  2. 主流线：一条贯穿全图的细直线，表达「可复现的流程主线」——
 *     这是 SciFlow 与「AI 随手画个环」的区分点。
 *  3. 成果节点：实心圆 + 外环，落在主笔收笔处，表达「沉淀为可发表成果」。
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
  /** mono=跟随 currentColor（单色/暗底场景）；gradient=品牌渐变（浅底彩色场景） */
  variant?: 'mono' | 'gradient' | 'inverse';
}) {
  const uid = useId().replace(/[:]/g, '');
  const strokeId = `sf-stroke-${uid}`;
  const glowId = `sf-glow-${uid}`;
  const tinted = variant === 'gradient';
  const stroke = tinted ? `url(#${strokeId})` : 'currentColor';
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={title} fill="none">
      {tinted && (
        <defs>
          {/* 笔势渐变：青绿（起）→ 湖蓝（中）→ 深蓝（收），与 --brand-grad 同源 */}
          <linearGradient id={strokeId} x1="40" y1="8" x2="8" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#12b3a3" />
            <stop offset="0.5" stopColor="#0b8fb4" />
            <stop offset="1" stopColor="#0a63ba" />
          </linearGradient>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="0.7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}
      <g filter={tinted ? `url(#${glowId})` : undefined}>
        {/* 主流线：贯穿全图的流程主线 */}
        <path
          d="M9.5 38.5 L38.5 9.5"
          stroke={stroke}
          strokeWidth={1.1}
          strokeLinecap="round"
          opacity={tinted ? 0.4 : 0.34}
        />
        {/* 主笔：单条连续 S 形水流，起笔细、中宫厚、收笔出锋 */}
        <path
          d="M37.6 12.4c-1.9-2.6-5.4-3.9-8.6-2.7-3.5 1.3-5 4.7-3.9 7.7 1.2 3.2 4.6 4.4 7.7 5.3 3.4 1 6.6 2.4 7.4 5.6.8 3.4-1.4 6.7-4.9 7.7-2.8.8-5.6.1-7.4-1.9"
          stroke={stroke}
          strokeWidth={6.0}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 成果节点：实心圆 + 外环（收笔处沉淀） */}
        <circle cx="10.4" cy="37.6" r="3.5" fill={stroke} />
        <circle cx="10.4" cy="37.6" r="6.4" stroke={stroke} strokeWidth={1.1} opacity={tinted ? 0.45 : 0.38} />
      </g>
    </svg>
  );
}

/**
 * 品牌组合：标志 + 词标 + 标语。
 *
 * 3.0 排版规则（真正品牌的做法，而非「图标 + 两行任意小字」）：
 *  - 词标用**字距收紧 + 粗细分层**：Sci 中等字重（墨），Flow 用品牌渐变；
 *  - 标语前加 1px 竖分隔线，形成期刊页眉式的分栏感；
 *  - 标语字距拉开（0.14em），与词标形成字号/字距的强对比。
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
          <span className="brand-wordmark brand-gradient-text text-[17px] font-bold">Flow</span>
        </div>
        <div className="mt-[5px] flex items-center gap-1.5">
          <span className="h-[9px] w-px bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
          <span className="brand-tagline text-[10px] font-medium tracking-[0.14em] text-slate-500 dark:text-slate-400">{subtitle}</span>
        </div>
      </div>
    </div>
  );
}
