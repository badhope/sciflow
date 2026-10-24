/**
 * SciFlow 品牌标志（唯一矢量来源，与 docs/brand/logo-mark-light.svg、public/favicon.svg 同源）
 *
 * 造型语言「墨流 · Ink Current」：两段几何圆弧咬合成 S 形水流（顺流方向：右上 → 左下），
 * 末端一个思想节点 —— 科研内容像水流一样经过 SciFlow，沉淀为可发表的成果。
 * 构造：上半环（CCW 270°）+ 下半环（CW 270°），线帽圆头；节点为独立实心圆。
 * 64px 主尺寸 / 16px favicon（同 path，线宽加粗）均验证过可辨识。
 */
export function BrandMark({ className = 'h-5 w-5', title = 'SciFlow' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      {/* 双弧 S：右上入水，左下出水 */}
      <path
        d="M 43.2 21.4 A 11 11 0 1 0 32 32 A 11 11 0 1 1 20.8 42.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 思想节点：想法汇入水流 */}
      <circle cx="47.4" cy="13.2" r="3.4" fill="currentColor" />
    </svg>
  );
}

/** 品牌组合：标志 + 词标 + 标语（侧栏/登录门/关于页共用） */
export function BrandLockup({ subtitle = '让科研从想法到成文' }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="brand-logo flex h-8 w-8 items-center justify-center rounded-[9px]">
        <BrandMark className="h-[18px] w-[18px]" />
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
