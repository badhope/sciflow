import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Line,
  LineChart as ReLineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartEmpty } from './charts-primitives';

/* ─────────────────────────────────────────────────────────────────────
 * 重图表层（依赖 recharts）：Donut / HBar / LineChart。
 * 轻量基础件（MetricCard / ChartEmpty / SegBar / Sparkline / ProgressRing）
 * 已拆到 charts-primitives.tsx（零依赖），并由本文件底部 re-export，
 * 调用方的 import 路径保持不变。
 *
 * 这样只用到基础件的页面（Pipeline / Settings 等）不再把 recharts 打进主包，
 * Vite 可将其切成独立异步 chunk。
 *
 * 设计约束（2026-10 重写）：
 * 1. 颜色一律走主题变量（--brand-* / --foreground / --border），不写死 hex。
 * 2. HBar 高度是内部实现细节：调用方只给数据。
 * 3. 每个图表都提供 aria-label 与 <desc>。
 * ───────────────────────────────────────────────────────────────────── */

const SERIES = ['var(--viz-series-1)', 'var(--viz-series-2)', 'var(--viz-series-3)', 'var(--viz-series-4)', 'var(--viz-series-5)', 'var(--viz-series-6)'];

/* 坐标网格与轴线：统一走主题变量，深浅色主题自动适配 */
const GRID_STROKE = 'var(--border)';
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--popover-foreground)',
  fontSize: 12,
} as const;

