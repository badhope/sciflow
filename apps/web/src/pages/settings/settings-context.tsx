import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { api } from '../../api/client';
import type {
  AppSettings, SelfCheck, ModelProvider, McpServerInfo, McpToolInfo,
  CustomIntent, CustomPromptTool, PipelineStepConfig, QualityWeightItem,
  DiscoveredModel, ModelProtocol,
} from '../../types';
import { errMsg } from '../../components/ui';
import type { ToastKind } from '../../components/ui';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UsageSummary {
  total: { calls: number; prompt_tokens: number; completion_tokens: number; total_tokens: number; avg_latency_ms: number; success_rate: number };
  byCaller: { caller: string; calls: number; total_tokens: number; success_rate: number; avg_latency_ms: number }[];
  byDay: { day: string; calls: number; total_tokens: number }[];
  byModel: { model: string; calls: number; total_tokens: number }[];
  budgetTokens: number;
  /** Agent 工具调用汇总（kind='tool'，不计 token） */
  tools?: { calls: number; failures: number; avgLatencyMs: number; byName: { name: string; calls: number }[] };
}

interface SettingsState {
  settings: AppSettings | null;
  check: SelfCheck | null;
  checking: boolean;
  error: string;
  loading: boolean;
  mcpInfo: { protocol: string; version: string; name: string; tools: number } | null;
  mcpTools: McpToolInfo[];
  providers: ModelProvider[];
  mcpServers: McpServerInfo[];
  intents: CustomIntent[];
  intentForm: { key: string; label: string; route: string; keywords: string };
  promptTools: CustomPromptTool[];
  pipelineSteps: PipelineStepConfig[];
  qualityWeights: QualityWeightItem[];
  judgmentMode: string;
  providersLoaded: boolean;
}

const initialState: SettingsState = {
  settings: null, check: null, checking: false, error: '', loading: false,
  mcpInfo: null, mcpTools: [], providers: [], mcpServers: [],
  intents: [], intentForm: { key: '', label: '', route: '/literature', keywords: '' },
  promptTools: [], pipelineSteps: [], qualityWeights: [], judgmentMode: 'auto',
  providersLoaded: false,
};

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_DONE'; settings: AppSettings; mcpInfo: { protocol: string; version: string; name: string; tools: number }; mcpTools: McpToolInfo[]; providers: ModelProvider[]; intents: CustomIntent[]; promptTools: CustomPromptTool[]; pipelineSteps: PipelineStepConfig[]; qualityWeights: QualityWeightItem[]; judgmentMode: string; mcpServers: McpServerInfo[] }
  | { type: 'LOAD_ERROR'; message: string }
  | { type: 'CHECK_START' }
  | { type: 'CHECK_DONE'; check: SelfCheck }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'SET_PROVIDERS'; providers: ModelProvider[] }
  | { type: 'SET_SETTINGS'; settings: AppSettings }
  | { type: 'REFRESH_CUSTOMIZATION'; intents: CustomIntent[]; promptTools: CustomPromptTool[]; pipelineSteps: PipelineStepConfig[]; qualityWeights: QualityWeightItem[]; judgmentMode: string; providers: ModelProvider[]; mcpServers: McpServerInfo[] }
  | { type: 'SET_INTENT_FORM'; form: { key: string; label: string; route: string; keywords: string } }
  | { type: 'RESET_INTENT_FORM' }
  | { type: 'SET_INTENTS'; intents: CustomIntent[] }
  | { type: 'SET_PROMPT_TOOLS'; promptTools: CustomPromptTool[] }
  | { type: 'SET_PIPELINE_STEPS'; pipelineSteps: PipelineStepConfig[] }
  | { type: 'SET_QUALITY_WEIGHTS'; qualityWeights: QualityWeightItem[] }
  | { type: 'SET_JUDGMENT_MODE'; mode: string }
  | { type: 'SET_MCP_SERVERS'; servers: McpServerInfo[] }
  | { type: 'SET_PROVIDERS_LOADED'; loaded: boolean };

