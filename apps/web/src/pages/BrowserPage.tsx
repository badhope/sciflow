import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Compass, Loader2, MousePointerClick, RefreshCw, X } from 'lucide-react';
import { api } from '../api/client';
import type { BrowserSession } from '../api/web-projects';
import { Badge, Button, Card, ErrorBox, Input, SectionTitle, Spinner, Textarea, errMsg } from '../components/ui';

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
  const [checksText, setChecksText] = useState('text | | 示例\nexists | body');
  const [verifyResult, setVerifyResult] = useState<null | { total: number; passed: number; failed: number; allPassed: boolean; results: { label: string; ok: boolean; actual: string }[] }>(null);
  const [baselineName, setBaselineName] = useState('');
  const [diffResult, setDiffResult] = useState<null | {
    ok: boolean; name: string; diffRatio: number; diffPixels: number; totalPixels: number; threshold: number;
    sizeMismatch: boolean; expected: { width: number; height: number }; actual: { width: number; height: number }; diffDataUrl?: string;
  }>(null);

  const sessionsQuery = useQuery({ queryKey: ['browser-sessions'], queryFn: () => api.browser.list() });
  const baselinesQuery = useQuery({ queryKey: ['browser-baselines'], queryFn: () => api.browser.baselines() });
  const baselines = baselinesQuery.data ?? [];
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
      // 已有会话时在当前会话内导航，而不是再开一个：
      // 每次「打开」都新建会话会在三次之后就撞上会话上限（默认 3），
      // 而用户的心智模型是「在同一个浏览器里换个网址」。
      const s = currentId ? await api.browser.navigate(currentId, url.trim()) : await api.browser.open(url.trim());
      setActiveId(s.id);
      setDiffResult(null);
      setVerifyResult(null);
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

  /**
   * 网页验收：每行一条断言，格式 `type | selector | expect | label`。
   * 用文本行而不是 JSON textarea，是因为验收清单是给人写给人读的，JSON 引号容易打错。
   * 示例：
   *   text ||| 欢迎               → 页面包含「欢迎」
   *   exists | #submit          → 存在 #submit
   *   count  | li.item | 3      → 命中 3 个
   */
  const runVerify = async () => {
    if (!currentId) return;
    const checks = checksText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [type, sel, expect, label] = line.split('|').map((x) => x.trim());
        return {
          // request 断言把「期望状态码」写进 expect，把 URL 子串写进 selector 位（复用同一行格式）
          // visual 断言把基线名写进 selector 位，expect 位写允许的差异比例
          type: type as 'exists' | 'text' | 'count' | 'visible' | 'value' | 'request' | 'no-console-error' | 'visual',
          selector: type === 'request' || type === 'visual' ? undefined : sel || undefined,
          urlIncludes: type === 'request' ? sel || undefined : undefined,
          baseline: type === 'visual' ? sel || undefined : undefined,
          maxDiffRatio: type === 'visual' && expect ? Number(expect) : undefined,
          expect: type === 'request'
            ? (expect ? Number(expect) : undefined)
            : type === 'visual'
              ? undefined
              : expect || undefined,
          label: label || undefined,
        };
      });
    if (!checks.length) {
      setError('至少写一条断言');
      return;
    }
    setBusy('verify');
    setError('');
    try {
      const r = await api.browser.verify(currentId, checks);
      setVerifyResult(r);
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

  /**
   * 视觉基线：把当前页面外观存成基线，之后每次改样式都能问「跟上次比变了多少」。
   * 名称按用户输入存成文件名，所以先在前端挡掉空值与路径字符，避免服务端来回一次 400。
   */
  const saveBaseline = async () => {
    if (!currentId) return;
    const name = baselineName.trim();
    if (!name) {
      setError('请填写基线名称，例如 home-default');
      return;
    }
    setBusy('baseline');
    setError('');
    try {
      await api.browser.saveBaseline(currentId, name);
      setDiffResult(null);
      await qc.invalidateQueries({ queryKey: ['browser-baselines'] });
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const runDiff = async () => {
    if (!currentId) return;
    const name = baselineName.trim();
    if (!name) {
      setError('请填写要比对的基线名称');
      return;
    }
    setBusy('diff');
    setError('');
    try {
      setDiffResult(await api.browser.visualDiff(currentId, name));
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  const removeBaseline = async (name: string) => {
    setBusy('delete-baseline');
    setError('');
    try {
      await api.browser.deleteBaseline(name);
      if (baselineName.trim() === name) setBaselineName('');
      if (diffResult?.name === name) setDiffResult(null);
      await qc.invalidateQueries({ queryKey: ['browser-baselines'] });
    } catch (e: unknown) {
      setError(errMsg(e));
    } finally {
      setBusy('');
    }
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

          <Card className="mb-4 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">网页验收（每行一条断言）</span>
              <Button size="xs" onClick={() => void runVerify()} loading={busy === 'verify'}>
                运行验收
              </Button>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">
              格式：类型 | 选择器 | 期望值 | 说明。类型支持 exists / visible / count / text / value / request / no-console-error / visual；
              例如 <code>text | | 登录成功</code> 表示页面文本包含「登录成功」，
              <code>request | /api/save | 200</code> 表示页面发出过该请求且返回 200，
              <code>visual | home-default</code> 表示外观与基线差异不超过 1%。
            </p>
            <Textarea rows={4} className="font-mono text-xs" value={checksText} onChange={(e) => setChecksText(e.target.value)} aria-label="验收断言" />
            {verifyResult && (
              <div className="mt-3">
                <div className="mb-1 flex items-center gap-2 text-xs">
                  <Badge tone={verifyResult.allPassed ? 'green' : 'red'}>
                    {verifyResult.allPassed ? '全部通过' : '存在失败'}
                  </Badge>
                  <span className="text-slate-400">
                    {verifyResult.passed}/{verifyResult.total} 通过
                  </span>
                </div>
                <ul className="space-y-0.5 text-[11px]">
                  {verifyResult.results.map((r, i) => (
                    <li key={i} className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                      {r.ok ? '✓' : '✗'} {r.label} — {r.actual}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card className="mb-4 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">视觉回归（与基线逐像素比对）</span>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" onClick={() => void saveBaseline()} loading={busy === 'baseline'}>
                  保存为基线
                </Button>
                <Button size="xs" onClick={() => void runDiff()} loading={busy === 'diff'}>
                  比对基线
                </Button>
              </div>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">
              基线是「已认可的页面外观」（按当前视口 1280×800 截取）。改动样式后比对，差异比例超过阈值即判失败；
              尺寸变化直接判失败（固定视口下代表布局结构变了）。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-full sm:w-64"
                placeholder="基线名称，例如 home-default"
                value={baselineName}
                onChange={(e) => setBaselineName(e.target.value)}
                aria-label="基线名称"
              />
              {baselines.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {baselines.slice(0, 6).map((b) => (
                    <span key={b.name} className="inline-flex items-center">
                      <button
                        type="button"
                        onClick={() => setBaselineName(b.name)}
                        className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300"
                        title={`保存于 ${new Date(b.savedAt).toLocaleString()} · ${Math.round(b.bytes / 1024)} KB`}
                      >
                        {b.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`删除基线 ${b.name}`}
                        onClick={() => void removeBaseline(b.name)}
                        className="ml-0.5 rounded px-1 text-[11px] text-slate-400 hover:text-rose-600"
                        title="删除该基线"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {diffResult && (
              <div className="mt-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={diffResult.ok ? 'green' : 'red'}>{diffResult.ok ? '外观一致' : '外观有差异'}</Badge>
                  <span className="text-slate-400">
                    {diffResult.sizeMismatch
                      ? `尺寸不一致：基线 ${diffResult.expected.width}×${diffResult.expected.height}，当前 ${diffResult.actual.width}×${diffResult.actual.height}`
                      : `差异 ${(diffResult.diffRatio * 100).toFixed(2)}%（${diffResult.diffPixels}/${diffResult.totalPixels} 像素，阈值 ${(diffResult.threshold * 100).toFixed(2)}%）`}
                  </span>
                </div>
                {diffResult.diffDataUrl && (
                  <img src={diffResult.diffDataUrl} alt="差异图" className="mt-2 max-h-72 w-full border border-slate-200 object-contain dark:border-slate-700" />
                )}
              </div>
            )}
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
