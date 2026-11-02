import { useContext } from 'react';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { ThemeContext } from '../../App';
import { THEME_OPTIONS, THEME_STYLES, type ThemeMode } from '../../lib/theme';
import { Card, SectionTitle } from '../../components/ui';

/**
 * 外观设置：风格包（data-theme）+ 明暗模式（.dark）两个正交维度。
 *
 * 之前主题只有一个侧栏循环按钮（浅/深/系统），用户无法选择视觉风格。
 * 这里给出 6 套风格的可视化卡片预览——点即生效，预览用真实 token 颜色绘制，
 * 不做假色块（色块与主题包变量同源，改主题包时预览自动跟随）。
 */

const MODE_ICON: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export function AppearanceSettings() {
  const { mode, style, theme, setMode, setStyle } = useContext(ThemeContext);

  return (
    <Card className="p-4 mb-4" id="settings-appearance">
      <SectionTitle>
        <span className="flex items-center gap-2">
          <Palette size={16} className="text-teal-600 dark:text-teal-400" /> 外观与主题
        </span>
      </SectionTitle>

      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">明暗模式</div>
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((opt) => {
            const Icon = MODE_ICON[opt.value];
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? 'border-teal-500 bg-teal-50 font-medium text-teal-700 dark:border-teal-500 dark:bg-teal-900/30 dark:text-teal-300'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <Icon size={13} aria-hidden="true" /> {opt.label}
              </button>
            );
          })}
          <span className="self-center text-[11px] text-slate-400 dark:text-slate-500">
            当前：{theme === 'dark' ? '深色' : '浅色'}
          </span>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">视觉风格（与明暗独立组合）</span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">共 {THEME_STYLES.length} 套 · 立即生效</span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_STYLES.map((t) => {
            const active = style === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setStyle(t.id)}
                aria-pressed={active}
                title={`${t.name}：${t.bestFor}`}
                className={`group relative overflow-hidden rounded-xl border text-left transition-all ${
                  active
                    ? 'border-teal-500 ring-2 ring-teal-500/25'
                    : 'border-slate-200 hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-slate-600'
                }`}
              >
                {/* 预览：用该风格的真实三色绘制「侧栏 + 卡片 + 强调按钮」缩略图 */}
                <div className="flex h-[68px] items-stretch gap-[3px] p-2" style={{ background: t.swatch.bg }}>
                  <div className="flex w-[22%] flex-col gap-1 rounded-md p-1" style={{ background: t.swatch.surface }}>
                    <span className="h-1 w-3/4 rounded-full" style={{ background: t.swatch.accent }} />
                    <span className="h-1 w-full rounded-full opacity-30" style={{ background: t.swatch.ink }} />
                    <span className="h-1 w-2/3 rounded-full opacity-30" style={{ background: t.swatch.ink }} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 rounded-md p-1.5" style={{ background: t.swatch.surface }}>
                    <span className="h-1.5 w-1/2 rounded-full opacity-70" style={{ background: t.swatch.ink }} />
                    <span className="h-1 w-full rounded-full opacity-20" style={{ background: t.swatch.ink }} />
                    <span className="h-1 w-5/6 rounded-full opacity-20" style={{ background: t.swatch.ink }} />
                    <span className="mt-auto h-2.5 w-8 rounded" style={{ background: t.swatch.accent }} />
                  </div>
                </div>
                <div className="border-t border-slate-100 px-2.5 py-2 dark:border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-800 dark:text-slate-100">{t.name}</span>
                    {active && <Check size={12} className="text-teal-600 dark:text-teal-400" aria-label="已选用" />}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{t.tagline}</div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">适合：{t.bestFor}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
        风格包改的是调色板与形状刻度（圆角 / 阴影 / 字体 / 密度），明暗模式单独切换，两者可任意组合。
        高对比无障碍包同时会响应系统的「增强对比度」偏好；选择会保存在本机浏览器。
      </p>
    </Card>
  );
}

export default AppearanceSettings;
