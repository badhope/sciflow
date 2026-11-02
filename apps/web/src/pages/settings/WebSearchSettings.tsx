import { useEffect, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { Badge, Button, Card, Input, Select, errMsg } from '../../components/ui';
import type { WebSearchConfig } from '../../types';

/**
 * WebSearchSettings — F-3.4 网搜设置面板
 * provider 切换（开源 SearXNG 内置支持 / 商业引擎用户自填 Key）+ chat 联网兜底开关。
 * Key 掩码回显：输入框留空=不修改（保存时只传 provider/url/开关与有值的新 Key）。
 */
export function WebSearchSettings() {
  const [cfg, setCfg] = useState<WebSearchConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [tavilyNew, setTavilyNew] = useState('');
  const [serperNew, setSerperNew] = useState('');
  const [braveNew, setBraveNew] = useState('');
  const [searxngDraft, setSearxngDraft] = useState('');
  /** 引擎连通性自检（v1.9.2）：DDG 在国内网络不可达，0 结果此前是静默的，用户无从排查 */
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.webSearchConfig.get().then((c) => {
      setCfg(c);
      setSearxngDraft(c.searxngUrl || '');
    }).catch((e) => setMsg(errMsg(e)));
  }, []);

  const testEngine = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.webSearchConfig.search('graph neural network');
      if (r.results.length > 0) {
        setTestResult({ ok: true, text: `连通正常（${r.provider || '当前引擎'}），返回 ${r.results.length} 条结果` });
      } else if (r.notice) {
        setTestResult({ ok: false, text: r.notice });
      } else {
        setTestResult({ ok: false, text: '搜索源可达但 0 结果，请更换关键词或 provider' });
      }
    } catch (e) {
      setTestResult({ ok: false, text: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  const save = async (patch: Partial<WebSearchConfig>) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await api.webSearchConfig.save(patch);
      if (res.config) setCfg(res.config);
      setMsg(res.error ? `保存失败：${res.error}` : '已保存');
      setTavilyNew('');
      setSerperNew('');
      setBraveNew('');
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!cfg) return null;

  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe size={16} aria-hidden="true" />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">联网搜索</span>
        <Badge tone={cfg.chatFallback ? 'green' : 'slate'}>{cfg.chatFallback ? 'chat 兜底已开' : 'chat 兜底关'}</Badge>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">搜索 Provider</div>
          <Select
            value={cfg.provider}
            onChange={(v: string) => save({ provider: v as WebSearchConfig['provider'] })}
            options={[
              { value: 'so360', label: '360 搜索（零配置，国内可达）' },
              { value: 'duckduckgo', label: 'DuckDuckGo（境外网络）' },
              { value: 'searxng', label: `SearXNG 自部署${cfg.available?.searxng ? ' ✓已配置' : ''}` },
              { value: 'tavily', label: `Tavily${cfg.available?.tavily ? ' ✓' : ''}` },
              { value: 'serper', label: `Serper（Google SERP）${cfg.available?.serper ? ' ✓' : ''}` },
              { value: 'brave', label: `Brave Search${cfg.available?.brave ? ' ✓' : ''}` },
            ]}
          />
        </div>
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">SearXNG 实例 URL（开源自部署）</div>
          <div className="flex gap-1.5">
            <Input value={searxngDraft} onChange={(e) => setSearxngDraft(e.target.value)} placeholder="https://searx.example.com" />
            <Button variant="outline" disabled={busy} onClick={() => save({ searxngUrl: searxngDraft })}>保存</Button>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Tavily Key {cfg.tavilyKey && <span className="text-slate-400">（当前 {cfg.tavilyKey}）</span>}</div>
          <div className="flex gap-1.5">
            <Input value={tavilyNew} onChange={(e) => setTavilyNew(e.target.value)} type="password" placeholder="留空不修改" />
            <Button variant="outline" disabled={busy || !tavilyNew} onClick={() => save({ tavilyKey: tavilyNew })}>保存</Button>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Serper Key {cfg.serperKey && <span className="text-slate-400">（当前 {cfg.serperKey}）</span>}</div>
          <div className="flex gap-1.5">
            <Input value={serperNew} onChange={(e) => setSerperNew(e.target.value)} type="password" placeholder="留空不修改" />
            <Button variant="outline" disabled={busy || !serperNew} onClick={() => save({ serperKey: serperNew })}>保存</Button>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Brave Key {cfg.braveKey && <span className="text-slate-400">（当前 {cfg.braveKey}）</span>}</div>
          <div className="flex gap-1.5">
            <Input value={braveNew} onChange={(e) => setBraveNew(e.target.value)} type="password" placeholder="留空不修改" />
            <Button variant="outline" disabled={busy || !braveNew} onClick={() => save({ braveKey: braveNew })}>保存</Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant={cfg.chatFallback ? 'danger' : 'outline'}
          disabled={busy}
          onClick={() => save({ chatFallback: !cfg.chatFallback })}
        >
          {cfg.chatFallback ? '关闭 chat 联网兜底' : '开启 chat 联网兜底'}
        </Button>
        <Button variant="outline" disabled={testing} onClick={() => void testEngine()}>
          {testing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null} 测试当前引擎
        </Button>
        <span className="text-xs text-slate-400 flex-1 min-w-[12rem]">
          开启后：知识库无命中的问题会按当前 Provider 搜公开网页作为背景资料（来源卡片标注 🌐）
        </span>
      </div>

      {testResult && (
        <div
          className={`text-xs mt-2 leading-relaxed rounded-md border px-3 py-2 ${testResult.ok ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'}`}
          role="status"
        >
          {testResult.ok ? '✓ ' : '⚠ '}{testResult.text}
        </div>
      )}

      {msg && (
        <div className={`text-xs mt-2 ${msg.startsWith('保存失败') ? 'text-rose-600' : 'text-teal-600'}`} role="status">
          {busy && <Loader2 size={11} className="inline animate-spin mr-1" aria-hidden="true" />}{msg}
        </div>
      )}
    </Card>
  );
}
