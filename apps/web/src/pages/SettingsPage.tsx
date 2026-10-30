import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ToastContext } from '../App';
import { CheckCircle2, Database, FlaskConical, Keyboard, Loader2, Plug, Plus, Power, Server, Trash2, Wand2, Workflow, XCircle, Gauge } from 'lucide-react';
import { HOTKEY_DOCS, hotkeyLabel } from '../lib/hotkeys-docs';
import { api } from '../api/client';
import type { CustomPromptTool } from '../types';
import { Badge, Button, Card, CollapsibleCard, ErrorBox, Input, Modal, SectionTitle, Select, Spinner, Textarea, errMsg } from '../components/ui';
import { HBar } from '../components/charts';
import { SettingsProvider, useSettings } from './settings/settings-context';
import { ProviderManager } from './settings/ProviderManager';
import { WebSearchSettings } from './settings/WebSearchSettings';
import { UsageStats } from './settings/UsageStats';
import { McpToolList } from './settings/McpToolList';
import { PersonaSettings } from './settings/PersonaSettings';
import { ConfigCenterSettings } from './settings/ConfigCenterSettings';
import { ExtensionCenter, ExtensionQuickAdd } from './settings/ExtensionCenter';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { useAuthRole } from '../lib/use-auth-role';
import { Lock } from 'lucide-react';

const ModelIcon = ({ ok }: { ok?: boolean }) =>
  ok === undefined ? null : ok ? <CheckCircle2 size={16} className="text-emerald-500" /> : <XCircle size={16} className="text-rose-500" />;

