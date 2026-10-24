import { useEffect, useRef } from 'react';

/**
 * 全局快捷键注册表（唯一入口）
 *
 * 历史问题：7 处裸 addEventListener('keydown')，各自判断 metaKey，导致
 * 「提示 ⌘S 但只在写作页生效」「Esc 被多处抢」这类不一致。
 * 这里把「组合键 → 处理函数」收敛成一张表：
 *  - Mac/Ctrl 修饰键归一化为 mod
 *  - 输入框内默认不触发无修饰键动作
 *  - 后注册者优先（Modal/抽屉内覆盖全局）
 *  - handler 走 ref，避免闭包陈旧
 */

export interface HotkeySpec {
  /** 例：'mod+k'、'escape'、'mod+shift+p' */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  /** 是否在输入框/可编辑区域内也触发（默认 false；Esc 等应为 true） */
  allowInInput?: boolean;
  /** 阻止默认行为（默认 true） */
  preventDefault?: boolean;
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

/** 平台修饰键展示文案 */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

export function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map((p) => {
      if (p === 'mod') return MOD_KEY;
      if (p === 'shift') return IS_MAC ? '⇧' : 'Shift';
      if (p === 'alt') return IS_MAC ? '⌥' : 'Alt';
      if (p === 'escape') return 'Esc';
      if (p === 'enter') return 'Enter';
      return p.length === 1 ? p.toUpperCase() : p;
    })
    .join(IS_MAC ? '' : '+');
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  if (wantMod !== (e.metaKey || e.ctrlKey)) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  return e.key.toLowerCase() === key;
}

interface Entry {
  combo: string;
  handler: { current: (e: KeyboardEvent) => void | boolean };
  allowInInput: boolean;
  preventDefault: boolean;
}

const registry: Entry[] = [];
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached || typeof window === 'undefined') return;
  listenerAttached = true;
  window.addEventListener('keydown', (e) => {
    for (let i = registry.length - 1; i >= 0; i--) {
      const entry = registry[i];
      if (!matches(e, entry.combo)) continue;
      if (!entry.allowInInput && isEditable(e.target)) continue; // 跳过本条而不是整层：下层 allowInInput 的注册项（如编辑器内 ⌘S）仍可达
      if (entry.preventDefault) e.preventDefault();
      const consumed = entry.handler.current(e);
      // 返回 false = 本层不处理（如「未在生成中」），继续向外层冒泡，避免吞掉 Esc
      if (consumed === false) continue;
      return;
    }
  });
}

/** 在组件内注册快捷键；卸载自动清理。 */
export function useHotkeys(specs: HotkeySpec[]) {
  const entriesRef = useRef<Entry[] | null>(null);
  if (entriesRef.current === null) {
    // 首次渲染只初始化一次（entries 与 specs 一一对应，后续只更新 handler）
    entriesRef.current = specs.map((s) => ({
      combo: s.combo,
      handler: { current: s.handler },
      allowInInput: !!s.allowInInput,
      preventDefault: s.preventDefault !== false,
    }));
  }

  // 每次渲染把最新 handler/开关写回 ref（不触发重渲染）
  useEffect(() => {
    const entries = entriesRef.current;
    if (!entries) return;
    entries.forEach((entry, i) => {
      const spec = specs[i];
      if (!spec) return;
      entry.handler.current = spec.handler;
      entry.allowInInput = !!spec.allowInInput;
      entry.preventDefault = spec.preventDefault !== false;
    });
  });

  useEffect(() => {
    ensureListener();
    const entries = entriesRef.current;
    if (!entries) return;
    registry.push(...entries);
    return () => {
      for (const entry of entries) {
        const i = registry.indexOf(entry);
        if (i >= 0) registry.splice(i, 1);
      }
    };
  }, []);
}
