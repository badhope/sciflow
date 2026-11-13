/**
 * Agent 工具作用域（profile）：按调用场景收窄暴露给模型的工具面。
 *
 * 为什么需要（两条独立理由）：
 *  1. 成本：工具 schema 每一步都要随请求重发。实测 llm_call_log：同一 chat 入口
 *     无工具时 prompt_tokens≈1.9k，带 24 个工具时≈10.0–10.9k，单步多付约 8k。
 *     工具循环（maxSteps=12）每步重复付费，自主循环会把倍数再放大。
 *  2. 边界：自主科研要求「模型能做什么」可控。PI/实验者/评审者需要的工具面不同，
 *     全量暴露既浪费预算，也把配置中心的写入口暴露给实验角色。
 *
 * 纪律：
 *  - profile 只收窄不放宽。最终工具集 = AGENT_TOOLS_ALLOW ∩ 技能开关 ∩ profile。
 *  - 默认 profile = full，与既有行为完全一致；不做静默能力削减。
 *  - 未登记的工具前缀在窄 profile 下默认不可见（新增工具不会自动泄漏进研究角色）。
 */
export type AgentToolProfileId = 'full' | 'research' | 'experiment' | 'config';

/** 工具前缀分组。新增工具若不属于任何分组，只能在 full 下可见。 */
export type AgentToolGroup =
  | 'literature'
  | 'knowledge'
  | 'references'
  | 'writing'
  | 'config'
  | 'extension'
  | 'chat';

const TOOL_GROUP_PREFIX: Record<string, AgentToolGroup> = {
  'literature.': 'literature',
  'knowledge.': 'knowledge',
  'references.': 'references',
  'outline.': 'writing',
  'writing.': 'writing',
  'config.': 'config',
  'extension.': 'extension',
  'chat.': 'chat',
};

export interface AgentToolProfile {
  id: AgentToolProfileId;
  label: string;
  /** 允许暴露的工具分组 */
  groups: AgentToolGroup[];
}

/**
 * 场景定义。
 * - research：只读科研面（检索/知识/引用抽取/问答）——PI、评审者用，不能写配置。
 * - experiment：只读科研面 + 起草产物——实验者可写文档草稿，仍不能改配置中心。
 * - config：配置中心写入口（角色/约束/钩子/权限/扩展）——配置场景专用。
 * - full：全量（默认，等价于既有行为）。
 */
export const AGENT_TOOL_PROFILES: Record<AgentToolProfileId, AgentToolProfile> = {
  full: {
    id: 'full',
    label: '全量工具',
    groups: ['literature', 'knowledge', 'references', 'writing', 'config', 'extension', 'chat'],
  },
  research: {
    id: 'research',
    label: '科研只读',
    groups: ['literature', 'knowledge', 'references', 'chat'],
  },
  experiment: {
    id: 'experiment',
    label: '实验执行',
    groups: ['literature', 'knowledge', 'references', 'writing', 'chat'],
  },
  config: {
    id: 'config',
    label: '配置中心',
    groups: ['config', 'extension'],
  },
};

const PROFILE_IDS = Object.keys(AGENT_TOOL_PROFILES) as AgentToolProfileId[];

export function isAgentToolProfileId(value: unknown): value is AgentToolProfileId {
  return typeof value === 'string' && (PROFILE_IDS as string[]).includes(value);
}

/** 解析生效的 profile：显式参数 > 环境变量 AGENT_TOOLS_PROFILE > full。 */
export function resolveAgentToolProfile(explicit?: string): AgentToolProfile {
  const raw = explicit ?? process.env.AGENT_TOOLS_PROFILE ?? 'full';
  const id = String(raw).trim();
  return AGENT_TOOL_PROFILES[isAgentToolProfileId(id) ? id : 'full'];
}

/** 工具名所属分组；未登记前缀返回 null（窄 profile 下不可见）。 */
export function agentToolGroup(toolName: string): AgentToolGroup | null {
  const prefix = Object.keys(TOOL_GROUP_PREFIX).find((p) => toolName.startsWith(p));
  return prefix ? TOOL_GROUP_PREFIX[prefix] : null;
}

/** 该 profile 是否允许此工具。 */
export function profileAllowsTool(profile: AgentToolProfile, toolName: string): boolean {
  const group = agentToolGroup(toolName);
  if (!group) return profile.id === 'full';
  return profile.groups.includes(group);
}