function reducer(state: SettingsState, action: Action): SettingsState {
  switch (action.type) {
    case 'LOAD_START': return { ...state, loading: true };
    case 'LOAD_DONE': return { ...state, loading: false, settings: action.settings, mcpInfo: action.mcpInfo, mcpTools: action.mcpTools, providers: action.providers, intents: action.intents, promptTools: action.promptTools, pipelineSteps: action.pipelineSteps, qualityWeights: action.qualityWeights, judgmentMode: action.judgmentMode, mcpServers: action.mcpServers, providersLoaded: true };
    case 'LOAD_ERROR': return { ...state, loading: false, error: action.message };
    case 'CHECK_START': return { ...state, checking: true, error: '' };
    case 'CHECK_DONE': return { ...state, checking: false, check: action.check };
    case 'SET_ERROR': return { ...state, error: action.message, checking: false };
    case 'SET_PROVIDERS': return { ...state, providers: action.providers };
    case 'SET_SETTINGS': return { ...state, settings: action.settings };
    case 'REFRESH_CUSTOMIZATION': return { ...state, intents: action.intents, promptTools: action.promptTools, pipelineSteps: action.pipelineSteps, qualityWeights: action.qualityWeights, judgmentMode: action.judgmentMode, providers: action.providers, mcpServers: action.mcpServers };
    case 'SET_INTENT_FORM': return { ...state, intentForm: action.form };
    case 'RESET_INTENT_FORM': return { ...state, intentForm: { key: '', label: '', route: '/literature', keywords: '' } };
    case 'SET_INTENTS': return { ...state, intents: action.intents };
    case 'SET_PROMPT_TOOLS': return { ...state, promptTools: action.promptTools };
    case 'SET_PIPELINE_STEPS': return { ...state, pipelineSteps: action.pipelineSteps };
    case 'SET_QUALITY_WEIGHTS': return { ...state, qualityWeights: action.qualityWeights };
    case 'SET_JUDGMENT_MODE': return { ...state, judgmentMode: action.mode };
    case 'SET_MCP_SERVERS': return { ...state, mcpServers: action.servers };
    case 'SET_PROVIDERS_LOADED': return { ...state, providersLoaded: action.loaded };
    default: return state;
  }
}

/* ------------------------------------------------------------------ */
/*  Context value type                                                 */
/* ------------------------------------------------------------------ */

