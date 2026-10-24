import { useCallback, useEffect, useRef, useState } from 'react';

export interface SplitPaneProps {
  /** 左侧内容 */
  left: React.ReactNode;
  /** 右侧内容 */
  right: React.ReactNode;
  /** 初始比例（0–1），默认 0.5 */
  initial?: number;
  /** 最小比例，默认 0.25 */
  min?: number;
  /** 最大比例，默认 0.75 */
  max?: number;
  /** localStorage 记忆 key（同 key 跨会话记住宽度） */
  storageKey?: string;
  className?: string;
  /** 双栏方向（窄屏建议关闭，由调用方决定是否渲染） */
  direction?: 'horizontal';
}

/**
 * 可拖拽双栏容器
 *
 * 科研写作最高频的动作是「调宽窄」：看大纲要窄、看文献要宽、校对标点要极宽。
 * 固定 50/50 会让人反复滚动。这里做成键盘可用的分隔条：
 *  - 鼠标/触屏拖拽
 *  - 聚焦后 ←/→ 调整（Shift 加速）
 *  - Home/End 到两端，双击复位 50%
 *  - 宽度记忆到 localStorage
 */
export function SplitPane({ left, right, initial = 0.5, min = 0.25, max = 0.75, storageKey, className = '' }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = useState<number>(() => {
    if (!storageKey || typeof localStorage === 'undefined') return initial;
    const raw = Number(localStorage.getItem(storageKey));
    return Number.isFinite(raw) && raw >= min && raw <= max ? raw : initial;
  });
  const [dragging, setDragging] = useState(false);
  const ratioRef = useRef(ratio);
  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const persist = useCallback(
    (v: number) => {
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, String(v));
        } catch {
          /* 隐私模式忽略 */
        }
      }
    },
    [storageKey],
  );

  const update = useCallback(
    (v: number) => {
      const next = clamp(v);
      setRatio(next);
      persist(next);
    },
    [clamp, persist],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      update((e.clientX - rect.left) / rect.width);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragging, update]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      update(ratioRef.current - step);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      update(ratioRef.current + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      update(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      update(max);
    }
  };

  return (
    <div ref={containerRef} className={`flex min-h-0 min-w-0 flex-1 ${className}`}>
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flexBasis: `${ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整分栏宽度"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(min * 100)}
        aria-valuemax={Math.round(max * 100)}
        tabIndex={0}
        className={`split-handle ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => update(initial)}
        onKeyDown={onKeyDown}
        title="拖拽调整宽度（←/→ 微调，双击复位）"
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}
