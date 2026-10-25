import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FlaskConical, Loader2, Pencil, Plug, Plus, RefreshCw, Server, Sparkles, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import type { AppSettings, DiscoveredModel, ModelProtocol, ProviderTestResult } from '../../types';
import { Badge, Button, Card, Input, Modal, Select, SectionTitle, errMsg } from '../../components/ui';
import { useSettings } from './settings-context';

/** 常见厂商只预置「地址 + 协议」，模型名一律由检测结果给出（不写死、不猜） */
const QUICK_PROVIDERS: { name: string; baseUrl: string; protocol: ModelProtocol; privateOk?: boolean }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible' },
  { name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'google-gemini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-compatible' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai-compatible' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-compatible' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai-compatible' },
  { name: '豆包·火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'openai-compatible' },
  { name: 'UniSound MaaS', baseUrl: 'https://maas-api.unisound.com/v1', protocol: 'openai-compatible' },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', protocol: 'openai-compatible', privateOk: true },
];

const PROTOCOL_OPTIONS: { value: ModelProtocol; label: string }[] = [
  { value: 'openai-compatible', label: 'OpenAI 兼容（Chat Completions）' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-gemini', label: 'Google Gemini' },
];

const PROTOCOL_LABEL: Record<ModelProtocol, string> = {
  'openai-compatible': 'OpenAI 兼容',
  'anthropic-messages': 'Anthropic',
  'google-gemini': 'Gemini',
};

export interface ProviderForm {
  id?: string;
  name: string;
  protocol: ModelProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: string;
  maxOutput: string;
  toolCalling: boolean;
  models: DiscoveredModel[];
  privateOk: boolean;
}

export const EMPTY_FORM: ProviderForm = {
  name: '',
  protocol: 'openai-compatible',
  baseUrl: '',
  apiKey: '',
  model: '',
  contextWindow: '',
  maxOutput: '',
  toolCalling: true,
  models: [],
  privateOk: false,
};

export function fmtTokens(n?: number): string {
  if (!n || n <= 0) return '未知';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** 自动检测触发条件：地址合法；新建需填 Key，编辑态可复用库内已存 Key */
export function canAutoDetect(f: { baseUrl: string; apiKey: string; id?: string; privateOk?: boolean }): boolean {
  if (!/^https?:\/\//i.test(f.baseUrl.trim())) return false;
  return Boolean(f.apiKey.trim()) || Boolean(f.id) || f.privateOk === true;
}

/** 本地端点（Ollama 等）判定：行级测试与表单保持一致，需要显式 privateOk 才放行内网地址 */
export function isLocalEndpoint(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());
}

/** 从检测结果里挑默认模型：优先轻量档（flash/lite/mini/haiku），否则第一个 */
export function pickDefaultModel(models: DiscoveredModel[]): DiscoveredModel | undefined {
  return models.find((m) => /flash|lite|mini|haiku|small/i.test(m.id)) || models[0];
}

export function ProviderManager({ settings }: { settings: AppSettings | null }) {
  const { state, saveProvider, activateProvider, removeProvider } = useSettings();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [discoverInfo, setDiscoverInfo] = useState('');
  const [autoFilled, setAutoFilled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowTest, setRowTest] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const discoverSig = useRef('');
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const patch = (p: Partial<ProviderForm>) => setForm((f) => ({ ...f, ...p }));
  // Modal 的焦点归还要点：onClose 必须稳定，否则每次输入触发 effect 重跑把焦点抢回首個输入框（实测只能输入 1 个字符）
  const closeForm = useCallback(() => setShowForm(false), []);

  const applyDetectedModel = useCallback((m: DiscoveredModel) => {
    setForm((cur) => ({
      ...cur,
      model: m.id,
      contextWindow: m.contextWindow ? String(m.contextWindow) : cur.contextWindow,
      maxOutput: m.maxOutput ? String(m.maxOutput) : cur.maxOutput,
      toolCalling: m.toolCalling === undefined ? cur.toolCalling : m.toolCalling,
    }));
    setAutoFilled(true);
    setTestResult(null);
  }, []);

  /** 检测模型：手动点击与「地址+Key 输入稳定」自动触发共用同一实现 */
  const runDiscover = useCallback(async (manual: boolean, snapshot?: ProviderForm) => {
    const f = snapshot ?? formRef.current;
    if (!/^https?:\/\//i.test(f.baseUrl.trim())) {
      if (manual) setDiscoverError('请先填写合法的 Base URL（http/https）');
      return;
    }
    if (!f.apiKey.trim() && !f.id) {
      if (manual) setDiscoverError('请先填写 API Key');
      return;
    }
    const sig = `${f.id || ''}|${f.protocol}|${f.baseUrl.trim()}|${f.apiKey.trim()}|${f.privateOk}`;
    if (!manual && discoverSig.current === sig) return;
    discoverSig.current = sig;
    setDiscovering(true);
    setDiscoverError('');
    setDiscoverInfo('');
    try {
      const r = await api.settings.discoverModels({
        id: f.id,
        baseUrl: f.baseUrl.trim(),
        apiKey: f.apiKey.trim(),
        protocol: f.protocol,
        privateOk: f.privateOk,
      });
      if (!r.ok) {
        setDiscoverError(r.error || '检测失败');
        return;
      }
      setForm((cur) => ({ ...cur, models: r.models }));
      if (r.models.length === 0) {
        setDiscoverInfo('端点可达，但没有返回可用的聊天模型（可手动填写模型名）');
        return;
      }
      setDiscoverInfo(`已检测到 ${r.models.length} 个可用模型，点击下方列表选择`);
      const keep = r.models.find((m) => m.id === f.model);
      if (!keep) {
        const first = pickDefaultModel(r.models);
        if (first) applyDetectedModel(first);
      }
    } catch (e: unknown) {
      setDiscoverError(errMsg(e));
    } finally {
      setDiscovering(false);
    }
  }, [applyDetectedModel]);

  /** 地址/Key/协议输入稳定 800ms 后自动检测（换协议或换端点重新拉取） */
  useEffect(() => {
    if (!showForm || !canAutoDetect(form)) return;
    const t = setTimeout(() => void runDiscover(false, form), 800);
    return () => clearTimeout(t);
  }, [showForm, form, runDiscover]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setTestResult(null);
    setDiscoverError('');
    setDiscoverInfo('');
    setAutoFilled(false);
    discoverSig.current = '';
    setShowForm(true);
  };

  const openEdit = (p: {
    id: string; name: string; baseUrl: string; apiKey: string; model: string;
    protocol: ModelProtocol; contextWindow: number; maxOutput: number; toolCalling: number; models: DiscoveredModel[];
  }) => {
    setForm({
      id: p.id,
      name: p.name,
      protocol: p.protocol || 'openai-compatible',
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      contextWindow: p.contextWindow ? String(p.contextWindow) : '',
      maxOutput: p.maxOutput ? String(p.maxOutput) : '',
      toolCalling: p.toolCalling !== 0,
      models: p.models || [],
      privateOk: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(p.baseUrl),
    });
    setTestResult(null);
    setDiscoverError('');
    setDiscoverInfo('');
    setAutoFilled(false);
    discoverSig.current = '';
    setShowForm(true);
  };

  const runTest = async () => {
    if (!form.baseUrl.trim() || !form.model.trim()) {
      setTestResult({ ok: false, reply: '请先填写 Base URL 并选择模型', model: form.model, latencyMs: 0 });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.settings.testProvider({
        id: form.id,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        protocol: form.protocol,
        model: form.model.trim(),
        maxOutput: Number(form.maxOutput) || undefined,
        privateOk: form.privateOk,
      });
      setTestResult(r);
    } catch (e: unknown) {
      setTestResult({ ok: false, reply: errMsg(e), model: form.model, latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      await saveProvider({
        id: form.id,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        model: form.model.trim(),
        protocol: form.protocol,
        contextWindow: Number(form.contextWindow) || 0,
        maxOutput: Number(form.maxOutput) || 0,
        toolCalling: form.toolCalling ? 1 : 0,
        models: form.models,
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (e: unknown) {
      setDiscoverError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const testRow = async (p: {
    id: string; baseUrl: string; apiKey: string; protocol: ModelProtocol; model: string; maxOutput: number;
  }) => {
    setRowTest({ id: p.id, ok: true, text: '测试中…' });
    try {
      const r = await api.settings.testProvider({ id: p.id, baseUrl: p.baseUrl, apiKey: p.apiKey, protocol: p.protocol, model: p.model, maxOutput: p.maxOutput || undefined, privateOk: isLocalEndpoint(p.baseUrl) });
      setRowTest({ id: p.id, ok: r.ok, text: r.ok ? `连接成功 · ${r.latencyMs}ms · ${r.reply}` : `失败：${r.reply}` });
    } catch (e: unknown) {
      setRowTest({ id: p.id, ok: false, text: `失败：${errMsg(e)}` });
    }
  };

  const canSubmit = Boolean(form.name.trim() && form.baseUrl.trim() && form.model.trim() && !saving);

  return (
    <>
      {settings && (
        <Card className="p-5 mb-4">
          <SectionTitle>
            <span className="flex items-center gap-2">
              <Server size={16} className="text-teal-600" /> 模型路由（fast / strong 双档）
            </span>
          </SectionTitle>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">Fast 档（轻量快速）</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200">{settings.ai.fastModel || '未配置'}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">科研问答 · 综述 · 润色 · 翻译 · 提取 · 证据综合</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">Strong 档（高难任务）</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200">{settings.ai.strongModel || '未配置'}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">研究规划 · 大纲 · 长文起草 · 质量评审</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <Badge tone="teal">{PROTOCOL_LABEL[settings.ai.protocol] || settings.ai.protocol}</Badge>
            <span>上下文 {fmtTokens(settings.ai.contextWindow)}</span>
            <span>·</span>
            <span>单次输出上限 {fmtTokens(settings.ai.maxOutput)}</span>
            <span>·</span>
            <span>工具调用 {settings.ai.toolCalling ? '支持' : '已关闭'}</span>
          </div>
        </Card>
      )}

      <Card className="p-5 mb-4">
        <SectionTitle
          extra={
            <Button variant="outline" onClick={openCreate}>
              <Plus size={14} /> 添加厂商
            </Button>
          }
        >
          <span className="flex items-center gap-2">
            <Plug size={16} className="text-teal-600" /> 模型厂商管理（可插拔多模型）
          </span>
        </SectionTitle>
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          支持 OpenAI 兼容 / Anthropic / Gemini 三协议：填地址和 Key 后自动检测可用模型、匹配上下文与工具调用能力，激活后立即切换所有 AI 调用
        </div>
        {state.providers.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">暂无自定义厂商，当前使用 apps/server/.env 的配置</div>
        ) : (
          <div className="space-y-1.5">
            {state.providers.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${p.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="font-medium text-slate-700 dark:text-slate-200 w-20 sm:w-28 truncate">{p.name}</span>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-0 truncate w-full sm:w-auto">{p.model} · {p.baseUrl}</span>
                  <Badge tone="slate">{PROTOCOL_LABEL[p.protocol] || p.protocol}</Badge>
                  {p.isActive ? (
                    <Badge tone="green">激活中</Badge>
                  ) : (
                    <Button variant="outline" className="text-xs px-2 py-1" onClick={() => activateProvider(p.id)}>
                      激活
                    </Button>
                  )}
                  <Button variant="ghost" className="text-xs px-2 py-1" onClick={() => void testRow(p)}>
                    <FlaskConical size={12} /> 测试
                  </Button>
                  <Button variant="ghost" className="text-xs px-2 py-1" onClick={() => openEdit(p)}>
                    <Pencil size={12} /> 编辑
                  </Button>
                  <Button variant="ghost" className="text-xs px-2 py-1 text-rose-500" onClick={() => removeProvider(p.id)}>
                    删除
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
                  <span>上下文 {fmtTokens(p.contextWindow)}</span>
                  <span>输出上限 {fmtTokens(p.maxOutput)}</span>
                  <span>工具调用 {p.toolCalling !== 0 ? '支持' : '关闭'}</span>
                  <span>已检测模型 {p.models?.length ?? 0} 个</span>
                </div>
                {rowTest?.id === p.id && (
                  <div className={`mt-1 text-[11px] ${rowTest.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>{rowTest.text}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={showForm} title={form.id ? '编辑模型厂商' : '添加模型厂商'} onClose={closeForm} width="max-w-3xl">
        <div className="mb-3">
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-2">常见厂商一键填入（只填地址与协议，模型自动检测）</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROVIDERS.map((q) => (
              <button
                key={q.name}
                type="button"
                className="text-xs rounded-full border border-teal-200 dark:border-teal-800/60 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 px-2.5 py-1 hover:bg-teal-100 dark:hover:bg-teal-900/40"
                onClick={() => {
                  discoverSig.current = '';
                  patch({ name: q.name, baseUrl: q.baseUrl, protocol: q.protocol, model: '', models: [], privateOk: q.privateOk === true });
                  setDiscoverError('');
                  setDiscoverInfo('');
                  setTestResult(null);
                }}
              >
                {q.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">厂商名称</div>
            <Input placeholder="如 UniSound MaaS" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">协议（主流三选一）</div>
            <Select
              className="w-full"
              value={form.protocol}
              onChange={(v) => {
                discoverSig.current = '';
                patch({ protocol: v as ModelProtocol, model: '', models: [] });
              }}
              options={PROTOCOL_OPTIONS}
            />
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Base URL</div>
            <Input placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(e) => { discoverSig.current = ''; patch({ baseUrl: e.target.value }); }} />
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
              API Key {form.id && <span className="text-slate-400">（留空或保留掩码 = 不修改已存 Key）</span>}
            </div>
            <Input placeholder="sk-..." type="password" value={form.apiKey} onChange={(e) => { discoverSig.current = ''; patch({ apiKey: e.target.value }); }} />
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={form.privateOk}
              onChange={(e) => { discoverSig.current = ''; patch({ privateOk: e.target.checked }); }}
              className="rounded border-slate-300"
            />
            本地 / 内网端点（Ollama、内网网关；云元数据地址仍会拒绝）
          </label>
        </div>

        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Sparkles size={14} className="text-teal-600" /> 模型（填写地址与 Key 后自动检测）
            </span>
            <Button variant="outline" size="sm" disabled={discovering || !canAutoDetect(form)} onClick={() => void runDiscover(true)}>
              {discovering ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 检测模型
            </Button>
          </div>
          {discovering && <div className="flex items-center gap-2 text-xs text-slate-400 py-2"><Loader2 size={13} className="animate-spin" /> 正在请求模型列表…</div>}
          {!discovering && discoverError && <div className="text-xs text-rose-500 py-1">{discoverError}</div>}
          {!discovering && !discoverError && discoverInfo && <div className="text-xs text-slate-500 dark:text-slate-400 py-1">{discoverInfo}</div>}
          {form.models.length > 0 && (
            <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {form.models.map((m) => {
                const selected = form.model === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => applyDetectedModel(m)}
                    className={`w-full text-left px-3 py-2 text-xs flex flex-wrap items-center gap-2 transition-colors ${selected ? 'bg-teal-50 dark:bg-teal-900/25' : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'}`}
                  >
                    {selected ? <CheckCircle2 size={13} className="text-teal-600 shrink-0" /> : <span className="w-[13px] shrink-0" />}
                    <span className="font-mono text-slate-700 dark:text-slate-200">{m.id}</span>
                    {m.displayName && m.displayName !== m.id && <span className="text-slate-400">{m.displayName}</span>}
                    <span className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
                      {m.contextWindow ? <Badge tone="slate">上下文 {fmtTokens(m.contextWindow)}</Badge> : null}
                      {m.maxOutput ? <Badge tone="slate">输出 {fmtTokens(m.maxOutput)}</Badge> : null}
                      <Badge tone={m.toolCalling === false ? 'amber' : 'green'}>{m.toolCalling === false ? '无工具' : '工具调用'}</Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">当前模型（可直接手动填写）</div>
            <Input placeholder="从上方列表选择，或手动输入模型名" value={form.model} onChange={(e) => { setAutoFilled(false); patch({ model: e.target.value }); setTestResult(null); }} />
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-500 dark:text-slate-400">能力（自动匹配，可手动覆盖）</span>
              {autoFilled && <Badge tone="teal">自动匹配</Badge>}
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">上下文窗口（token）</div>
                <Input placeholder="0 = 未知" inputMode="numeric" value={form.contextWindow} onChange={(e) => { setAutoFilled(false); patch({ contextWindow: e.target.value.replace(/\D/g, '') }); }} />
              </div>
              <div>
                <div className="text-[11px] text-slate-400 mb-1">单次最大输出（token）</div>
                <Input placeholder="0 = 未知" inputMode="numeric" value={form.maxOutput} onChange={(e) => { setAutoFilled(false); patch({ maxOutput: e.target.value.replace(/\D/g, '') }); }} />
              </div>
              <label className="flex items-end gap-2 pb-2 text-xs text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={form.toolCalling} onChange={(e) => { setAutoFilled(false); patch({ toolCalling: e.target.checked }); }} className="rounded border-slate-300" />
                支持工具调用
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="success" onClick={() => void runTest()} disabled={testing || !form.baseUrl.trim() || !form.model.trim()}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} 测试连接
          </Button>
          {testResult && (
            <span role="status" className={`flex items-center gap-1.5 text-xs ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
              {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              {testResult.ok ? `${testResult.model} · ${testResult.latencyMs}ms · ${testResult.reply}` : testResult.reply}
            </span>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setShowForm(false)}>取消</Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} {form.id ? '保存修改' : '添加厂商'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