export interface SettingsContextValue {
  state: SettingsState;
  load: () => Promise<void>;
  runCheck: () => Promise<void>;
  saveProvider: (form: {
    id?: string; name: string; baseUrl: string; apiKey: string; model: string;
    protocol?: ModelProtocol; contextWindow?: number; maxOutput?: number; toolCalling?: number;
    models?: DiscoveredModel[];
  }) => Promise<void>;
  activateProvider: (id: string) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  addMcpServer: (form: { name: string; url: string }) => Promise<void>;
  removeMcpServer: (id: string) => Promise<void>;
  createIntent: (form: { key: string; label: string; route: string; keywords: string }) => Promise<void>;
  toggleIntent: (id: string, enabled: number) => Promise<void>;
  deleteIntent: (id: string) => Promise<void>;
  savePrompt: (toolKey: string, prompt: string) => Promise<void>;
  deletePrompt: (toolKey: string) => Promise<void>;
  togglePipelineStep: (key: string, enabled: number) => Promise<void>;
  resetPipeline: () => Promise<void>;
  saveQualityWeights: (weights: Record<string, number>) => Promise<void>;
  resetQualityWeights: () => Promise<void>;
  setJudgmentMode: (mode: string) => Promise<void>;
  dispatch: React.Dispatch<Action>;
  toast: (kind: ToastKind, text: string) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function SettingsProvider({ children, toast }: { children: ReactNode; toast: (kind: ToastKind, text: string) => void }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  /** 首次挂载自动加载：此前只有「刷新」按钮里调用 load()，用户首次进入设置页会永久停在「加载配置…」 */
  const autoLoaded = useRef(false);

  const refreshAll = useCallback(async () => {
    try {
      const [intents, promptTools, pipelineSteps, w, mode, providers, mcpServers] = await Promise.all([
        api.customization.listIntents(),
        api.customization.listPrompts(),
        api.customization.listPipelineSteps(),
        api.customization.listQualityWeights(),
        api.customization.getJudgmentMode(),
        api.settings.listProviders(),
        api.settings.listMcpServers(),
      ]);
      dispatch({ type: 'REFRESH_CUSTOMIZATION', intents, promptTools, pipelineSteps, qualityWeights: w, judgmentMode: mode.mode, providers, mcpServers });
    } catch (e: unknown) {
      toast('error', errMsg(e));
    }
  }, [toast]);

  const load = useCallback(async () => {
    dispatch({ type: 'LOAD_START' });
    try {
      const [settings, mcpInfoRes, mcpToolsRes, providers, intents, promptTools, pipelineSteps, w, mode, mcpServers] = await Promise.all([
        api.settings.get(),
        api.mcp.info(),
        api.mcp.tools(),
        api.settings.listProviders(),
        api.customization.listIntents(),
        api.customization.listPrompts(),
        api.customization.listPipelineSteps(),
        api.customization.listQualityWeights(),
        api.customization.getJudgmentMode(),
        api.settings.listMcpServers(),
      ]);
      dispatch({ type: 'LOAD_DONE', settings, mcpInfo: mcpInfoRes, mcpTools: mcpToolsRes.tools, providers, intents, promptTools, pipelineSteps, qualityWeights: w, judgmentMode: mode.mode, mcpServers });
    } catch (e: unknown) {
      dispatch({ type: 'LOAD_ERROR', message: errMsg(e) });
    }
  }, []);

  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    void load();
  }, [load]);

  const runCheck = useCallback(async () => {
    dispatch({ type: 'CHECK_START' });
    try {
      const r = await api.settings.check();
      dispatch({ type: 'CHECK_DONE', check: r });
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, []);

  const saveProvider = useCallback(async (form: {
    id?: string; name: string; baseUrl: string; apiKey: string; model: string;
    protocol?: ModelProtocol; contextWindow?: number; maxOutput?: number; toolCalling?: number;
    models?: DiscoveredModel[];
  }) => {
    try {
      await api.settings.saveProvider(form);
      await refreshAll();
      const s = await api.settings.get();
      dispatch({ type: 'SET_SETTINGS', settings: s });
      toast('success', form.id ? '厂商已更新' : '厂商已添加');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
      throw e;
    }
  }, [refreshAll, toast]);

  const activateProvider = useCallback(async (id: string) => {
    try {
      await api.settings.activateProvider(id);
      await refreshAll();
      const s = await api.settings.get();
      dispatch({ type: 'SET_SETTINGS', settings: s });
      toast('success', '模型已切换');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [refreshAll, toast]);

  const removeProvider = useCallback(async (id: string) => {
    try {
      await api.settings.removeProvider(id);
      await refreshAll();
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [refreshAll]);

  const addMcpServer = useCallback(async (form: { name: string; url: string }) => {
    try {
      await api.settings.saveMcpServer(form);
      const servers = await api.settings.listMcpServers();
      dispatch({ type: 'SET_MCP_SERVERS', servers });
      toast('success', '外部 MCP 服务器已添加');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const removeMcpServer = useCallback(async (id: string) => {
    try {
      await api.settings.removeMcpServer(id);
      const servers = await api.settings.listMcpServers();
      dispatch({ type: 'SET_MCP_SERVERS', servers });
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, []);

  const createIntent = useCallback(async (form: { key: string; label: string; route: string; keywords: string }) => {
    try {
      await api.customization.createIntent({ key: form.key, label: form.label, route: form.route, keywords: form.keywords.split(/[,，\s]+/).filter(Boolean) });
      const intents = await api.customization.listIntents();
      dispatch({ type: 'SET_INTENTS', intents });
      dispatch({ type: 'RESET_INTENT_FORM' });
      toast('success', '自定义意图已生效');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const toggleIntent = useCallback(async (id: string, enabled: number) => {
    try {
      await api.customization.updateIntent(id, { enabled });
      const intents = await api.customization.listIntents();
      dispatch({ type: 'SET_INTENTS', intents });
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, []);

  const deleteIntentCb = useCallback(async (id: string) => {
    try {
      await api.customization.deleteIntent(id);
      const intents = await api.customization.listIntents();
      dispatch({ type: 'SET_INTENTS', intents });
      toast('success', '自定义意图已删除');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const savePrompt = useCallback(async (toolKey: string, prompt: string) => {
    try {
      await api.customization.upsertPrompt(toolKey, prompt);
      const promptTools = await api.customization.listPrompts();
      dispatch({ type: 'SET_PROMPT_TOOLS', promptTools });
      toast('success', '提示词已保存');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const deletePrompt = useCallback(async (toolKey: string) => {
    try {
      await api.customization.deletePrompt(toolKey);
      const promptTools = await api.customization.listPrompts();
      dispatch({ type: 'SET_PROMPT_TOOLS', promptTools });
      toast('success', '已恢复系统默认');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const togglePipelineStep = useCallback(async (key: string, enabled: number) => {
    try {
      const steps = await api.customization.updatePipelineStep(key, enabled);
      dispatch({ type: 'SET_PIPELINE_STEPS', pipelineSteps: steps });
      toast('success', '步骤状态已更新');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const resetPipeline = useCallback(async () => {
    try {
      await api.customization.resetPipelineSteps();
      const steps = await api.customization.listPipelineSteps();
      dispatch({ type: 'SET_PIPELINE_STEPS', pipelineSteps: steps });
      toast('success', '已恢复 8 步全启用');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const saveQualityWeights = useCallback(async (weights: Record<string, number>) => {
    try {
      const w = await api.customization.setQualityWeights(weights);
      dispatch({ type: 'SET_QUALITY_WEIGHTS', qualityWeights: w });
      toast('success', '评分权重已保存');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const resetQualityWeights = useCallback(async () => {
    try {
      const equal = Object.fromEntries(state.qualityWeights.map(x => [x.key, 1]));
      const w = await api.customization.setQualityWeights(equal);
      dispatch({ type: 'SET_QUALITY_WEIGHTS', qualityWeights: w });
      toast('success', '已恢复 7 维等权');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [state.qualityWeights, toast]);

  const setJudgmentMode = useCallback(async (mode: string) => {
    try {
      await api.customization.setJudgmentMode(mode);
      dispatch({ type: 'SET_JUDGMENT_MODE', mode });
      toast('success', '判断模式已更新');
    } catch (e: unknown) {
      dispatch({ type: 'SET_ERROR', message: errMsg(e) });
    }
  }, [toast]);

  const value = useMemo<SettingsContextValue>(() => ({
    state, load, runCheck, saveProvider, activateProvider, removeProvider,
    addMcpServer, removeMcpServer, createIntent, toggleIntent, deleteIntent: deleteIntentCb,
    savePrompt, deletePrompt, togglePipelineStep, resetPipeline,
    saveQualityWeights, resetQualityWeights, setJudgmentMode,
    dispatch, toast,
  }), [state, load, runCheck, saveProvider, activateProvider, removeProvider,
    addMcpServer, removeMcpServer, createIntent, toggleIntent, deleteIntentCb,
    savePrompt, deletePrompt, togglePipelineStep, resetPipeline,
    saveQualityWeights, resetQualityWeights, setJudgmentMode, toast]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within <SettingsProvider>');
  return ctx;
}