/* ── Donut (PieChart) ───────────────────────────────────────────────── */
export interface DonutDataPoint {
  name?: string;
  label?: string;
  value: number;
  color?: string;
}
export interface DonutProps {
  data?: DonutDataPoint[];
  segments?: DonutDataPoint[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

function normalizeDonutData(input: DonutDataPoint[] | undefined): DonutDataPoint[] {
  // 过滤零值分段：否则 0 值分片仍占据配色槽位，唯一非零分段会取到第 N 个系列色
  // （例如只有「已定稿」时整个环变紫），语义错位且与品牌色不符。
  return (input || [])
    .filter((d) => d.value > 0)
    .map((d) => ({ name: d.name || d.label || '', value: d.value, color: d.color }));
}

/**
 * 圆环每段的填充色（纯函数，便于测试）。
 * 关键语义：配色按「过滤零值后的有效分段顺序」分配 —— 只有「已定稿=1」时整环必须是
 * 第 1 系列色，而不是按原始下标取到第 4 色（历史缺陷，实拍为紫色）。
 */
export function donutCellColors(chartData: DonutDataPoint[]): string[] {
  return chartData.map((e, i) => e.color ?? SERIES[i % SERIES.length]);
}

export function Donut({ data, segments, size = 160, thickness = 24, centerLabel, centerValue }: DonutProps) {
  const chartData = normalizeDonutData(data || segments);
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;
  const total = chartData.reduce((s, d) => s + d.value, 0);
  const summary = chartData.map((d) => `${d.name} ${d.value}`).join('；');
  return (
    <div className="donut" style={{ width: size, height: size }} role="img" aria-label={`占比图：${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={size / 2 - thickness} outerRadius={size / 2} paddingAngle={2} stroke="none" isAnimationActive={false}>
            {chartData.map((e, i) => {
              const fills = donutCellColors(chartData);
              return <Cell key={`${e.name}-${i}`} fill={fills[i]} />;
            })}
            {centerLabel && <Label value={centerLabel} position="center" fill="var(--muted-foreground)" fontSize={11} />}
            {centerValue != null && <Label value={centerValue} position="center" fill="var(--foreground)" fontSize={20} fontWeight={500} dy={12} />}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [`${v} (${total > 0 ? ((v / total) * 100).toFixed(1) : '0'}%)`, '数值']}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── HBar（横向条形图）───────────────────────────────────────────────── *
 * 高度完全内部自适应：每行固定 ROW_H，另加坐标轴与边距。
 * 调用方不再能传 height/barHeight —— 这类参数正是历史上两次事故的来源。
 */
export interface HBarDataPoint {
  name?: string;
  label?: string;
  value: number;
  color?: string;
  sub?: string;
  hint?: string;
}
export interface HBarProps {
  data?: HBarDataPoint[];
  items?: HBarDataPoint[];
  /** 单条柱厚度（px），默认 16；仅影响观感，不影响行距与标签可见性 */
  barThickness?: number;
  /** 数值上限；不传则按数据最大值自适应 */
  max?: number;
  formatValue?: (v: number) => string;
  /** 悬浮时补充说明 */
  sub?: (d: HBarDataPoint) => string;
  hint?: string;
}

const HBar_ROW_H = 30;
const HBar_AXIS_H = 26; // X 轴刻度 + 上下边距
const HBar_TOP_PAD = 6;
const HBar_LABEL_W = 96;

function normalizeHBarData(input: HBarDataPoint[] | undefined): HBarDataPoint[] {
  return (input || []).map((d) => ({ name: d.name || d.label || '', value: d.value, color: d.color, sub: d.sub, hint: d.hint }));
}

export function HBar({ data, items, barThickness = 16, max, formatValue, sub, hint }: HBarProps) {
  const chartData = normalizeHBarData(data || items);
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;

  // 高度 = 行数 × 行高 + 轴区 + 上边距。每一行都拿到完整 ROW_H，
  // 因此最后一个类别的 tick 一定落在绘图区内（此前漏了轴区导致末尾标签被裁）。
  const height = chartData.length * HBar_ROW_H + HBar_AXIS_H + HBar_TOP_PAD;
  const summary = chartData.map((d) => `${d.name} ${d.value}`).join('；');

  return (
    <div className="hbar" role="img" aria-label={`条形图：${summary}`}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: HBar_TOP_PAD, right: 18, bottom: 4, left: 4 }}
          barCategoryGap={8}
        >
          <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickFormatter={formatValue ?? ((v: number) => `${v}`)}
            axisLine={false}
            tickLine={false}
            domain={[0, max ?? 'dataMax']}
            height={HBar_AXIS_H}
          />
          {/* 类别标签超长时截断（保留完整值在 tooltip），避免窄屏把绘图区压到几乎不可见 */}
          <YAxis
            type="category"
            dataKey="name"
            tick={(props: { x?: number; y?: number; payload?: { value?: string } }) => {
              const raw = String(props.payload?.value ?? '');
              const text = raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
              return (
                <text x={props.x} y={props.y} dy={4} textAnchor="end" fill="var(--muted-foreground)" fontSize={11}>
                  {text}
                </text>
              );
            }}
            axisLine={false}
            tickLine={false}
            width={HBar_LABEL_W}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: 'var(--accent)', fillOpacity: 0.5 }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(v: number) => [formatValue ? formatValue(v) : v, '数值']}
            labelFormatter={(n: string) => {
              const pt = chartData.find((d) => d.name === n);
              return pt && sub ? sub(pt) : n;
            }}
          />
          <Bar dataKey="value" barSize={barThickness} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {chartData.map((e, i) => (
              <Cell key={`${e.name}-${i}`} fill={e.color ?? SERIES[i % SERIES.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hint && <p className="chart-hint">{hint}</p>}
    </div>
  );
}

/* ── LineChart + Area ───────────────────────────────────────────────── */
export interface LineDataPoint {
  label: string;
  [key: string]: string | number;
}
export interface LineSeries {
  dataKey: string;
  name?: string;
  color?: string;
  area?: boolean;
  strokeWidth?: number;
}
export interface LineChartProps {
  data?: LineDataPoint[];
  points?: LineDataPoint[];
  series?: LineSeries[];
  height?: number;
  grid?: boolean;
  showDots?: boolean;
  showLegend?: boolean;
  onPointClick?: (index: number) => void;
}

export function LineChart({ data, points, series, height = 240, grid = true, showDots = false, showLegend = true, onPointClick }: LineChartProps) {
  const chartData = data || points || [];
  const chartSeries: LineSeries[] =
    series ||
    (chartData.length > 0
      ? Object.keys(chartData[0])
          .filter((k) => k !== 'label')
          .map((k) => ({ dataKey: k, name: k }))
      : []);
  if (!chartData.length) return <ChartEmpty message="暂无数据" />;
  return (
    <div className="linechart" role="img" aria-label="趋势折线图">
      <ResponsiveContainer width="100%" height={height}>
        <ReLineChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 4, left: 4 }}
          onClick={(e: { activeTooltipIndex?: number }) => {
            if (onPointClick && e?.activeTooltipIndex != null) onPointClick(e.activeTooltipIndex);
          }}
        >
          {grid && <CartesianGrid stroke={GRID_STROKE} vertical={false} />}
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={12} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {showLegend && chartSeries.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }} />}
          {chartSeries.map((s, i) => {
            const color = s.color ?? SERIES[i % SERIES.length];
            return s.area ? (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name ?? s.dataKey}
                stroke={color}
                fill={color}
                fillOpacity={0.1}
                strokeWidth={s.strokeWidth ?? 2}
                dot={showDots}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name ?? s.dataKey}
                stroke={color}
                strokeWidth={s.strokeWidth ?? 2}
                dot={showDots ? { r: 3, fill: color } : false}
                isAnimationActive={false}
              />
            );
          })}
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
}


/* ── 轻量基础件 re-export（保持既有 import 路径不变）── */
export { MetricCard, ChartEmpty, SegBar, Sparkline, ProgressRing } from './charts-primitives';
export type {
  MetricCardProps,
  ChartEmptyProps,
  SegBarProps,
  SparklineProps,
  ProgressRingProps,
} from './charts-primitives';
