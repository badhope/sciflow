import { useEffect, useRef } from 'react';
import type { AgentNotification } from '../api/agent';

/**
 * 浏览器通知：只在用户主动授权后弹，且不重复弹已看过的站内信。
 * 用 localStorage 记住最后一条 seen id，刷新/重连也不会把历史通知当新消息。
 */
export function useBrowserNotifications(notifications: AgentNotification[] | undefined, storageKey: string) {
  const initialized = useRef(false);
  const seenId = useRef<string>('');

  useEffect(() => {
    if (!notifications?.length) return;
    const latest = notifications[0];
    if (!initialized.current) {
      initialized.current = true;
      const stored = typeof localStorage === 'undefined' ? '' : localStorage.getItem(storageKey) || '';
      seenId.current = stored || latest.id;
      if (!stored && typeof localStorage !== 'undefined') localStorage.setItem(storageKey, latest.id);
      return;
    }
    const fresh = notifications.filter((n) => !n.read && n.id !== seenId.current && n.kind !== 'system');
    seenId.current = latest.id;
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, latest.id);
    if (!fresh.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const n of fresh.slice(0, 3)) {
      try {
        const popup = new Notification(n.title || 'SciFlow 自动化', { body: n.body || '', tag: n.id });
        popup.onclick = () => {
          window.focus();
          if (n.link) window.location.assign(n.link);
        };
      } catch {
        // 某些浏览器（移动端）不支持构造 Notification，静默降级为站内信
      }
    }
  }, [notifications, storageKey]);
}

export async function requestBrowserNotifyPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}
