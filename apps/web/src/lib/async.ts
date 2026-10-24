import { useCallback, useRef, useState } from 'react';
import { errMsg } from '../components/ui';

export type AsyncState = 'idle' | 'running' | 'error';

/**
 * 异步动作三态封装（running / error / idle）
 *
 * 历史问题：各处手写 `setBusy(true) … finally setBusy(false)`，漏 catch 就变成
 * 「按钮转圈到死」或「失败完全静默」。这里强制：失败一定落 error 并保留 message，
 * 成功一定回到 idle，且同一动作并发时后一次忽略（防重复提交）。
 */
export function useAsyncAction<Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<void>,
  opts: { onError?: (message: string) => void } = {},
) {
  const [state, setState] = useState<AsyncState>('idle');
  const [error, setError] = useState('');
  const runningRef = useRef(false);

  const run = useCallback(
    async (...args: Args) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setState('running');
      setError('');
      try {
        await fn(...args);
        setState('idle');
      } catch (e: unknown) {
        const message = errMsg(e) || '操作失败，请重试';
        setError(message);
        setState('error');
        opts.onError?.(message);
      } finally {
        runningRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );

  const reset = useCallback(() => {
    setState('idle');
    setError('');
  }, []);

  return { run, state, error, reset, running: state === 'running' };
}
