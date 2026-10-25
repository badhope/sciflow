import { useId } from 'react';

/**
 * SciFlow 品牌标志 ·「墨流 2.0 · Ink Current」唯一矢量来源
 * 与 docs/brand/logo-mark.svg、logo-mark-light.svg、icon-master.svg、docs/index.html favicon 同源。
 *
 * 造型语言（三层语义）：
 *  1. 主 S 水流（右上入水 → 左下出水）：科研内容像水流一样经过 SciFlow；
 *  2. 细轨道弧（数据闭环）：本地优先、从想法到成文的流程闭环；
 *  3. 思想节点 + 收笔墨滴：想法汇入水流，沉淀为可发表成果（书法收笔呼应「墨」）。
 *
 * 几何（64×64）：
 *  - 主 S：两段几何圆弧（上环 CCW 270° + 下环 CW 270°），线帽圆头，stroke 5.5
 *  - 轨道弧：A 23 23 0 1 0（右上→左下逆时针 270° 大弧），stroke 1.8、opacity 0.32
 *  - 思想节点：(47.4,13.2) r 3.2；墨滴：(19.4,44) r 1.7（opacity 0.75）
 * 64px 主尺寸 / 16px favicon（线宽加粗）均验证过可辨识。
 */
export function BrandMark({
  className = 'h-5 w-5',
  title = 'SciFlow',
  variant = 'mono',
}: {
  className?: string;
  title?: string;
  /** mono=跟随 currentColor（单色场景）；gradient=品牌渐变（彩色场景） */
  variant?: 'mono' | 'gradient';
}) {
  const gradId = useId();
  const stroke = variant === 'gradient' ? `url(#${gradId})` : 'currentColor';
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      {variant === 'gradient' && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#0f9e94" />
            <stop offset="0.55" stopColor="#0b8fb4" />
            <stop offset="1" stopColor="#0b6fc4" />
          </linearGradient>
        </defs>
      )}
      {/* 数据闭环轨道（细弧） */}
      <path
        d="M 46.9 15.1 A 23 23 0 1 0 15.1 46.9"
        fill="none"
        stroke={stroke}
        strokeWidth={variant === 'gradient' ? 1.8 : 2}
        strokeLinecap="round"
        opacity="0.32"
      />
      {/* 主 S 水流 */}
      <path
        d="M 43.2 21.4 A 11 11 0 1 0 32 32 A 11 11 0 1 1 20.8 42.6"
        fill="none"
        stroke={stroke}
        strokeWidth={variant === 'gradient' ? 5.5 : 6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 思想节点：想法汇入水流 */}
      <circle cx="47.4" cy="13.2" r={variant === 'gradient' ? 3.2 : 3.4} fill={stroke} />
      {/* 收笔墨滴 */}
      <circle cx="19.4" cy="44" r={variant === 'gradient' ? 1.7 : 1.8} fill={stroke} opacity="0.75" />
    </svg>
  );
}

/** 品牌组合：标志 + 词标 + 标语（侧栏/登录门/关于页共用） */
export function BrandLockup({ subtitle = '让科研从想法到成文' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="brand-logo flex h-8 w-8 items-center justify-center rounded-[9px]">
        <BrandMark className="h-[18px] w-[18px]" variant="gradient" />
      </div>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Sci<span className="brand-gradient-text">Flow</span>
        </div>
        <div className="-mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</div>
      </div>
    </div>
  );
}
