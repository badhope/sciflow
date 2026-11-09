import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { probeServerHealth } from '../api/core';

/**
 * 连接状态提示条。
 *
 * 通用应用的标配：断网/服务不可达时给出明确状态，恢复后自动消失，不让用户对着
 * 一堆「请求失败」猜原因。两层信号：
 *  - navigator.onLine：浏览器层断网（立刻可知）；
 *  - /api/health 探活：服务层不可达（本地服务没起/崩溃，onLine 仍为 true）。
 * 仅在异常时出现在页面顶部，正常时零占位、零请求噪音（探活 20s 一次，恢复即停）。
 */
export function ConnectionBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [serverDown, setServerDown] = useState(false);
  const [checking, setChecking] = useState(false);

  // 探活改用 core.ts 的 probeServerHealth()（模块级稳定引用，直接在下面两处调用）。
  //
  // 此前这里是裸 `fetch('/api/health')`：桌面端页面从 `file://` 加载，相对路径会解析成
  // `file:///api/health`，探活**永远失败** → 「服务不可达」提示条永久挂着且无法消除，
  // 而内嵌本地服务其实完全正常。v1.15.1 起 Windows 安装包已是官网首推下载方式，
  // 桌面用户是主要受众，这个误报的影响面比浏览器端大得多。
  // 统一实现同时补上了 Authorization 头（企业 JWT 模式下探活不再 401）与超时。

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setServerDown(false);
        timer = window.setTimeout(tick, 20_000);
        return;
      }
      const ok = await probeServerHealth();
      if (cancelled) return;
      setServerDown(!ok);
      // 服务正常时降到 60s 一次（只是巡检），异常时 10s 快速确认恢复
      timer = window.setTimeout(tick, ok ? 60_000 : 10_000);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  if (!offline && !serverDown) return null;

  const title = offline ? '网络已断开' : '无法连接到本地服务';
  const hint = offline
    ? '检查网络连接；本应用的数据都在本机，恢复网络后可继续。'
    : '服务可能未启动或已退出。请确认后端进程在运行，然后点「重新检查」。';

  return (
    <div className="sticky top-0 z-50 flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
      <WifiOff size={14} className="shrink-0" />
      <span className="font-semibold shrink-0">{title}</span>
      <span className="truncate opacity-80">{hint}</span>
      <button
        type="button"
        className="ml-auto flex shrink-0 items-center gap-1 rounded border border-amber-400 px-2 py-0.5 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40 disabled:opacity-50"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          const ok = await probeServerHealth();
          setServerDown(!ok);
          setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
          setChecking(false);
        }}
      >
        <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
        重新检查
      </button>
    </div>
  );
}
