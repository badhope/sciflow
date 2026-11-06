import { describe, expect, it } from 'vitest';
import { applyTheme, DEFAULT_THEME_MODE, readStoredStyle, readStoredTheme, resolveTheme, THEME_STYLES, type ThemeStyle } from './theme';

describe('resolveTheme（R2）', () => {
  it('system 跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('显式选择优先于系统', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('默认亮色（产品要求）', () => {
  it('无存储值时默认亮色而非跟随系统', () => {
    localStorage.removeItem('sciflow-theme');
    expect(readStoredTheme()).toBe('light');
    expect(DEFAULT_THEME_MODE).toBe('light');
  });
  it('用户显式选择 dark/system 仍被尊重', () => {
    localStorage.setItem('sciflow-theme', 'dark');
    expect(readStoredTheme()).toBe('dark');
    localStorage.setItem('sciflow-theme', 'system');
    expect(readStoredTheme()).toBe('system');
    localStorage.removeItem('sciflow-theme');
  });
});

describe('主题风格包（v1.7）', () => {
  it('六套风格齐备且 id 唯一', () => {
    const ids = THEME_STYLES.map((s) => s.id);
    expect(ids).toEqual(['sciflow', 'academic', 'paper', 'minimal', 'night', 'contrast']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每套风格都有名称/标语/预览色/适用场景/偏好明暗', () => {
    for (const s of THEME_STYLES) {
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(s.tagline.trim().length).toBeGreaterThan(0);
      expect(s.bestFor.trim().length).toBeGreaterThan(0);
      expect(s.prefers === 'light' || s.prefers === 'dark').toBe(true);
      for (const c of Object.values(s.swatch)) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('applyTheme 同时写 data-theme 与 .dark（两个维度互不覆盖）', () => {
    applyTheme('dark', 'academic');
    expect(document.documentElement.dataset.theme).toBe('academic');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light', 'paper');
    expect(document.documentElement.dataset.theme).toBe('paper');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('非法/无存储时 readStoredStyle 回落默认风格', () => {
    localStorage.removeItem('sciflow-theme-style');
    expect(readStoredStyle()).toBe('sciflow');
    localStorage.setItem('sciflow-theme-style', 'not-a-theme');
    expect(readStoredStyle()).toBe('sciflow');
    localStorage.setItem('sciflow-theme-style', 'night' satisfies ThemeStyle);
    expect(readStoredStyle()).toBe('night');
    localStorage.removeItem('sciflow-theme-style');
  });
});
