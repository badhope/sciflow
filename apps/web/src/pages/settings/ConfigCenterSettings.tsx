import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, ChevronDown, ChevronUp, FlaskConical, History, Loader2, Lock, Plus, RefreshCw,
  Save, ShieldCheck, Sparkles, Trash2, Workflow, Wrench,
} from 'lucide-react';
import { api } from '../../api/client';
import type {
  ConfigConstraint, ConfigHook, ConfigRole, ConfigSnapshot, PermissionMode,
} from '../../types';
import { Badge, Button, Card, Input, SectionTitle, Select, Textarea, errMsg } from '../../components/ui';

/**
 * 配置中心面板（角色 / 约束工程 / 钩子 / 权限 / 预设 / 审计）。
 *
 * 与 CLI（sciflow config ...）和对话工具（config.*）共用同一套 REST 服务：
 * 这里保存后，对话下一次请求即生效；CLI 写入后这里刷新即可见。
 */
export function ConfigCenterSettings() {
  const [snap, setSnap] = useState<ConfigSnapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ permission: true, roles: true, constraints: true, hooks: false, audit: false });
  const [preview, setPreview] = useState<{ scope: 'chat' | 'pipeline'; text: string } | null>(null);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setBusy('load');
    setErr('');
    try {
      setSnap(await api.config.snapshot());
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally {
      setBusy('');
    }
  }, []);

  // 首屏加载：异步回调里 setState（不在 effect 体内同步 setState，满足 react-hooks/set-state-in-effect）
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    void api.config.snapshot().then(setSnap).catch((e: unknown) => setErr(errMsg(e)));
  }, []);

  const run = async (label: string, fn: () => Promise<unknown>, okText: string) => {
    setBusy(label);
    setErr('');
    setMsg('');
    try {
      await fn();
      setMsg(okText);
      await load();
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally {
      setBusy('');
    }
  };

  if (!snap) {
    return (
      <Card className="p-5 mb-4" id="settings-config">
        <SectionTitle><span className="flex items-center gap-2"><ShieldCheck size={16} className="text-teal-600" /> 配置中心</span></SectionTitle>
        {err ? <div className="text-xs text-rose-500">{err}</div> : <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载配置中心…</div>}
      </Card>
    );
  }

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <Card className="p-5 mb-4" id="settings-config">
      <SectionTitle extra={<Button variant="outline" onClick={() => void load()} disabled={busy === 'load'}><RefreshCw size={13} /> 刷新</Button>}>
        <span className="flex items-center gap-2"><ShieldCheck size={16} className="text-teal-600" /> 配置中心（角色 / 约束 / 钩子 / 权限）</span>
      </SectionTitle>
      <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
        与 CLI（<span className="font-mono">sciflow config</span>）和对话工具（<span className="font-mono">config.*</span>）共用同一数据源：任一入口修改，其余入口刷新后即见；约束与钩子在每次 AI 调用时真实注入/执行。
      </div>
      {err && <div role="alert" className="mb-2 text-xs text-rose-500">{err}</div>}
      {msg && <div className="mb-2 text-xs text-emerald-600 dark:text-emerald-400">{msg}</div>}

      {/* 权限档 */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 mb-3">
        <button type="button" className="w-full flex items-center justify-between px-3 py-2.5 text-left" onClick={() => toggle('permission')}>
          <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"><Lock size={14} className="text-teal-600" /> 权限档</span>
          <span className="flex items-center gap-2">
            <Badge tone={snap.permission.mode === 'unrestricted' ? 'green' : snap.permission.mode === 'strict' ? 'red' : 'amber'}>
              {snap.permission.modes.find((m) => m.value === snap.permission.mode)?.label || snap.permission.mode}
            </Badge>
            {open.permission ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
          </span>
        </button>
        {open.permission && (
          <div className="px-3 pb-3 space-y-2">
            <Select
              className="w-full"
              value={snap.permission.mode}
              onChange={(v) => void run('permission', () => api.config.setPermission(v as PermissionMode), `权限档已切换为「${snap.permission.modes.find((m) => m.value === v)?.label}」`)}
              options={snap.permission.modes.map((m) => ({ value: m.value, label: `${m.label} — ${m.description}` }))}
            />
            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded px-2.5 py-2">
              <div className="font-medium mb-1">核心保护项（任何档位都不可改）</div>
              <ul className="space-y-0.5">
                {snap.permission.coreProtected.map((c) => (
                  <li key={c.key}>· <span className="text-slate-600 dark:text-slate-300">{c.label}</span>：{c.reason}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* 预设 */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 mb-3 p-3">
        <div className="flex items-center gap-2 mb-2 text-sm font-medium text-slate-700 dark:text-slate-200"><Sparkles size={14} className="text-teal-600" /> 一键预设</div>
        <div className="flex flex-wrap gap-1.5">
          {snap.presets.map((p) => (
            <Button key={p.id} variant="outline" size="sm" disabled={busy === `preset-${p.id}`} title={p.description}
              onClick={() => void run(`preset-${p.id}`, () => api.config.applyPreset(p.id), `已应用预设「${p.name}」（角色/约束/钩子）`)}>
              {busy === `preset-${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {p.name}
            </Button>
          ))}
        </div>
        <div className="mt-2 text-[11px] text-slate-400">预设只替换 <span className="font-mono">source=preset</span> 的约束与预设钩子，自建项保留。</div>
      </div>

      {/* 角色 */}
      <ConfigSection icon={<Wrench size={14} />} title="角色（系统提示词）" count={snap.roles.length} open={!!open.roles} onToggle={() => toggle('roles')}>
        <RoleEditor roles={snap.roles} busy={busy} run={run} />
      </ConfigSection>

      {/* 约束 */}
      <ConfigSection icon={<ShieldCheck size={14} />} title="约束工程（每次 AI 调用注入）" count={snap.constraints.length} open={!!open.constraints} onToggle={() => toggle('constraints')}>
        <ConstraintEditor constraints={snap.constraints} busy={busy} run={run} />
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void run('preview-chat', async () => setPreview(await api.config.preview('chat')), '已生成 chat 生效预览')}>
            <FlaskConical size={12} /> 预览 chat 注入
          </Button>
          <Button variant="outline" size="sm" onClick={() => void run('preview-pipeline', async () => setPreview(await api.config.preview('pipeline')), '已生成 pipeline 生效预览')}>
            <FlaskConical size={12} /> 预览 pipeline 注入
          </Button>
        </div>
        {preview && (
          <pre className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 p-3 text-[11px] text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
            {preview.text || '（当前无约束与 prompt_inject 钩子，不会注入任何内容）'}
          </pre>
        )}
      </ConfigSection>

      {/* 钩子 */}
      <ConfigSection icon={<Workflow size={14} />} title="钩子（生命周期真实执行）" count={snap.hooks.length} open={!!open.hooks} onToggle={() => toggle('hooks')}>
        <HookEditor hooks={snap.hooks} busy={busy} run={run} />
      </ConfigSection>

      {/* 审计 */}
      <ConfigSection icon={<History size={14} />} title="配置审计（只追加）" count={snap.audit.length} open={!!open.audit} onToggle={() => toggle('audit')}>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-[11px]">
          {snap.audit.length === 0 && <div className="px-3 py-2 text-slate-400">暂无记录</div>}
          {snap.audit.map((a) => (
            <div key={a.id} className="px-3 py-1.5 flex flex-wrap items-center gap-2">
              <span className="text-slate-400">{new Date(a.createdAt).toLocaleString('zh-CN')}</span>
              <Badge tone={a.allowed ? 'slate' : 'red'}>{a.allowed ? '允许' : '拒绝'}</Badge>
              <span className="font-mono text-slate-500">{a.actor}</span>
              <span className="text-slate-600 dark:text-slate-300">{a.category}/{a.action}</span>
              {a.reason && <span className="text-rose-500">{a.reason}</span>}
            </div>
          ))}
        </div>
      </ConfigSection>
    </Card>
  );
}

function ConfigSection({ icon, title, count, open, onToggle, children }: {
  icon: React.ReactNode; title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 mb-3">
      <button type="button" className="w-full flex items-center justify-between px-3 py-2.5 text-left" onClick={onToggle}>
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span className="text-teal-600">{icon}</span> {title}
          <Badge tone="slate">{count}</Badge>
        </span>
        {open ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function RoleEditor({ roles, busy, run }: {
  roles: ConfigRole[]; busy: string;
  run: (label: string, fn: () => Promise<unknown>, okText: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  return (
    <div className="space-y-2">
      {roles.map((r) => (
        <div key={r.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{r.name}</span>
            {r.isDefault === 1 ? <Badge tone="green">默认（对话使用）</Badge> : null}
            {r.enabled === 0 ? <Badge tone="amber">已停用</Badge> : null}
            <span className="ml-auto flex items-center gap-1.5">
              {r.isDefault !== 1 && (
                <Button variant="outline" size="sm" disabled={busy === `role-default-${r.id}`} onClick={() => void run(`role-default-${r.id}`, () => api.config.updateRole(r.id, { isDefault: true }), `已把「${r.name}」设为默认角色`)}>
                  <CheckCircle2 size={12} /> 设为默认
                </Button>
              )}
              {r.isDefault !== 1 && (
                <Button variant="ghost" size="sm" disabled={busy === `role-del-${r.id}`} className="text-rose-500" onClick={() => void run(`role-del-${r.id}`, () => api.config.deleteRole(r.id), '角色已删除')}>
                  <Trash2 size={12} /> 删除
                </Button>
              )}
            </span>
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-[11px] text-slate-400">查看系统提示词（{r.systemPrompt.length} 字）</summary>
            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 rounded p-2">{r.systemPrompt || '（空 = 使用内置默认角色）'}</pre>
          </details>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Plus size={12} className="text-teal-600" /> 新增角色</div>
        <Input placeholder="角色名称，如：严谨科研导师" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea rows={4} className="font-mono text-[12px]" placeholder="系统提示词：角色定位 / 回答风格 / 必须遵守的规则 / 输出格式" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button variant="outline" size="sm" disabled={!name.trim() || busy === 'role-add'}
          onClick={() => void run('role-add', async () => { await api.config.createRole({ name: name.trim(), systemPrompt: prompt, isDefault: true }); setName(''); setPrompt(''); }, '角色已创建并设为默认')}>
          <Save size={12} /> 创建并设为默认
        </Button>
      </div>
    </div>
  );
}

function ConstraintEditor({ constraints, busy, run }: {
  constraints: ConfigConstraint[]; busy: string;
  run: (label: string, fn: () => Promise<unknown>, okText: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [rule, setRule] = useState('');
  const [level, setLevel] = useState('must');
  const [scope, setScope] = useState('all');
  const LEVEL: Record<string, string> = { must: '必须', must_not: '禁止', should: '建议' };
  return (
    <div className="space-y-2">
      {constraints.map((c) => (
        <div key={c.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
          <Badge tone={c.level === 'must_not' ? 'red' : c.level === 'must' ? 'teal' : 'slate'}>{LEVEL[c.level] || c.level}</Badge>
          <span className="text-[12px] text-slate-400 shrink-0">{c.scope === 'all' ? '全部' : c.scope === 'chat' ? '聊天' : '流水线'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{c.title}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{c.rule}</div>
          </div>
          <Button variant="ghost" size="sm" disabled={busy === `c-toggle-${c.id}`}
            onClick={() => void run(`c-toggle-${c.id}`, () => api.config.updateConstraint(c.id, { enabled: c.enabled ? 0 : 1 }), c.enabled ? '约束已停用' : '约束已启用')}>
            {c.enabled ? '停用' : '启用'}
          </Button>
          <Button variant="ghost" size="sm" className="text-rose-500" disabled={busy === `c-del-${c.id}`}
            onClick={() => void run(`c-del-${c.id}`, () => api.config.deleteConstraint(c.id), '约束已删除')}>
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Plus size={12} className="text-teal-600" /> 新增约束</div>
        <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-2">
          <Input placeholder="约束标题，如：引用可溯源" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select value={level} onChange={setLevel} options={[{ value: 'must', label: '必须' }, { value: 'must_not', label: '禁止' }, { value: 'should', label: '建议' }]} />
          <Select value={scope} onChange={setScope} options={[{ value: 'all', label: '全部调用' }, { value: 'chat', label: '仅聊天' }, { value: 'pipeline', label: '仅流水线' }]} />
        </div>
        <Textarea rows={2} placeholder="规则内容（会原样注入 system 提示）" value={rule} onChange={(e) => setRule(e.target.value)} />
        <Button variant="outline" size="sm" disabled={!title.trim() || !rule.trim() || busy === 'c-add'}
          onClick={() => void run('c-add', async () => { await api.config.createConstraint({ title: title.trim(), rule: rule.trim(), level, scope }); setTitle(''); setRule(''); }, '约束已创建，下一次 AI 调用即生效')}>
          <Save size={12} /> 保存约束
        </Button>
      </div>
    </div>
  );
}

function HookEditor({ hooks, busy, run }: {
  hooks: ConfigHook[]; busy: string;
  run: (label: string, fn: () => Promise<unknown>, okText: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [event, setEvent] = useState('chat:before');
  const [type, setType] = useState('prompt_inject');
  const [cfg, setCfg] = useState('{"text":"回答结尾附一句风险提示"}');
  const TYPE_LABEL: Record<string, string> = { prompt_inject: '注入提示', block: '拦截', webhook: 'Webhook' };
  return (
    <div className="space-y-2">
      {hooks.map((h) => (
        <div key={h.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
          <Badge tone={h.type === 'block' ? 'red' : h.type === 'webhook' ? 'blue' : 'teal'}>{TYPE_LABEL[h.type] || h.type}</Badge>
          <span className="text-[11px] text-slate-400 font-mono shrink-0">{h.event}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{h.name}</div>
            <div className="text-[11px] text-slate-400 font-mono truncate">{h.config}</div>
          </div>
          <Button variant="ghost" size="sm" disabled={busy === `h-toggle-${h.id}`}
            onClick={() => void run(`h-toggle-${h.id}`, () => api.config.updateHook(h.id, { enabled: h.enabled ? 0 : 1 }), h.enabled ? '钩子已停用' : '钩子已启用')}>
            {h.enabled ? '停用' : '启用'}
          </Button>
          <Button variant="ghost" size="sm" className="text-rose-500" disabled={busy === `h-del-${h.id}`}
            onClick={() => void run(`h-del-${h.id}`, () => api.config.deleteHook(h.id), '钩子已删除')}>
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-3 space-y-2">
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5"><Plus size={12} className="text-teal-600" /> 新增钩子</div>
        <div className="grid sm:grid-cols-[2fr_1fr_1fr] gap-2">
          <Input placeholder="钩子名称" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={event} onChange={setEvent} options={[
            { value: 'chat:before', label: 'chat:before' }, { value: 'chat:after', label: 'chat:after' },
            { value: 'pipeline:before', label: 'pipeline:before' }, { value: 'pipeline:after', label: 'pipeline:after' },
          ]} />
          <Select value={type} onChange={(v) => { setType(v); setCfg(v === 'block' ? '{"when":"keyword","keywords":["导出密钥"],"reason":"禁止导出密钥"}' : v === 'webhook' ? '{"url":"https://example.com/hook"}' : '{"text":"回答结尾附一句风险提示"}'); }}
            options={[{ value: 'prompt_inject', label: 'prompt_inject' }, { value: 'block', label: 'block' }, { value: 'webhook', label: 'webhook' }]} />
        </div>
        <Textarea rows={2} className="font-mono text-[12px]" value={cfg} onChange={(e) => setCfg(e.target.value)} />
        <Button variant="outline" size="sm" disabled={!name.trim() || busy === 'h-add'}
          onClick={() => void run('h-add', async () => { await api.config.createHook({ name: name.trim(), event, type, config: cfg }); setName(''); }, '钩子已创建（下一轮对话/流水线即执行）')}>
          <Save size={12} /> 保存钩子
        </Button>
      </div>
    </div>
  );
}