/* ------------------------------------------------------------------ */
/*  Intent Editor (collapsible)                                        */
/* ------------------------------------------------------------------ */
function IntentEditor() {
  const { state, createIntent, toggleIntent, deleteIntent, dispatch, setJudgmentMode, toast: _toast } = useSettings();
  const [open, setOpen] = useState(false);

  const modeLabels: Record<string, string> = {
    auto: '规则优先 + LLM 兜底',
    rule_first: '规则优先',
    llm_first: 'LLM 优先',
    rule_only: '仅规则',
  };

  return (
    <CollapsibleCard
      icon={<Wand2 size={16} className="text-teal-600" />}
      title="意图识别自定义"
      summary={state.intents.length > 0 ? `已自定义 ${state.intents.length} 个意图` : '使用系统内置 17 个意图'}
      right={<span className="text-[11px] text-slate-400">判断模式：{modeLabels[state.judgmentMode] || state.judgmentMode}</span>}
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 w-24 shrink-0">意图判断模式</span>
          <select
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1.5 text-xs bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
            value={state.judgmentMode}
            onChange={(e) => setJudgmentMode(e.target.value)}
          >
            <option value="auto">自动（规则优先 + LLM 兜底，推荐）</option>
            <option value="rule_first">规则优先（未命中再调 LLM）</option>
            <option value="llm_first">LLM 优先（更灵活，耗 token）</option>
            <option value="rule_only">仅规则（零成本，未命中一律问答）</option>
          </select>
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 rounded px-3 py-2">
          自定义科研动作意图：新增意图后，科研问答识别时优先命中你的关键词（Jev 式规则秒判）。系统内置 17 个意图不可删除，但可用同 key 覆盖。
        </div>
        <div className="grid sm:grid-cols-4 gap-2">
          <Input placeholder="意图标识（如 meta_analysis）" value={state.intentForm.key} onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'SET_INTENT_FORM', form: { ...state.intentForm, key: e.target.value } })} />
          <Input placeholder="中文标签（如 Meta 分析）" value={state.intentForm.label} onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'SET_INTENT_FORM', form: { ...state.intentForm, label: e.target.value } })} />
          <select
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-2 text-xs bg-white dark:bg-slate-900 outline-none focus:border-teal-500"
            value={state.intentForm.route}
            onChange={(e) => dispatch({ type: 'SET_INTENT_FORM', form: { ...state.intentForm, route: e.target.value } })}
          >
            <option value="/literature">文献调研</option>
            <option value="/writing">论文写作</option>
            <option value="/pipeline">全自动流水线</option>
            <option value="/quality">质量评分</option>
            <option value="/workspace">工作台</option>
          </select>
          <Input placeholder="触发词，逗号分隔（如 meta分析,荟萃分析）" value={state.intentForm.keywords} onChange={(e: React.ChangeEvent<HTMLInputElement>) => dispatch({ type: 'SET_INTENT_FORM', form: { ...state.intentForm, keywords: e.target.value } })} />
        </div>
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            className="text-xs"
            disabled={!state.intentForm.key || !state.intentForm.label}
            onClick={() => createIntent(state.intentForm)}
          >
            <Plus size={13} /> 新增意图
          </Button>
          <span className="text-[11px] text-slate-400">{state.intents.length} 个自定义意图</span>
        </div>
        {state.intents.length === 0 ? (
          <div className="text-xs text-slate-400 dark:text-slate-500">暂无自定义意图（系统内置 17 个科研意图默认生效）</div>
        ) : (
          <div className="space-y-1.5">
            {state.intents.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                <Badge tone={it.enabled ? 'teal' : 'slate'}>{it.enabled ? '启用' : '停用'}</Badge>
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{it.label}</span>
                <span className="text-[11px] text-slate-400">{it.key} · {it.route}</span>
                <span className="text-[11px] text-slate-400 truncate flex-1 min-w-0 w-full sm:w-auto">
                  {(() => { try { return JSON.parse(it.keywords).join('、'); } catch { return it.keywords; } })()}
                </span>
                <button className="text-slate-300 hover:text-teal-600" onClick={() => toggleIntent(it.id, it.enabled ? 0 : 1)}>
                  <Power size={13} />
                </button>
                <button className="text-slate-300 hover:text-rose-500" onClick={() => deleteIntent(it.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </CollapsibleCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Prompt Editor (collapsible)                                        */
/* ------------------------------------------------------------------ */
function PromptEditor() {
  const { state, savePrompt, deletePrompt } = useSettings();
  const [open, setOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<CustomPromptTool | null>(null);
  const [promptText, setPromptText] = useState('');

  const customizedCount = state.promptTools.filter((t) => t.customized).length;
  const summary = customizedCount > 0 ? `${customizedCount}/${state.promptTools.length} 个已自定义` : '全部使用系统默认';

  return (
    <>
      <CollapsibleCard
        icon={<FlaskConical size={16} className="text-teal-600" />}
        title="科研工具提示词自定义"
        summary={summary}
        open={open}
        onToggle={() => setOpen(o => !o)}
      >
        <div className="mt-4">
          <div className="mb-3"><ExtensionQuickAdd kind="prompt" label="从扩展中心添加提示词模板" /></div>
          <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
            每个 AI 科研工具（综述/精读/缺口/对比/评审…）默认提示词可被你的自定义覆盖：点击「编辑」写入你的专属提示词（含你的领域规范/输出格式/风格要求），未配置时自动使用系统默认。
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {state.promptTools.map((t) => (
              <div key={t.toolKey} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200">{t.toolLabel}</span>
                <span className="text-[11px] text-slate-400 truncate flex-1 min-w-0 w-full sm:w-auto">{t.toolKey}</span>
                <Badge tone={t.customized ? (t.enabled ? 'green' : 'amber') : 'slate'}>{t.customized ? (t.enabled ? '已自定义' : '已停用') : '系统默认'}</Badge>
                <button
                  className="text-xs text-teal-600 hover:underline"
                  onClick={() => { setEditingPrompt(t); setPromptText(t.prompt); }}
                >
                  编辑
                </button>
                {t.customized && (
                  <button className="text-slate-300 hover:text-rose-500" onClick={() => deletePrompt(t.toolKey)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </CollapsibleCard>

      {editingPrompt && (
        <Modal open onClose={() => setEditingPrompt(null)} title={`编辑提示词 · ${editingPrompt.toolLabel}`}>
          <Textarea rows={8} className="mb-3" placeholder="在这里编写自定义提示词…（建议包含：角色、任务、输入格式、输出 JSON 结构要求）" value={promptText} onChange={(e) => setPromptText(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="text-xs" onClick={() => setEditingPrompt(null)}>取消</Button>
            <Button className="text-xs" disabled={!promptText.trim()} onClick={() => { savePrompt(editingPrompt.toolKey, promptText); setEditingPrompt(null); }}>保存</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline Steps Editor (collapsible)                                */
/* ------------------------------------------------------------------ */
function PipelineEditor() {
  const { state, togglePipelineStep, resetPipeline } = useSettings();
  const toast = useContext(ToastContext);
  const [open, setOpen] = useState(false);
  const offCount = state.pipelineSteps.filter((s) => !s.enabled).length;
  const summary = offCount > 0 ? `${state.pipelineSteps.length - offCount}/${state.pipelineSteps.length} 步启用（${offCount} 步已关）` : `${state.pipelineSteps.length} 步全启用（默认）`;

  /**
   * 运行参数（v1.9.1 补接线）：token 预算 / 检索重排 / 流水线联网检索。
   * 三者此前只能改库或环境变量——预算耗尽的报错让用户「到设置中调整」，
   * 但设置里根本没有这一项。这里接入 customization.pipeline-settings 单一入口。
   */
  const [runParams, setRunParams] = useState<{
    tokenBudget: number;
    retrievalRerank: boolean;
    webSearch: boolean;
    qualityStandard: string;
    qualityStandardLabel: string;
    qualityPassScore: number;
  } | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  useEffect(() => {
    if (!open || runParams) return;
    let cancelled = false;
    api.customization.getPipelineSettings().then((r) => {
      if (cancelled) return;
      setRunParams({
        tokenBudget: r.tokenBudget,
        retrievalRerank: r.retrievalRerank,
        webSearch: r.webSearch,
        qualityStandard: r.qualityStandard,
        qualityStandardLabel: r.qualityStandardLabel,
        qualityPassScore: r.qualityPassScore,
      });
      setBudgetDraft(String(r.tokenBudget));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open, runParams]);

  const saveBudget = async () => {
    const n = Math.floor(Number(budgetDraft));
    if (!Number.isFinite(n) || n < 0) { toast('error', 'token 预算需为非负整数（0=不限）'); return; }
    setSavingBudget(true);
    try {
      const r = await api.customization.setPipelineSettings({ tokenBudget: n });
      setRunParams({
        tokenBudget: r.tokenBudget,
        retrievalRerank: r.retrievalRerank,
        webSearch: r.webSearch,
        qualityStandard: r.qualityStandard,
        qualityStandardLabel: r.qualityStandardLabel,
        qualityPassScore: r.qualityPassScore,
      });
      toast('success', '预算已更新，对之后新建的流水线生效');
    } catch (e: unknown) {
      toast('error', errMsg(e));
    } finally {
      setSavingBudget(false);
    }
  };

  const toggleParam = async (patch: { retrievalRerank?: boolean; webSearch?: boolean }) => {
    try {
      const r = await api.customization.setPipelineSettings(patch);
      setRunParams({
        tokenBudget: r.tokenBudget,
        retrievalRerank: r.retrievalRerank,
        webSearch: r.webSearch,
        qualityStandard: r.qualityStandard,
        qualityStandardLabel: r.qualityStandardLabel,
        qualityPassScore: r.qualityPassScore,
      });
    } catch (e: unknown) {
      toast('error', errMsg(e));
    }
  };

  const fmtK = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));

  return (
    <CollapsibleCard
      icon={<Workflow size={16} className="text-teal-600" />}
      title="流水线步骤自定义"
      summary={summary}
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <div className="mt-4">
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          全自动流水线的 {state.pipelineSteps.length} 个阶段可自定义启停：关闭的步骤直接跳过（步骤显示「已禁用」）。
          「主题验证 / 完成」为骨架步骤不可关闭，其余均可自由启停。改动对之后新建的流水线生效。
        </div>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {state.pipelineSteps.map((st) => (
            <div key={st.key} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
              <button
                className={`relative w-7 h-4 rounded-full transition-colors ${st.enabled ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'} ${!st.configurable ? 'opacity-50 cursor-not-allowed' : ''}`}
                onClick={() => { if (st.configurable) togglePipelineStep(st.key, st.enabled ? 0 : 1); }}
              >
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${st.enabled ? 'left-3.5' : 'left-0.5'}`} />
              </button>
              <span className="text-xs text-slate-700 dark:text-slate-200">{st.label}</span>
              <span className="text-[11px] text-slate-400 flex-1">{st.key}</span>
              {!st.configurable ? (
                <span className="text-[11px] text-slate-400">骨架</span>
              ) : st.enabled ? (
                <Badge tone="teal">启用</Badge>
              ) : (
                <Badge tone="slate">已禁用</Badge>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Button variant="outline" className="text-xs" onClick={resetPipeline}>
            恢复默认（全启用）
          </Button>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">运行参数</div>
          {!runParams ? (
            <div className="text-xs text-slate-400">加载中…</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-slate-700 dark:text-slate-200 w-32 shrink-0" htmlFor="pipeline-token-budget">任务 token 预算</label>
                <Input
                  id="pipeline-token-budget"
                  className="w-40"
                  inputMode="numeric"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                  placeholder="300000（0=不限）"
                />
                <Button variant="outline" className="text-xs" onClick={() => void saveBudget()} disabled={savingBudget}>
                  {savingBudget ? <Loader2 size={13} className="animate-spin" /> : null} 保存
                </Button>
                <span className="text-[11px] text-slate-400">
                  当前 {runParams.tokenBudget > 0 ? `${fmtK(runParams.tokenBudget)} tokens/任务` : '不限'}；超出后流水线终止并提示
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-slate-700 dark:text-slate-200 w-32 shrink-0">检索重排（LLM）</span>
                <button
                  className={`relative w-7 h-4 rounded-full transition-colors ${runParams.retrievalRerank ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                  aria-pressed={runParams.retrievalRerank}
                  aria-label="检索重排开关"
                  onClick={() => void toggleParam({ retrievalRerank: !runParams.retrievalRerank })}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${runParams.retrievalRerank ? 'left-3.5' : 'left-0.5'}`} />
                </button>
                <span className="text-[11px] text-slate-400 flex-1">
                  知识库检索后用模型按问题相关性重打分（更准但更慢更贵，默认关）
                </span>
                <Badge tone={runParams.retrievalRerank ? 'teal' : 'slate'}>{runParams.retrievalRerank ? '开启' : '关闭'}</Badge>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-slate-700 dark:text-slate-200 w-32 shrink-0">流水线联网检索</span>
                <button
                  className={`relative w-7 h-4 rounded-full transition-colors ${runParams.webSearch ? 'bg-teal-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                  aria-pressed={runParams.webSearch}
                  aria-label="流水线联网检索开关"
                  onClick={() => void toggleParam({ webSearch: !runParams.webSearch })}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${runParams.webSearch ? 'left-3.5' : 'left-0.5'}`} />
                </button>
                <span className="text-[11px] text-slate-400 flex-1">
                  文献步骤 0 命中时并入公开网页线索（只作写作参考、不进文献库；provider 在「联网搜索」配置）
                </span>
                <Badge tone={runParams.webSearch ? 'teal' : 'slate'}>{runParams.webSearch ? '开启' : '关闭'}</Badge>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-slate-700 dark:text-slate-200 w-32 shrink-0">质量评审标准</label>
                <Select
                  className="w-56"
                  value={runParams.qualityStandard}
                  onChange={(v: string) => void toggleParam({ qualityStandard: v } as never)}
                  options={[
                    { value: 'draft', label: '草稿迭代（快速产出，及格 70）' },
                    { value: 'standard', label: 'SCI 通用期刊（及格 80）' },
                    { value: 'strict', label: '顶刊 IEEE Trans / Nature 子刊（及格 85）' },
                    { value: 'review', label: '综述 Survey / Review（及格 80）' },
                    { value: 'conference', label: '会议论文 CCF-B/C（及格 78）' },
                  ]}
                />
                <span className="text-[11px] text-slate-400 flex-1">
                  决定评分阈值与质量门及格线：当前「{runParams.qualityStandardLabel}」，及格 {runParams.qualityPassScore} 分。篇幅、引用强度、句式、模板腔与章节均衡的合格线随标准缩放——满分 = 该级别可投稿，而不是形式合规。
                </span>
                <Badge tone="teal">{runParams.qualityStandardLabel} · {runParams.qualityPassScore} 分及格</Badge>
              </div>
            </div>
          )}
        </div>
      </div>
    </CollapsibleCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Quality Weights Editor (collapsible)                               */
/* ------------------------------------------------------------------ */
function QualityWeightsEditor() {
  const { state, saveQualityWeights, resetQualityWeights } = useSettings();
  const [open, setOpen] = useState(false);
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(state.qualityWeights.map((x) => [x.key, String(x.weight)]))
  );
  const isDefault = state.qualityWeights.every((x) => x.weight === 1);

  return (
    <CollapsibleCard
      icon={<Gauge size={16} className="text-teal-600" />}
      title="质量评分权重自定义"
      summary={isDefault ? '等权（默认）' : '已自定义加权'}
      open={open}
      onToggle={() => setOpen(o => !o)}
    >
      <div className="mt-4">
        <div className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          论文质量总分 = 各维度得分 × 权重 的加权平均。默认等权，可按你的评审偏好加大某维度影响力。
        </div>
        <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {state.qualityWeights.map((d) => (
            <div key={d.key} className="flex items-center gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
              <span className="text-xs text-slate-700 dark:text-slate-200 w-12">{d.label}</span>
              <Input className="w-20" value={weightInputs[d.key] ?? String(d.weight)} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWeightInputs(o => ({ ...o, [d.key]: e.target.value }))} />
              <span className="text-[11px] text-slate-400">×</span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">权重分布预览</div>
          <HBar
            data={state.qualityWeights.map((d) => ({
              name: d.label,
              value: Number(weightInputs[d.key] ?? d.weight) || 0,
            }))}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            className="text-xs"
            onClick={async () => {
              const weights: Record<string, number> = {};
              for (const d of state.qualityWeights) {
                const v = Number(weightInputs[d.key]);
                if (!Number.isFinite(v) || v <= 0 || v > 5) return;
                weights[d.key] = v;
              }
              await saveQualityWeights(weights);
              setWeightInputs(Object.fromEntries(state.qualityWeights.map(x => [x.key, String(x.weight)])));
            }}
          >
            保存权重
          </Button>
          <Button variant="outline" className="text-xs" onClick={async () => { await resetQualityWeights(); setWeightInputs(Object.fromEntries(state.qualityWeights.map(x => [x.key, '1']))); }}>
            恢复等权
          </Button>
        </div>
      </div>
    </CollapsibleCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Settings Layout Orchestrator                                       */
/* ------------------------------------------------------------------ */
function SettingsLayout() {
  const { state, load, runCheck, dispatch } = useSettings();
  const [model, setModel] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; reply: string; model: string; latencyMs: number } | null>(null);
  const [testing, setTesting] = useState(false);

  const testModel = async () => {
    if (!model) return;
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.settings.testModel(model));
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  /**
   * 设置页分区导航：**必须与下方 DOM 的真实顺序一致**。
   * 历史缺陷：导航顺序是 AI→角色→用量→路由→…→MCP→扩展→配置→自定义，
   * 实际 DOM 是 AI→扩展→配置→角色→用量→…；且 settings-persona / settings-extensions /
   * settings-config 三个锚点当时在 DOM 里不存在（点了没反应），settings-custom 是空 div。
   * 现在按真实顺序组织，并把「连接测试」补进导航（原来有卡片却没有入口）。
   */
  const sections = useMemo(() => [
    { id: 'settings-appearance', label: '外观与主题' },
    { id: 'settings-ai', label: 'AI 服务' },
    { id: 'settings-extensions', label: '扩展中心' },
    { id: 'settings-config', label: '配置中心' },
    { id: 'settings-persona', label: '角色与技能' },
    { id: 'settings-usage', label: '用量成本' },
    { id: 'settings-providers', label: '模型路由' },
    { id: 'settings-web', label: '联网搜索' },
    { id: 'settings-check', label: '环境自检' },
    { id: 'settings-model-test', label: '连接测试' },
    { id: 'settings-mcp', label: 'MCP 工具' },
    { id: 'settings-custom', label: '高级自定义' },
  ], []);
  /**
   * 跳转分区。
   * 实测坑：本应用的滚动容器是 .app-shell__content（overflowY:auto），不是 window；
   * 且 `smooth` 滚动在长页面上会被后续的 activeSection 重渲染打断。
   * 这里显式对容器做 scrollTo（扣除导航条高度），并把导航项自身滚到中间。
   */
  const jump = (id: string) => {
    const node = document.getElementById(id);
    if (!node) return;
    const scroller = document.querySelector<HTMLElement>('.app-shell__content');
    const navH = document.querySelector<HTMLElement>('.settings-nav')?.getBoundingClientRect().height ?? 0;
    const nav = document.querySelector('.settings-nav');
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
    if (scroller) {
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - navBottom + navH;
      // 用 auto 而非 smooth：平滑滚动会被 setActiveSection 触发的重渲染打断（实测滚了 0px 就停）
      scroller.scrollTo({ top, behavior: 'auto' });
    } else {
      node.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
    // 导航项只做横向滚动；用 scrollIntoView 会连带滚动主内容容器，把刚滚好的位置又拉回去
    const navEl = document.querySelector<HTMLElement>('.settings-nav');
    const navItem = document.querySelector<HTMLElement>(`.settings-nav__item[data-target="${id}"]`);
    if (navEl && navItem && navEl.scrollWidth > navEl.clientWidth) {
      navEl.scrollTo({ left: navItem.offsetLeft - navEl.clientWidth / 2 + navItem.offsetWidth / 2, behavior: 'auto' });
    }
    jumpLockRef.current = true;
    setActiveSection(id);
    window.setTimeout(() => { jumpLockRef.current = false; }, 400);
  };

  // 滚动跟踪：高亮当前视口内的分区（对标大厂设置页的导航激活态）
  const [activeSection, setActiveSection] = useState(sections[0].id);
  /**
   * 跳转期间锁定高亮：scrollTo 是异步生效的，滚动监听会在位置真正到位前
   * 读到旧位置并把 active 改回上一节（实测「点配置中心，高亮停在扩展中心」）。
   * 锁 400ms 足够覆盖一次即时滚动 + 一次渲染。
   */
  const jumpLockRef = useRef(false);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.app-shell__content');
    const onScroll = () => {
      const nav = document.querySelector<HTMLElement>('.settings-nav');
      const offset = nav ? nav.getBoundingClientRect().bottom : 80;
      // 取「顶部已越过导航条底边」的最后一个分区：长分区滚动到一半时也能正确高亮
      let current = sections[0].id;
      for (const s of sections) {
        const node = document.getElementById(s.id);
        if (!node) continue;
        // 容差取 8px：跳转后目标节点顶部恰好落在导航条下沿，用 24px 容差会被判成上一个分区
        if (node.getBoundingClientRect().top <= offset + 8) current = s.id;
      }
      if (jumpLockRef.current) return;
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener('scroll', onScroll);
  }, [sections]);

  return (
    <div className="page-container">
      <ErrorBox message={state.error} />

      {/* 页内导航：设置页内容长（>3 屏），提供锚点直达与当前位置 */}
      <nav aria-label="设置分组" className="settings-nav">
        {sections.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => jump(it.id)}
            data-target={it.id}
            aria-current={activeSection === it.id ? 'true' : undefined}
            className={`settings-nav__item ${activeSection === it.id ? 'settings-nav__item--active' : ''}`}
          >
            {it.label}
          </button>
        ))}
      </nav>

      {/* 外观与主题：风格包 + 明暗模式 */}
      <AppearanceSettings />

      {/* AI 配置总览 */}
      <Card className="p-4 mb-4" id="settings-ai">
        <SectionTitle extra={<Button variant="outline" onClick={load}><Server size={14} /> 刷新</Button>}>
          <span className="flex items-center gap-2">
            <Plug size={16} className="text-teal-600" /> AI 服务配置
          </span>
        </SectionTitle>
        {!state.settings ? (
          <Spinner label="加载配置…" />
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">接口地址 (Base URL)</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200 break-all">{state.settings.ai.baseUrl}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">当前模型</div>
              <div className="text-sm font-mono text-slate-700 dark:text-slate-200">{state.settings.ai.model}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">API Key 状态</div>
              <div className="text-sm flex items-center gap-1.5">
                <ModelIcon ok={state.settings.ai.configured} />
                {state.settings.ai.configured ? '已配置' : '未配置（请在服务端环境变量中填写）'}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">可用模型（实时拉取）</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">{state.settings.ai.models.join(' · ')}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">运行环境</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">Node {state.settings.env.node} · 端口 {state.settings.env.port}</div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-4">
              <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">文献数据源</div>
              <div className="text-sm text-slate-700 dark:text-slate-200">{state.settings.sources.literature.join(' + ')}</div>
            </div>
          </div>
        )}
      </Card>

      {/* 扩展中心：内置社区开源资产 + SciFlow 私有优势工具（默认全启用） */}
      <div id="settings-extensions"><ExtensionCenter /></div>

      {/* 配置中心：角色库 / 约束工程 / 钩子 / 权限 / 预设 / 审计 */}
      <div id="settings-config"><ConfigCenterSettings /></div>

      {/* 角色与技能（persona + skills） */}
      <div id="settings-persona"><PersonaSettings /></div>

      {/* Usage Stats */}
      <div id="settings-usage"><UsageStats /></div>

      {/* Model Routing + Provider Manager */}
      <div id="settings-providers"><ProviderManager settings={state.settings} /></div>

      {/* F-3.4 联网搜索：provider 切换 + chat 兜底开关 */}
      <div id="settings-web"><WebSearchSettings /></div>

      {/* 环境自检 */}
      <Card className="p-4 mb-4" id="settings-check">
        <SectionTitle extra={<Button onClick={runCheck} disabled={state.checking}>{state.checking ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} 运行自检</Button>}>
          <span className="flex items-center gap-2">
            <Database size={16} className="text-teal-600" /> 环境自检
          </span>
        </SectionTitle>
        {state.check && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 text-sm">
              <ModelIcon ok={state.check.database.ok} />
              <span className="text-slate-600 dark:text-slate-300">数据库</span>
              <span className="text-slate-400 dark:text-slate-500 text-xs truncate">{state.check.database.path}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3 text-sm">
              <ModelIcon ok={state.check.ai.ok} />
              <span className="text-slate-600 dark:text-slate-300">AI 连通性（{state.check.ai.model}）</span>
              <span className={`text-xs ${state.check.ai.ok ? 'text-emerald-600' : 'text-rose-500'}`}>
                {state.check.ai.ok ? `${state.check.ai.latencyMs}ms · ${state.check.ai.detail}` : state.check.ai.detail}
              </span>
            </div>
            {state.check.retrieval && (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <ModelIcon ok={state.check.retrieval.ok} />
                  <span className="text-slate-600 dark:text-slate-300">检索栈</span>
                  <span className="flex flex-wrap gap-1.5 text-xs">
                    <Badge tone={state.check.retrieval.vector ? 'green' : 'amber'}>向量 {state.check.retrieval.vector ? '可用' : '降级'}</Badge>
                    <Badge tone={state.check.retrieval.embeddingModel ? 'green' : 'amber'}>嵌入模型 {state.check.retrieval.embeddingModel ? '已配置' : '未配置'}</Badge>
                    <Badge tone={state.check.retrieval.fullText ? 'green' : 'red'}>全文索引 {state.check.retrieval.fullText ? '可用' : '不可用'}</Badge>
                  </span>
                </div>
                {state.check.retrieval.notes.length > 0 && (
                  <ul className="mt-1.5 ml-6 list-disc text-[11px] text-amber-600 dark:text-amber-400 space-y-0.5">
                    {state.check.retrieval.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 快捷键速查（F-3.2）：数据源 lib/hotkeys-docs，与真实注册一一对应（commands.test 锁定） */}
      <Card className="p-4 mb-4" id="settings-model-test">
        <SectionTitle>
          <span className="flex items-center gap-2">
            <Keyboard size={16} className="text-teal-600" /> 快捷键速查
          </span>
        </SectionTitle>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {HOTKEY_DOCS.map((h) => (
            <div key={`${h.combo}-${h.label}`} className="flex items-center justify-between gap-3 py-1 border-b border-slate-50 dark:border-slate-800/60 last:border-0">
              <span className="text-xs text-slate-600 dark:text-slate-300 truncate">
                {h.label}
                <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">{h.scope}</span>
              </span>
              <kbd className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 font-mono">
                {hotkeyLabel(h)}
              </kbd>
            </div>
          ))}
        </div>
      </Card>

      {/* 模型连接测试 */}
      <Card className="p-5">
        <SectionTitle extra={<Button onClick={testModel} disabled={testing || !model} variant="success">{testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} 测试模型</Button>}>
          <span className="flex items-center gap-2">
            <FlaskConical size={16} className="text-teal-600" /> 模型连接测试
          </span>
        </SectionTitle>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <div className="text-xs text-slate-400 dark:text-slate-500 mb-1">选择模型实测连通性</div>
            <Select
              className="w-full"
              options={[
                { value: '', label: '选择模型…' },
                ...(state.settings?.ai.models || []).map((m) => ({ value: m, label: m })),
              ]}
              value={model}
              onChange={setModel}
            />
          </div>
        </div>
        {testResult && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
            <div className="flex items-center gap-2 font-medium">
              <ModelIcon ok={testResult.ok} />
              {testResult.model} · {testResult.latencyMs}ms
            </div>
            <div className="mt-1 text-slate-600 dark:text-slate-300">{testResult.reply}</div>
          </div>
        )}
      </Card>

      {/* MCP Tool List */}
      <div id="settings-mcp"><McpToolList /></div>

      {/* ===== 自定义中心（默认折叠 · 渐进披露） ===== */}
      <div id="settings-custom" />
      <IntentEditor />
      <PromptEditor />
      <PipelineEditor />
      <QualityWeightsEditor />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public export                                                      */
/* ------------------------------------------------------------------ */
export function SettingsPage() {
  const toast = useContext(ToastContext);
  const role = useAuthRole();

  /**
   * 企业模式的普通成员（v1.8）：实例级配置（模型 Key / baseURL / 权限档 / 钩子 /
   * 扩展资产 / 用量 / 联网 provider）在服务端已收紧为 admin 专属。这里直接给出
   * 只读说明，而不是让用户点进去吃一墙 403。
   * 外观与主题属于个人偏好（纯 localStorage），对所有人开放 —— 所以设置页不整页隐藏。
   */
  if (role === 'member') {
    return (
      <div className="page-container">
        <Card className="p-5 mb-4" id="settings-member-notice">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300">
              <Lock size={16} aria-hidden="true" />
            </span>
            <div>
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">当前账号是普通成员</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                模型接入、权限档、注入钩子、扩展资产、用量统计与联网服务商属于实例级配置，仅管理员可修改。
                你可以正常使用工作台、写作、文献、知识库、流水线、质量与投稿；如需调整模型或权限，请联系管理员。
              </div>
            </div>
          </div>
        </Card>
        <AppearanceSettings />
      </div>
    );
  }

  return (
    <SettingsProvider toast={toast}>
      <SettingsLayout />
    </SettingsProvider>
  );
}

export default SettingsPage;
