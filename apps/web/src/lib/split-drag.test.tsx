import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSplitDrag } from './split-drag';

/**
 * 键盘调宽与指针拖拽的方向必须一致。
 *
 * 缺陷：`onPointerDown` 里 `delta = (startX - evX) * (invert ? -1 : 1)` 尊重 `invert`，
 * 而 `onKeyDown` 写死「ArrowLeft → width + 24 / ArrowRight → width - 24」，完全忽略 `invert`。
 * 于是 `invert: true` 时鼠标往左拖是**变窄**、按左方向键却是**变宽**——
 * 同一个分隔条上两种输入方式方向相反。可访问性键盘操作会朝用户预期的反方向走。
 */
describe('useSplitDrag：键盘方向与 invert 语义一致', () => {
  const base = { initial: 460, min: 300, max: 640 };

  it('invert=false：ArrowLeft 加宽、ArrowRight 收窄（与「往左拖 → 变宽」一致）', () => {
    const { result } = renderHook(() => useSplitDrag({ ...base, invert: false }));
    expect(result.current.width).toBe(460);
    act(() => result.current.onKeyDown({ key: 'ArrowLeft', preventDefault() {} } as never));
    expect(result.current.width).toBe(484);
    act(() => result.current.onKeyDown({ key: 'ArrowRight', preventDefault() {} } as never));
    expect(result.current.width).toBe(460);
  });

  it('invert=true：方向翻转，ArrowLeft 收窄、ArrowRight 加宽', () => {
    const { result } = renderHook(() => useSplitDrag({ ...base, invert: true }));
    act(() => result.current.onKeyDown({ key: 'ArrowLeft', preventDefault() {} } as never));
    expect(result.current.width).toBe(436);
    act(() => result.current.onKeyDown({ key: 'ArrowRight', preventDefault() {} } as never));
    expect(result.current.width).toBe(460);
  });

  it('键盘调宽同样受 min/max 夹取', () => {
    const { result } = renderHook(() => useSplitDrag({ ...base, initial: 630, min: 300, max: 640 }));
    act(() => result.current.onKeyDown({ key: 'ArrowLeft', preventDefault() {} } as never));
    act(() => result.current.onKeyDown({ key: 'ArrowLeft', preventDefault() {} } as never));
    expect(result.current.width).toBe(640);
  });

  it('无关按键不改变宽度', () => {
    const { result } = renderHook(() => useSplitDrag(base));
    act(() => result.current.onKeyDown({ key: 'Enter', preventDefault() {} } as never));
    expect(result.current.width).toBe(460);
  });

  it('localStorage 里的越界/脏值回落 initial（不被 Number(null)=0 之类污染）', () => {
    localStorage.setItem('sciflow:test-w', '99999');
    const { result } = renderHook(() => useSplitDrag({ ...base, storageKey: 'sciflow:test-w' }));
    expect(result.current.width).toBe(460);
    localStorage.removeItem('sciflow:test-w');
  });
});
