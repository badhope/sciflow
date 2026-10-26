import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileJson, Loader2, Plus, RefreshCw, Sparkles, Trash2, Upload, Wand2 } from 'lucide-react';
import { api } from '../../api/client';
import type { ExtensionAsset, ExtensionKind, ExtensionKindsResponse } from '../../types';
import { Badge, Button, Card, Input, Textarea, errMsg } from '../../components/ui';

/**
 * 扩展中心（v1.4）：skill / mcp / role / constraint / hook / prompt 六类资产。
 *
 * 四种添加方式（本组件与 ExtensionQuickAdd 共用同一后端）：
 *  ① 手填模板 ② 粘贴 JSON/SKILL.md ③ 拖拽上传 .md/.json/.zip ④ 一键 AI 生成
 * 另：对话里让 AI 调用 extension.* 工具（第五种入口）。
 *
 * 私有优势工具（visibility=private）只在本机可见，导出包与外部 MCP 客户端不可见。
 */
export function ExtensionCenter({ defaultKind }: { defaultKind?: ExtensionKind }) {
  const [data, setData] = useState<ExtensionKindsResponse | null>(null);
  const [kind, setKind] = useState<ExtensionKind>(defaultKind || 'skill');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [openAdd, setOpenAdd] = useState(false);
  const [showPrivate, setShowPrivate] = useState(true);

  const load = useCallback(async () => {
    setErr('');
    try {
      setData(await api.extensions.list());
    } catch (e: unknown) {
      setErr(errMsg(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.extensions.list().then((r) => !cancelled && setData(r)).catch((e: unknown) => !cancelled && setErr(errMsg(e)));
    return () => { cancelled = true; };
  }, []);

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label); setErr(''); setMsg('');
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e: unknown) {
      setErr(errMsg(e));
    } finally { setBusy(''); }
  };

  if (!data) {
    return (
      <Card className="p-5 mb-4" id="settings-extensions">
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">扩展中心</div>
        {err ? <div className="text-xs text-rose-500">{err}</div> : <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载扩展目录…</div>}
      </Card>
    );
  }

  const assets = data.assets.filter((a) => a.kind === kind && (showPrivate || a.visibility !== 'private'));
  const kindInfo = data.kinds.find((k) => k.value === kind);

  return (
    <Card className="p-5 mb-4" id="settings-extensions">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <Sparkles size={16} className="text-teal-600" /> 扩展中心（内置 {data.assets.length} 项，默认启用）
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
            社区开源资产随仓库内置、开箱即用；SciFlow 私有优势工具仅本机可见（不导出）。可关闭/删除，也可恢复内置。
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" disabled={busy === 'reset'} onClick={() => void run('reset', () => api.extensions.resetBuiltin(), '已恢复全部内置资产')}>
            <RefreshCw size={12} /> 恢复内置
          </Button>
          <Button variant="outline" size="sm" disabled={busy === 'export'} onClick={() => void run('export', async () => {
            const bundle = await api.extensions.exportBundle();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `sciflow-extensions-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }, '扩展包已导出（不含私有工具）')}>
            <Download size={12} /> 导出
          </Button>
          <Button size="sm" onClick={() => setOpenAdd((v) => !v)}>
            <Plus size={12} /> 添加资产
          </Button>
        </div>
      </div>

      {err && <div role="alert" className="mb-2 text-xs text-rose-500">{err}</div>}
      {msg && <div className="mb-2 text-xs text-emerald-600 dark:text-emerald-400">{msg}</div>}

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {(data.kinds as { value: ExtensionKind; label: string; total: number; enabled: number }[]).map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${kind === k.value ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-teal-400'}`}
          >
            {k.label} <span className="opacity-70">{k.enabled}/{k.total}</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <input type="checkbox" checked={showPrivate} onChange={(e) => setShowPrivate(e.target.checked)} className="rounded border-slate-300" />
          显示私有优势工具
        </label>
      </div>

      {openAdd && <AddAssetPanel kind={kind} templates={data.templates} onDone={() => { setOpenAdd(false); void load(); }} />}

      {assets.length === 0 ? (
        <div className="text-xs text-slate-400 py-4 text-center">该分类暂无资产，点「添加资产」新增</div>
      ) : (
        <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
          {assets.map((a) => (
            <div key={a.id} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200">{a.name}</span>
                <Badge tone={a.source === 'builtin-private' ? 'amber' : a.source === 'user' ? 'blue' : 'slate'}>
                  {a.source === 'builtin-private' ? '内置·私有' : a.source === 'builtin-public' ? '内置·开源' : a.source === 'import' ? '导入' : '自建'}
                </Badge>
                {a.license && <span className="text-[10px] text-slate-400">{a.license}</span>}
                {a.install && <span className="text-[10px] text-slate-400 truncate max-w-[280px]" title={a.install}>安装：{a.install}</span>}
                <span className="ml-auto flex items-center gap-1">
                  {a.kind === 'prompt' && (
                    <Button variant="outline" size="sm" disabled={busy === `apply-${a.id}`}
                      onClick={() => void run(`apply-${a.id}`, () => api.extensions.apply(a.id), `已应用「${a.name}」（同类模板自动让位）`)}>
                      应用
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" disabled={busy === `t-${a.id}`}
                    onClick={() => void run(`t-${a.id}`, () => api.extensions.toggle(a.id, a.enabled === 0), a.enabled ? '已停用' : '已启用')}>
                    {a.enabled ? '停用' : '启用'}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-rose-500" disabled={busy === `d-${a.id}`}
                    onClick={() => void run(`d-${a.id}`, () => api.extensions.remove(a.id), a.source.startsWith('builtin') ? '内置资产已停用（不可物理删除）' : '已删除')}>
                    <Trash2 size={12} />
                  </Button>
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{a.description}</div>
              {a.repo && <div className="mt-0.5 text-[10px] text-slate-400 font-mono">github.com/{a.repo}</div>}
            </div>
          ))}
        </div>
      )}

      {kindInfo && <div className="mt-2 text-[11px] text-slate-400">{kindInfo.description}</div>}
    </Card>
  );
}

/** 添加面板：四种方式（手填 / 粘贴 / 上传 / 一键生成） */
export function AddAssetPanel({ kind, templates, onDone }: {
  kind: ExtensionKind;
  templates: ExtensionKindsResponse['templates'];
  onDone: () => void;
}) {
  const [mode, setMode] = useState<'form' | 'paste' | 'upload' | 'generate'>('form');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<string>('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const tpl = templates.find((t) => t.kind === kind);
  const example = JSON.stringify(tpl?.jsonExample ?? {}, null, 2);

  const submitJson = async (text: string) => {
    setBusy('save'); setErr(''); setInfo('');
    try {
      // 粘贴/手填统一走 /api/extensions/import（支持模板 JSON / MCP JSON / SKILL.md）
      const r = await api.extensions.importRaw({ filename: 'manual.json', content: text });
      const skipped = r.errors?.length ? `（跳过 ${r.errors.length} 条：${r.errors.join('；')}）` : '';
      setInfo(`新增 ${r.added} / 更新 ${r.updated}${skipped}`);
      setName(''); setDesc('');
      onDone();
    } catch (e: unknown) { setErr(errMsg(e)); } finally { setBusy(''); }
  };

  const submitForm = async () => {
    setBusy('form'); setErr('');
    try {
      const manifest: Record<string, unknown> = {};
      if (kind === 'skill') { manifest.mode = 'prompt'; manifest.instructions = jsonText || desc; }
      else if (kind === 'mcp') { manifest.transport = 'http'; manifest.url = /^https?:\/\//.test(desc) ? desc : ''; }
      else if (kind === 'role') { manifest.systemPrompt = jsonText || desc; }
      else if (kind === 'constraint') { manifest.title = name; manifest.rule = jsonText || desc; manifest.level = 'must'; manifest.scope = 'all'; }
      else if (kind === 'hook') { manifest.event = 'chat:before'; manifest.type = 'prompt_inject'; manifest.config = { text: jsonText || desc }; }
      else if (kind === 'prompt') { manifest.toolKey = 'polish'; manifest.prompt = jsonText || desc; manifest.enabled = 1; }
      await api.extensions.create({ kind, name: name.trim(), description: desc.trim() || name.trim(), manifest });
      setInfo('已创建并启用（已同步到对应子系统）');
      setName(''); setDesc('');
      onDone();
    } catch (e: unknown) { setErr(errMsg(e)); } finally { setBusy(''); }
  };

  const upload = async (file: File) => {
    setBusy('upload'); setErr(''); setInfo('');
    try {
      const r = await api.extensions.upload(file);
      const skipped = r.errors?.length ? `（跳过 ${r.errors.length} 条：${r.errors.slice(0, 3).join('；')}）` : '';
      setInfo(`已导入 ${r.added + r.updated} 条${skipped}`);
      onDone();
    } catch (e: unknown) { setErr(errMsg(e)); } finally { setBusy(''); }
  };

  const generate = async () => {
    setBusy('gen'); setErr(''); setInfo('');
    try {
      const r = await api.extensions.generate(kind, brief);
      setDraft(JSON.stringify(r.draft, null, 2));
      setInfo('草稿已生成，可直接编辑后点「保存草稿」；或重新生成');
    } catch (e: unknown) { setErr(errMsg(e)); } finally { setBusy(''); }
  };

  const saveDraft = async () => {
    setBusy('save-draft'); setErr('');
    try {
      const r = await api.extensions.importRaw({ filename: 'draft.json', content: draft });
      setInfo(`草稿已保存（新增 ${r.added} / 更新 ${r.updated}）`);
      onDone();
    } catch (e: unknown) { setErr(errMsg(e)); } finally { setBusy(''); }
  };

  const tabBtn = (m: typeof mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => { setMode(m); setErr(''); setInfo(''); }}
      className={`text-xs rounded-md px-2.5 py-1 border ${mode === m ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mb-3 rounded-lg border border-teal-200 dark:border-teal-800/60 bg-teal-50/40 dark:bg-teal-900/10 p-3">
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {tabBtn('form', '① 手填')}
        {tabBtn('paste', '② 粘贴 JSON/MD')}
        {tabBtn('upload', '③ 上传文件/压缩包')}
        {tabBtn('generate', '④ 一键 AI 生成')}
        <span className="ml-auto text-[11px] text-slate-400">当前类型：{tpl?.kind ?? kind}</span>
      </div>
      {err && <div role="alert" className="mb-2 text-xs text-rose-500">{err}</div>}
      {info && <div className="mb-2 text-xs text-emerald-600 dark:text-emerald-400">{info}</div>}

      {mode === 'form' && (
        <div className="space-y-2">
          <Input placeholder="名称（必填）" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder={kind === 'mcp' ? '说明 / HTTP(S) 端点（会写入 manifest.url）' : '一句话描述'} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Textarea rows={kind === 'role' || kind === 'prompt' ? 6 : 3} className="font-mono text-[12px]" placeholder={`${kind} 内容（提示词/规则/说明，按左侧模板填写）`} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!name.trim() || busy === 'form'} onClick={() => void submitForm()}>
              {busy === 'form' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} 保存并启用
            </Button>
            <span className="text-[11px] text-slate-400 self-center">保存后立即投影到对应子系统（技能/角色/约束/钩子/提示词/MCP）</span>
          </div>
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-2">
          <Textarea rows={10} className="font-mono text-[12px]" value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!jsonText.trim() || busy === 'save'} onClick={() => void submitJson(jsonText)}>
              {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <FileJson size={12} />} 导入
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setJsonText(example)}>重置为模板</Button>
          </div>
        </div>
      )}

      {mode === 'upload' && (
        <div
          className="rounded-lg border-2 border-dashed border-teal-300 dark:border-teal-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400 cursor-pointer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={20} className="mx-auto mb-1 text-teal-600" />
          拖拽文件到此处，或点击选择：SKILL.md / 模板 JSON / MCP JSON / ZIP 压缩包（≤32MB）
          <input ref={fileRef} type="file" accept=".md,.json,.zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          {busy === 'upload' && <div className="mt-2 flex items-center justify-center gap-1.5"><Loader2 size={12} className="animate-spin" /> 解析中…</div>}
        </div>
      )}

      {mode === 'generate' && (
        <div className="space-y-2">
          <Textarea rows={2} placeholder="用一两句话描述你想要的工具，例如：一个帮我把审稿意见分类并生成英文回复的科研技能" value={brief} onChange={(e) => setBrief(e.target.value)} />
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!brief.trim() || busy === 'gen'} onClick={() => void generate()}>
              {busy === 'gen' ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} 一键生成
            </Button>
            {draft && (
              <Button size="sm" variant="outline" disabled={busy === 'save-draft'} onClick={() => void saveDraft()}>
                保存草稿
              </Button>
            )}
          </div>
          {draft && <Textarea rows={10} className="font-mono text-[12px]" value={draft} onChange={(e) => setDraft(e.target.value)} />}
        </div>
      )}
    </div>
  );
}

/**
 * 快速添加按钮：放到任意资产面板（角色/技能/提示词/约束/钩子/MCP）旁边，
 * 点击展开同一套四种添加方式，保证「每个界面都能加」。
 */
export function ExtensionQuickAdd({ kind, label = '添加' }: { kind: ExtensionKind; label?: string }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<ExtensionKindsResponse['templates']>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api.extensions.list().then((r) => !cancelled && setTemplates(r.templates)).catch((e: unknown) => !cancelled && setErr(errMsg(e)));
    return () => { cancelled = true; };
  }, [open]);
  return (
    <div className="w-full">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {label}
      </Button>
      {err && <div className="mt-1 text-[11px] text-rose-500">{err}</div>}
      {open && templates.length > 0 && <div className="mt-2"><AddAssetPanel kind={kind} templates={templates} onDone={() => setOpen(false)} /></div>}
    </div>
  );
}

/** 供其它面板按 kind 直接渲染资产列表（复用 ExtensionCenter 的加载与开关逻辑） */
export function useExtensionAssets() {
  const [assets, setAssets] = useState<ExtensionAsset[]>([]);
  const reload = useCallback(async () => {
    const r = await api.extensions.list();
    setAssets(r.assets);
    return r.assets;
  }, []);
  return { assets, reload };
}
