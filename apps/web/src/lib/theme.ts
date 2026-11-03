export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/**
 * 主题风格（视觉语言层，与明暗正交）。
 *
 * 实现原理：Tailwind v4 的工具类编译成 `var(--color-slate-800)` 这类变量引用
 * （实测 dist：`.text-slate-800{color:var(--color-slate-800)}`），因此一套风格包
 * 只需覆盖调色板变量 + 品牌 token + 圆角/阴影刻度即可整站换肤，无需改 2600+ 处类名。
 */

export type ThemeStyle = 'sciflow' | 'academic' | 'paper' | 'minimal' | 'night' | 'contrast';

const KEY_MODE = 'sciflow-theme';
const KEY_STYLE = 'sciflow-theme-style';

export function readStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const raw = localStorage.getItem(KEY_MODE);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch { /* 隐私模式 */ }
  return 'system';
}

export function readStoredStyle(): ThemeStyle {
  if (typeof localStorage === 'undefined') return 'sciflow';
  try {
    const raw = localStorage.getItem(KEY_STYLE);
    if (THEME_STYLES.some((s) => s.id === raw)) return raw as ThemeStyle;
  } catch { /* 隐私模式 */ }
  return 'sciflow';
}

export function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode, prefersDark = systemPrefersDark()): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}

/** 浏览器地址栏/桌面标题栏配色：每套风格给明暗两色，随主题切换 */
const THEME_COLOR: Record<ThemeStyle, { light: string; dark: string }> = {
  sciflow: { light: '#f5f4f0', dark: '#101318' },
  academic: { light: '#f7f2e8', dark: '#1c1814' },
  paper: { light: '#faf6ee', dark: '#221d18' },
  minimal: { light: '#fafafa', dark: '#0d0d0d' },
  night: { light: '#f2f6fa', dark: '#0a0f16' },
  contrast: { light: '#ffffff', dark: '#000000' },
};

/** 唯一主题写入点：data-theme（风格）+ .dark（明暗）+ colorScheme + theme-color */
export function applyTheme(resolved: ResolvedTheme, style: ThemeStyle = 'sciflow'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = style;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[style][resolved];
}

export interface ThemeStyleDef {
  id: ThemeStyle;
  name: string;
  tagline: string;
  /** 卡片预览用的三色：背景 / 表面 / 强调 / 墨色 */
  swatch: { bg: string; surface: string; accent: string; ink: string };
  /** 适合什么场景（设置页显示） */
  bestFor: string;
  /** 该风格偏好的明暗（选择风格时若用户是跟随系统，风格会提示默认明暗） */
  prefers: ResolvedTheme;
}

export const THEME_STYLES: ThemeStyleDef[] = [
  {
    id: 'sciflow',
    name: '朱印纸墨',
    tagline: '默认 · 暖纸白底 · 黛蓝主色 · 朱砂点睛',
    swatch: { bg: '#f5f4f0', surface: '#ffffff', accent: '#2f5480', ink: '#262b33' },
    bestFor: '通用科研全流程',
    prefers: 'light',
  },
  {
    id: 'academic',
    name: '学术经典',
    tagline: '纸墨质感 · 衬线标题 · 零阴影',
    swatch: { bg: '#f7f2e8', surface: '#fffdf8', accent: '#7c2d2d', ink: '#2a2118' },
    bestFor: '论文写作与投稿评审',
    prefers: 'light',
  },
  {
    id: 'paper',
    name: '暖色纸感',
    tagline: '米黄纸底 · 柔和阴影 · 长时阅读',
    swatch: { bg: '#faf6ee', surface: '#fffdf7', accent: '#9a5b1f', ink: '#2b241c' },
    bestFor: '长时间阅读 / 缓解眼疲劳',
    prefers: 'light',
  },
  {
    id: 'minimal',
    name: '现代极简',
    tagline: '纯灰阶 · 单强调色 · 无阴影',
    swatch: { bg: '#fafafa', surface: '#ffffff', accent: '#2563eb', ink: '#111111' },
    bestFor: '数据看板 / 投屏演示',
    prefers: 'light',
  },
  {
    id: 'night',
    name: '暗夜实验室',
    tagline: '深蓝黑 · 霓虹青 · 等宽数字',
    swatch: { bg: '#0a0f16', surface: '#0d1520', accent: '#22d3ee', ink: '#d6e4f0' },
    bestFor: '夜间跑流水线 / 实验监控',
    prefers: 'dark',
  },
  {
    id: 'contrast',
    name: '高对比无障碍',
    tagline: '纯黑白 · 3px 焦点框 · WCAG AAA',
    swatch: { bg: '#ffffff', surface: '#ffffff', accent: '#0000ee', ink: '#000000' },
    bestFor: '低视力 / 色盲 / 合规要求',
    prefers: 'light',
  },
];

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];
