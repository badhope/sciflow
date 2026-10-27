/**
 * 图表基础件（零依赖 SVG）。
 *
 * 为什么单独拆文件：charts.tsx 静态 import recharts（约 400KB），
 * 而 MetricCard / ProgressRing / Sparkline / SegBar / ChartEmpty 全是纯 SVG/DOM。
 * 原来只要页面用了其中任意一个（Pipeline、Settings、Dashboard），
 * 整个 recharts 就会被打进首屏 bundle。
 *
 * 现在：本文件不依赖 recharts，页面从 './charts' 导入时由 charts.tsx re-export，
 * 重图表（Donut/HBar/LineChart）保持原实现，构建工具可对 recharts 做独立分块。
 */


const SERIES = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)', 'var(--viz-series-4)', 'var(--viz-series-5)', 'var(--viz-series-6)'];

/* ── MetricCard ─────────────────────────────────────────────────────── */
export interface MetricCardProps {
  label: string;
  value: string | number;
  delta?: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: 'brand' | 'amber' | 'rose' | 'emerald' | 'sky';
  tone?: string;
}

const accentVar: Record<NonNullable<MetricCardProps['accent']>, string> = {
  brand: '--brand-500',
  amber: '--amber-500',
  rose: '--rose-500',
  emerald: '--emerald-500',
  sky: '--sky-500',
};

export function MetricCard({ label, value, delta, hint, icon, accent, tone }: MetricCardProps) {
  const resolvedAccent = (accent ?? tone ?? 'brand') as NonNullable<MetricCardProps['accent']>;
  const c = `var(${accentVar[resolvedAccent] ?? '--brand-500'})`;
  return (
    <div className="metric-card">
      <div className="metric-card__label">
        {icon && <span className="metric-card__icon" style={{ color: c }}>{icon}</span>}
        {label}
      </div>
      <div className="metric-card__value tabular-nums">{value}</div>
      {delta && <div className="metric-card__delta">{delta}</div>}
      {hint && <div className="metric-card__hint">{hint}</div>}
    </div>
  );
}

/* ── ChartEmpty ──────────────────────────────────────────────────────── */
export interface ChartEmptyProps {
  message?: string;
  title?: string;
  hint?: string;
}

export function ChartEmpty({ message, title, hint }: ChartEmptyProps) {
  const text = message || title || hint || '暂无数据';
  return (
    <div className="chart-empty" role="status">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M9 9h6M9 13h6M9 17h3" />
      </svg>
      {text}
    </div>
  );
}


/* ── SegBar（分段占比条）────────────────────────────────────────────── */
export interface SegBarDataPoint {
  label: string;
  value: number;
  color?: string;
  hint?: string;
}
export interface SegBarProps {
  data?: SegBarDataPoint[];
  segments?: SegBarDataPoint[];
  height?: number;
}

export function SegBar({ data, segments, height = 20 }: SegBarProps) {
  const chartData = data || segments || [];
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;
  const total = chartData.reduce((s, d) => s + d.value, 0);
  return (
    <div className="segbar" style={{ height, borderRadius: height / 2 }} role="img" aria-label={chartData.map((s) => `${s.label} ${s.value}`).join('；')}>
      {chartData.map((seg, i) => {
        const pct = total > 0 ? (seg.value / total) * 100 : 0;
        return (
          <div
            key={`${seg.label}-${i}`}
            className="segbar__seg"
            title={seg.hint || `${seg.label}: ${seg.value} (${pct.toFixed(1)}%)`}
            style={{ width: `${pct}%`, background: seg.color || SERIES[i % SERIES.length] }}
          />
        );
      })}
    </div>
  );
}

/* ── Sparkline（极简 SVG）───────────────────────────────────────────── */
export interface SparklineProps {
  data: number[];
  color?: string;
  stroke?: string;
  height?: number;
  width?: number | string;
  fillArea?: boolean;
}

export function Sparkline({ data, color, stroke, height = 36, width = '100%', fillArea = true }: SparklineProps) {
  const resolvedColor = color || stroke || 'var(--viz-series-1)';
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const PAD = 4;
  const drawH = height - PAD * 2;
  const path = data
    .map((v, i) => {
      const x = PAD + (i / (data.length - 1 || 1)) * 100;
      return `${i === 0 ? 'M' : 'L'}${x},${PAD + (1 - (v - min) / range) * drawH}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 108 ${height}`} preserveAspectRatio="none" className="sparkline" aria-hidden="true">
      {fillArea && <path d={`${path} L108,${height} L4,${height} Z`} fill={resolvedColor} opacity={0.12} />}
      <path d={path} fill="none" stroke={resolvedColor} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

/* ── ProgressRing（进度环）──────────────────────────────────────────── *
 * 标签颜色改为主题变量：历史上写死 rgba(255,255,255,*)，浅色主题下文字不可见。
 */
export interface ProgressRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sub?: string;
}

export function ProgressRing({ value, size = 64, strokeWidth, thickness, color = 'var(--brand-500)', trackColor, label, sub }: ProgressRingProps) {
  const resolvedStrokeWidth = strokeWidth ?? thickness ?? 5;
  const r = (size - resolvedStrokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const offset = c - (clamped / 100) * c;
  const hasSub = Boolean(sub);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="progress-ring" role="img" aria-label={`${label ?? '进度'} ${Math.round(clamped)}%${sub ? `，${sub}` : ''}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor ?? 'var(--border)'} strokeWidth={resolvedStrokeWidth} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={resolvedStrokeWidth}
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      {label && (
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" dy={hasSub ? -3 : 0} fill="var(--foreground)" fontSize={size > 60 ? 12 : 10} fontWeight={500}>
          {label}
        </text>
      )}
      {sub && (
        <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" dy={11} fill="var(--muted-foreground)" fontSize={9}>
          {sub}
        </text>
      )}
    </svg>
  );
}
