import { useCallback, useRef, useState } from 'react';

/**
 * 拖拽调宽（aside 用）：返回当前宽度与分隔条事件处理。
 * 与 SplitPane 的区别：这里调的是「右侧固定宽度侧栏」，主栏自适应吃剩余空间。
 */
export function useSplitDrag(opts: { initial: number; min: number; max: number; storageKey?: string; invert?: boolean }) {
  const { initial, min, max, storageKey, invert = false } = opts;
  const [width, setWidth] = useState<number>(() => {
    if (!storageKey || typeof localStorage === 'undefined') return initial;
    const raw = Number(localStorage.getItem(storageKey));
    return Number.isFinite(raw) && raw >= min && raw <= max ? raw : initial;
  });
  const startRef = useRef({ x: 0, w: 0 });

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);
  const commit = useCallback((v: number) => {
    const next = clamp(v);
    setWidth(next);
    if (storageKey) {
      try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
    }
  }, [clamp, storageKey]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, w: width };
    const onMove = (ev: PointerEvent) => {
      const delta = (startRef.current.x - ev.clientX) * (invert ? -1 : 1);
      commit(startRef.current.w + delta);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // 触摸拖拽被浏览器手势接管时只会来 pointercancel：不收尾会漏挂监听 + userSelect 卡死
    window.addEventListener('pointercancel', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [commit, invert, width]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); commit(width + 24); }
    if (e.key === 'ArrowRight') { e.preventDefault(); commit(width - 24); }
  }, [commit, width]);

  return { width, commit, onPointerDown, onKeyDown };
}
