import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Loader2, MousePointerClick, RefreshCw, X } from 'lucide-react';
import { api } from '../api/client';
import type { BrowserSession } from '../api/web-projects';
import { Badge, Button, Card, ErrorBox, Input, SectionTitle, Spinner, errMsg } from '../components/ui';

/**
 * 内置浏览器页：真实 Chromium 会话，截图 + 取文本 + 点元素。
 *
 * 为什么不是 iframe 预览：多数站点用 X-Frame-Options/CSP 禁止被嵌入，
 * iframe 只能打开自家页面；这里由服务端 Playwright 真正导航并截图，
 * 因此任意站点都能看、能点、能把内容取出来给 Agent 用。
 */
export function BrowserPage() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('https://example.com');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState('');
  const [shot, setShot] = useState('');
  const [text, setText] = useState('');
  const [selector, setSelector] = useState('');

  const sessionsQuery = useQuery({ queryKey: ['browser-sessions'], queryFn: () => api.browser.list() });
  const sessions = sessionsQuery.data ?? [];
  const currentId = activeId || sessions[0]?.id || '';
  const current: BrowserSession | undefined = sessions.find((s) => s.id === currentId);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['browser-sessions'] });
  };

  const open = async () => {
    setBusy('open');
    setError('');
    try {
      const s = await api.browser.open(url.trim());
      setActiveId(s.id);
      await refresh();
      await capture(s.id);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const capture = async (id: string) => {
    const [img, t] = await Promise.all([api.browser.screenshot(id).catch(() => null), api.browser.text(id, 6000).catch(() => null)]);
    setShot(img?.dataUrl ?? '');
    setText(t?.text ?? '');
  };

  const act = async (kind: 'refresh' | 'click' | 'close') => {
    if (!currentId) return;
    setBusy(kind);
    setError('');
    try {
      if (kind === 'click') {
        if (!selector.trim()) {
          setError('请填写 CSS 选择器或 text=文本');
          return;
        }
        await api.browser.click(currentId, selector.trim());
      } else if (kind === 'close') {
        await api.browser.close(currentId);
        setShot('');
        setText('');
        setActiveId('');
        await refresh();
        return;
      }
      await refresh();
      await capture(currentId);
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const pick = async (id: string) => {
    setActiveId(id);
    await capture(id);
  };

  return (
    <div className="page-container">
      <ErrorBox message={error} />

      <Card tone="inset" className="mb-4 p-4">
        <SectionTitle extra={<span className="text-[11px] text-slate-400">服务端 Chromium · 仅本机可见</span>}>
          <span className="flex items-center gap-2">
            <Compass size={16} className="text-teal-600" /> 内置浏览器
          </span>
        </SectionTitle>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            placeholder="https://…（仅 http/https，内网地址默认拒绝）"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="网址"
          />
          <Button onClick={() => void open()} loading={busy === 'open'} disabled={!url.trim()}>
            打开
          </Button>
        </div>
        {sessions.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void pick(s.id)}
                className={`max-w-[240px] truncate rounded border px-2 py-1 text-[11px] ${
                  s.id === currentId ? 'border-teal-400 bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                }`}
                title={s.url}
              >
                {s.title || s.url}
              </button>
            ))}
          </div>
        )}
      </Card>

      {sessionsQuery.isLoading ? (
        <Spinner label="加载浏览器会话" />
      ) : !current ? (
        <Card className="p-6 text-center text-sm text-slate-400">还没有打开的页面。填入网址后点「打开」。</Card>
      ) : (
        <>
          <Card className="mb-4 p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Badge tone="green">已连接</Badge>
              <span className="min-w-0 truncate">{current.title || '(无标题)'}</span>
              <span className="truncate text-slate-400">{current.url}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-full sm:w-64"
                placeholder="CSS 选择器，例如 #submit；或 text=登录"
                value={selector}
                onChange={(e) => setSelector(e.target.value)}
                aria-label="选择器"
              />
              <Button variant="outline" onClick={() => void act('click')} loading={busy === 'click'}>
                <MousePointerClick size={14} /> 点击
              </Button>
              <Button variant="ghost" onClick={() => void act('refresh')} loading={busy === 'refresh'}>
                {busy === 'refresh' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 刷新截图
              </Button>
              <Button variant="ghost" onClick={() => void act('close')} loading={busy === 'close'}>
                <X size={14} /> 关闭会话
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">页面截图</div>
              {shot ? (
                <img src={shot} alt="页面截图" className="w-full" />
              ) : (
                <div className="flex h-64 items-center justify-center text-xs text-slate-400">暂无截图</div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">可见文本（供 Agent 阅读）</div>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">{text || '暂无文本'}</pre>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
