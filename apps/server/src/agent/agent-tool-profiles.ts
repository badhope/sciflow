/**
 * Agent 工具作用域（profile）：按调用场景收窄暴露给模型的工具面。
 *
 * 为什么需要：
 *  1. 成本：工具 schema 每一步都要随请求重发。实测同一 chat 入口无工具时
 *     prompt_tokens≈1.9k，带 24 个工具时≈10.0–10.9k；工具循环会把倍数放大。
 *  2. 边界：自主科研要求「模型能做什么」可控。PI/实验者/评审者需要的工具面不同，
 *     全量暴露既浪费预算，也把配置中心写入口暴露给实验角色。
 *
 * 纪律：
 *  - profile 只收窄不放宽。最终工具集 = AGENT_TOOLS_ALLOW ∩ 技能开关 ∩ profile ∩ access。
 *  - 默认 profile = full，与既有行为完全一致；不做静默能力削减。
 *  - 读写分组：project/document/quality/experiment 各自拆 read/write，
 *    研究角色只拿 read，实验角色才拿 write；未知新工具按 write 处理（安全默认）。
 */
export type AgentToolProfileId = 'full' | 'research' | 'experiment' | 'config';

export type AgentToolGroup =
  | 'literature'
  | 'knowledge'
  | 'references'
  | 'writing'
  | 'project_read'
  | 'project_write'
  | 'document_read'
  | 'document_write'
  | 'quality_read'
  | 'quality_write'
  | 'experiment_read'
  | 'experiment_write'
  | 'browser'
  | 'memory'
  | 'task'
  | 'config'
  | 'extension'
  | 'chat'
  | 'research'
  | 'submission'
  | 'submission_write';
/** 精确分组优先：同一前缀下读写工具必须分开（否则 research 会误拿 document.update） */
const TOOL_GROUP_EXACT: Record<string, AgentToolGroup> = {
  'project.list': 'project_read',
  'project.get': 'project_read',
  'project.create': 'project_write',
  'project.update': 'project_write',
  'research.brief.get': 'project_read',
  'research.brief.update': 'project_write',
  'document.list': 'document_read',
  'document.get': 'document_read',
  'document.create': 'document_write',
  'document.update': 'document_write',
  'quality.latest': 'quality_read',
  'quality.overview': 'quality_read',
  'quality.history': 'quality_read',
  'quality.audit': 'quality_write',
  'experiment.list': 'experiment_read',
  'experiment.get': 'experiment_read',
  'experiment.run': 'experiment_write',
  'research.plan': 'research',
  'research.experiment': 'research',
  'research.critic': 'research',
  'research.expert': 'research',
  'submission.match': 'submission',
  'submission.cover': 'submission',
  'submission.reply': 'submission',
  'submission.track': 'submission',
  'submission.email': 'submission',
  'submission.track.create': 'submission_write',
};

/** 前缀兜底：未登记的新工具按「写」处理，窄 profile 下不可见（安全默认） */
const TOOL_GROUP_PREFIX: Record<string, AgentToolGroup> = {
  'literature.': 'literature',
  'knowledge.': 'knowledge',
  'references.': 'references',
  'outline.': 'writing',
  'writing.': 'writing',
  'project.': 'project_write',
  'document.': 'document_write',
  'quality.': 'quality_write',
  'experiment.': 'experiment_write',
  'browser.': 'browser',
  'memory.': 'memory',
  'task.': 'task',
  'config.': 'config',
  'extension.': 'extension',
  'chat.': 'chat',
  'submission.': 'submission',
};

export interface AgentToolProfile {
  id: AgentToolProfileId;
  label: string;
  /** 允许暴露的工具分组 */
  groups: AgentToolGroup[];
}

/**
 * 场景定义。
 * - research：只读科研面（检索/知识/引用/项目与文档读取/质量读取/实验读取/记忆）——PI、评审者用。
 * - experiment：科研只读 + 项目内写入 + 实验执行 + 浏览器——实验者用。
 * - config：配置中心写入口——配置场景专用。
 * - full：全量（默认，等价于既有行为）。
 */
export const AGENT_TOOL_PROFILES: Record<AgentToolProfileId, AgentToolProfile> = {
  full: {
    id: 'full',
    label: '全量工具',
    groups: [
      'literature',
      'knowledge',
      'references',
      'writing',
      'project_read',
      'project_write',
      'document_read',
      'document_write',
      'quality_read',
      'quality_write',
      'experiment_read',
      'experiment_write',
      'browser',
      'memory',
      'task',
      'config',
      'extension',
      'research',
      'submission',
      'submission_write',
      'chat',
    ],
  },
  research: {
    id: 'research',
    label: '科研只读',
    groups: [
      'literature',
      'knowledge',
      'references',
      'project_read',
      'document_read',
      'quality_read',
      'experiment_read',
      'memory',
      'task',
      'research',
      'submission',
      'chat',
    ],
  },
  experiment: {
    id: 'experiment',
    label: '实验执行',
    groups: [
      'literature',
      'knowledge',
      'references',
      'writing',
      'project_read',
      'project_write',
      'document_read',
      'document_write',
      'quality_read',
      'quality_write',
      'experiment_read',
      'experiment_write',
      'browser',
      'memory',
      'task',
      'research',
      'submission',
      'submission_write',
      'chat',
    ],
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

/** 工具名所属分组；先精确匹配，再前缀兜底；未登记返回 null。 */
export function agentToolGroup(toolName: string): AgentToolGroup | null {
  const exact = TOOL_GROUP_EXACT[toolName];
  if (exact) return exact;
  const prefix = Object.keys(TOOL_GROUP_PREFIX).find((p) => toolName.startsWith(p));
  return prefix ? TOOL_GROUP_PREFIX[prefix] : null;
}

/** 该 profile 是否允许此工具。 */
export function profileAllowsTool(profile: AgentToolProfile, toolName: string): boolean {
  const group = agentToolGroup(toolName);
  if (!group) return profile.id === 'full';
  return profile.groups.includes(group);
}
