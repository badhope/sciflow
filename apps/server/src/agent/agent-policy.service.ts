/**
 * Agent 工具权限档（运行期访问控制，不是配置中心自己的权限矩阵）。
 *
 * 目的：让「AI 能看什么、能改什么」由用户显式选择，默认不碰系统级配置。
 *  - strict：只读工具（检索/问答/预览），不能写任何东西；
 *  - workspace：只读 + 项目内写入（文档/实验/项目数据），不能改系统配置与扩展；
 *  - full：全部工具（写系统配置/扩展仍需逐次人工或 AI 专家审批）。
 *
 * 这是工具暴露面的最后一道闸：即使模型绕过提示词直接调工具，
 * AgentToolBridge 的执行侧也会再校验一次。
 */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { appSettings } from '../db/schema';

export type AgentAccessMode = 'strict' | 'workspace' | 'full';

export const AGENT_ACCESS_MODES: { value: AgentAccessMode; label: string; description: string }[] = [
  { value: 'strict', label: '只读', description: '只能检索、问答、预览；任何写入（文档/实验/配置）都会被拒绝' },
  { value: 'workspace', label: '工作区（默认）', description: '可读写当前项目的文档/实验/研究数据；系统配置与扩展不可改' },
  { value: 'full', label: '最大权限', description: '允许修改系统配置与扩展；写操作仍需逐次审批' },
];

const READ_ONLY_TOOLS = new Set([
  'literature.search',
  'literature.summarize',
  'knowledge.query',
  'chat.answer',
  'references.extract',
  'references.evidence',
  'outline.generate',
  'writing.polish',
  'writing.translate',
  'writing.review',
  'config.snapshot',
  'config.preview',
  'extension.list',
]);

const PROJECT_WRITE_PREFIXES = ['document.', 'project.', 'experiment.'];
const SYSTEM_WRITE_PREFIXES = ['config.', 'extension.'];

function isProjectWrite(toolName: string): boolean {
  return PROJECT_WRITE_PREFIXES.some((p) => toolName.startsWith(p));
}

function isSystemWrite(toolName: string): boolean {
  return SYSTEM_WRITE_PREFIXES.some((p) => toolName.startsWith(p)) && !READ_ONLY_TOOLS.has(toolName);
}

export function parseAgentAccessMode(value: unknown): AgentAccessMode | null {
  const v = String(value ?? '').trim();
  return v === 'strict' || v === 'workspace' || v === 'full' ? v : null;
}

/** 非法/缺失一律回落 workspace（不是 full）；strict 需要显式选择 */
export function normalizeAgentAccessMode(value: unknown): AgentAccessMode {
  return parseAgentAccessMode(value) ?? 'workspace';
}

export function toolAllowedInMode(mode: AgentAccessMode, toolName: string): boolean {
  if (READ_ONLY_TOOLS.has(toolName)) return true;
  if (mode === 'full') return true;
  if (mode === 'strict') return false;
  // workspace：项目内写入放行；系统级写入拒绝；未知工具默认拒绝（新增工具不会自动提权）
  if (isSystemWrite(toolName)) return false;
  if (isProjectWrite(toolName)) return true;
  return false;
}

@Injectable()
export class AgentPolicyService {
  /** 当前权限档（读 app_setting；异常时回落 workspace） */
  mode(): AgentAccessMode {
    try {
      const row = db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'agent_access_mode')).get();
      return normalizeAgentAccessMode(row?.value);
    } catch {
      return 'workspace';
    }
  }

  setMode(value: unknown): AgentAccessMode {
    const mode = parseAgentAccessMode(value);
    if (!mode) throw new Error('非法权限档');
    db.insert(appSettings)
      .values({ key: 'agent_access_mode', value: mode })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: mode } })
      .run();
    return mode;
  }

  canUse(toolName: string): boolean {
    return toolAllowedInMode(this.mode(), toolName);
  }

  /** 给被拒绝的调用一个可读原因，模型可以据此改用只读路径 */
  denyReason(toolName: string): string {
    const mode = this.mode();
    if (mode === 'strict') return `当前权限档为「只读」，工具 ${toolName} 需要写入权限；请改用检索/预览，或让用户在设置中提升权限档。`;
    if (isSystemWrite(toolName)) return `当前权限档为「工作区」，工具 ${toolName} 会修改系统配置/扩展；需要用户在设置中切到「最大权限」并逐次审批。`;
    return `当前权限档不允许工具 ${toolName}。`;
  }
}
