import { Injectable, Logger } from '@nestjs/common';
import { tool as aiTool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { createHash } from 'node:crypto';
import { McpService, resolveMcpToolName } from '../mcp/mcp.service';
import { TaskListService, type TaskInput } from './task-list.service';
import { ApprovalService } from './approval.service';
import { PlanAuthorizationService } from './plan-authorization.service';
import { AgentTraceService } from './agent-trace.service';
import { db } from '../db/database';
import { appSettings, llmCallLogs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { envInt } from '../common/env';
import { profileAllowsTool, resolveAgentToolProfile, type AgentToolProfile } from './agent-tool-profiles';
import { AgentPolicyService } from './agent-policy.service';
import { redactSensitive, shouldRedactForMode } from '../common/redaction';
import type { AuthPayload } from '../auth/auth.service';

/**
 * Agent 工具桥：把 SciFlow 的 MCP 工具（科研能力 + 配置中心）暴露给模型，形成真正的 tool-calling 链路。
 *
 * 设计要点：
 *  - 工具定义单一来源：复用 McpService.tools（REST / MCP 协议 / Agent 三条入口同一份实现）。
 *  - 每次工具调用都留痕：有 runId（流水线）时写 agent_step 形成可回溯轨迹，
 *    否则写 llm_call_log（kind='tool'）供用量看板统计次数/耗时/失败率。
 *  - 参数先过 MCP 的 guardrail（zod 校验），畸形参数不进入业务逻辑。
 *  - 调用数量与总时长有硬上限，避免模型陷入工具循环烧 token。
 */
export interface AgentToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  error?: string;
}

const MAX_TOOL_CALLS = envInt('AGENT_MAX_TOOL_CALLS', 24, { min: 1, max: 100 });
const TOOL_TIMEOUT_MS = envInt('AGENT_TOOL_TIMEOUT_MS', 20_000, { min: 1_000, max: 300_000 });
/** 长任务工具单独放宽：质量评审/实验/浏览器打开/页面断言天然超过 20s。 */
const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  'research.plan': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'research.experiment': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'research.critic': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'research.expert': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'submission.match': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'submission.cover': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'submission.reply': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'submission.email': envInt('AGENT_TOOL_TIMEOUT_RESEARCH_MS', 120_000, { min: 10_000, max: 600_000 }),
  'quality.audit': envInt('AGENT_TOOL_TIMEOUT_QUALITY_MS', 120_000, { min: 10_000, max: 600_000 }),
  'experiment.run': envInt('AGENT_TOOL_TIMEOUT_EXPERIMENT_MS', 60_000, { min: 10_000, max: 600_000 }),
  'browser.open': envInt('AGENT_TOOL_TIMEOUT_BROWSER_MS', 45_000, { min: 10_000, max: 600_000 }),
  'browser.verify': envInt('AGENT_TOOL_TIMEOUT_BROWSER_MS', 45_000, { min: 10_000, max: 600_000 }),
};
/** 同一（工具，参数）组合在一次请求内的最大重复次数——超过即拒绝执行并要求模型换路径。
 *  这是 2026 生产事故榜第一名「失控循环」的重复检测护栏：次数上限拦不住
 *  「24 次以内反复调同一个工具刷同一批结果」的空转。 */
const TOOL_REPEAT_LIMIT = envInt('AGENT_TOOL_REPEAT_LIMIT', 3, { min: 2, max: 20 });

/** 工具暴露模式：full=直接暴露全部允许工具；dynamic=只暴露核心工具 + tool_search/tool_invoke。 */
const TOOL_MODE: 'full' | 'dynamic' = process.env.AGENT_TOOL_MODE === 'dynamic' ? 'dynamic' : 'full';
/** dynamic 模式下直接暴露的“高频只读/导航”工具；写操作一律走 tool_invoke，按需发现 schema。 */
const DYNAMIC_CORE = new Set([
  'literature.search',
  'literature.summarize',
  'knowledge.query',
  'project.list',
  'project.get',
  'document.list',
  'document.get',
  'quality.overview',
  'experiment.list',
  'experiment.get',
  'memory.search',
  'chat.answer',
]);

type BridgeTool = ReturnType<McpService['list']>[number];

/** 一次 buildToolSet 内的共享护栏状态：调用计数/重复检测/作用域。 */
interface GuardCtx {
  projectId?: string;
  runId?: string;
  user?: AuthPayload;
  profile: AgentToolProfile;
  skills: Set<string> | null;
  calls: { n: number };
  repeat: Map<string, number>;
}

/** 参数稳定序列化：键排序后再哈希，避免模型改写参数键序导致重复检测失效 */
function toolCallKey(name: string, args: Record<string, unknown>): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, stable(val)]),
      );
    }
    return v;
  };
  return `${name}:${createHash('sha1').update(JSON.stringify(stable(args))).digest('hex').slice(0, 16)}`;
}

@Injectable()
export class AgentToolBridge {
  private readonly logger = new Logger(AgentToolBridge.name);

  constructor(
    private readonly mcp: McpService,
    private readonly trace?: AgentTraceService,
    private readonly taskList?: TaskListService,
    private readonly approvals?: ApprovalService,
    private readonly plans?: PlanAuthorizationService,
    private readonly policy?: AgentPolicyService,
  ) {}

  /** 技能→工具前缀映射：设置页停用某技能后，对应工具不再暴露给模型（技能真实生效，非仅展示） */
  private enabledSkillKeys(): Set<string> | null {
    try {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'skills')).get();
      if (!row?.value) return null; // 未配置 = 内置技能全启用
      const skills = JSON.parse(row.value) as { key?: string; enabled?: number }[];
      if (!Array.isArray(skills) || skills.length === 0) return null;
      return new Set(skills.filter((s) => s.enabled !== 0 && s.key).map((s) => String(s.key)));
    } catch {
      return null;
    }
  }

  /** 工具是否被技能开关允许：未配置技能时全部放行；配置后按映射裁剪 */
  private allowedBySkills(toolName: string, enabled: Set<string> | null): boolean {
    if (!enabled) return true;
    if (toolName.startsWith('config.')) return true; // 配置工具不受科研技能开关影响
    if (toolName.startsWith('literature.') || toolName.startsWith('references.')) return enabled.has('literature_search');
    if (toolName.startsWith('knowledge.')) return enabled.has('knowledge_qa');
    if (toolName.startsWith('writing.') || toolName.startsWith('outline.') || toolName === 'chat.answer') return enabled.has('writing_assist');
    return true;
  }

  /** 本轮对话是否启用工具（app_setting agent_tools=on，默认开启） */
  isEnabled(): boolean {
    try {
      const row = db.select().from(appSettings).where(eq(appSettings.key, 'agent_tools')).get();
      if (row) return row.value === 'on';
    } catch {
      /* 表未建 */
    }
    return process.env.AGENT_TOOLS !== 'off';
  }

  /**
   * 构建 AI SDK ToolSet（每次请求独立实例）。
   *
   * 关键约束：
   *  - **项目作用域**：projectId 由调用方注入并覆盖模型入参，避免模型瞎填导致跨项目检索；
   *  - **计数隔离**：调用上限放在闭包里，并发对话互不影响（此前是单例字段，A 的 reset 会重置 B）；
   *  - **超时可控**：每次调用独立超时，结束后清理定时器；
   *  - **工具作用域**：opts.profile 收窄暴露面（默认 full，等价既有行为），见 agent-tool-profiles.ts；
   *  - **主体透传**：opts.user 必须传给 MCP 层，否则企业模式下每个工具都过不了项目归属校验。
   */
  buildToolSet(projectId?: string, runId?: string, opts?: { profile?: string; user?: AuthPayload }): ToolSet {
    const allow = new Set(
      (process.env.AGENT_TOOLS_ALLOW || 'literature.search,literature.summarize,knowledge.query,outline.generate,writing.polish,writing.translate,writing.review,research.plan,research.experiment,research.critic,research.expert,submission.match,submission.cover,submission.reply,submission.track,submission.email,submission.track.create,references.extract,references.evidence,project.list,project.get,research.brief.get,research.brief.update,project.create,project.update,document.list,document.get,document.create,document.update,document.snapshot,document.revise_section,quality.audit,quality.overview,quality.history,experiment.run,experiment.list,experiment.get,browser.open,browser.text,browser.verify,browser.close,memory.search,memory.add,writing.draft,chat.answer,config.snapshot,config.set_permission,config.upsert_role,config.upsert_constraint,config.delete_constraint,config.upsert_hook,config.apply_preset,config.preview,extension.list,extension.create,extension.toggle,extension.generate')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const profile = resolveAgentToolProfile(opts?.profile);
    const set: ToolSet = {};
    const ctx: GuardCtx = {
      projectId,
      runId,
      user: opts?.user,
      profile,
      skills: this.enabledSkillKeys(),
      calls: { n: 0 },
      repeat: new Map<string, number>(),
    };
    for (const t of this.mcp.list()) {
      if (!allow.has(t.name)) continue;
      if (TOOL_MODE === 'dynamic' && !DYNAMIC_CORE.has(t.name)) continue;
      if (!profileAllowsTool(profile, t.name)) continue;
      if (this.policy && !this.policy.canUse(t.name)) continue;
      if (!this.allowedBySkills(t.name, ctx.skills)) continue;
      // 无项目上下文时不暴露「必须带 projectId」的工具：避免模型编造 projectId 跨项目取数
      const required = Array.isArray(t.inputSchema?.required) ? (t.inputSchema.required as string[]) : [];
      if (!projectId && required.includes('projectId')) continue;
      // 工具名不能含点号（部分 provider 拒绝），统一转下划线
      const safeName = t.name.replace(/\./g, '_');
      set[safeName] = aiTool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (args: Record<string, unknown>) => this.runGuarded(t, args, ctx),
      });
    }
    // ── 原生 harness 工具：不依赖 MCP 注册表，直接由模型驱动 ──
    // 任务清单：让模型把多步工作显式列出来，用户能看到进度而不是黑盒。
    if (this.taskList) {
      set.update_todo_list = aiTool({
        description:
          '更新当前任务清单。做多步任务时先列清单，每完成一步就更新状态，让用户看到进度。整份清单一次性传入（会替换旧清单）。',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              description: '完整清单，按执行顺序排列',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: '任务描述，一句话说清要做什么' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
                  priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['content'],
              },
            },
          },
          required: ['tasks'],
        }),
        execute: async (args: { tasks?: TaskInput[] }) => {
          const tasks = this.taskList!.replaceAll(args.tasks ?? [], projectId ?? null, runId ?? null);
          return { ok: true, count: tasks.length, summary: this.taskList!.summary(projectId ?? null, runId ?? null) };
        },
      });
    }
    // 任务清单读取：update_todo_list 只写不读，模型无法在后续轮次核对进度。
    if (this.taskList) {
      set.task_list = aiTool({
        description: '读取当前任务清单（含状态与进度摘要）。多步任务续跑/汇报前先读，避免重复劳动。',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => ({
          tasks: this.taskList!.list(projectId ?? null, runId ?? null),
          summary: this.taskList!.summary(projectId ?? null, runId ?? null),
        }),
      });
    }
    // 审批：有副作用的工具先问用户，拒绝时给出可读原因让模型换路径。
    if (this.approvals) {
      set.request_approval = aiTool({
        description:
          '对会产生副作用或消耗外部资源的操作请求用户批准（如执行代码、修改正文、改全局配置）。批准后继续，拒绝则换一种方式。',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {
            toolName: { type: 'string', description: '拟执行的工具名' },
            reason: { type: 'string', description: '为什么需要执行它，用一句话向用户说明' },
            args: { type: 'object', description: '拟传入的参数' },
          },
          required: ['toolName', 'reason'],
        }),
        execute: async (args: { toolName: string; reason: string; args?: Record<string, unknown> }) => {
          const canonical = this.canonicalToolName(args.toolName);
          if (!this.approvals!.needsApproval(canonical)) {
            return { required: false, message: '该工具无需审批，可直接执行' };
          }
          // 与执行闸使用同一套作用域参数，保证「批准什么就执行什么」
          const scopedArgs = this.scopeArgs(canonical, args.args ?? {}, projectId);
          const record = this.approvals!.request({
            toolName: canonical,
            args: scopedArgs,
            reason: args.reason,
            projectId: projectId ?? null,
            runId: runId ?? null,
          });
          return {
            required: true,
            approvalId: record.id,
            status: record.status,
            toolName: canonical,
            args: scopedArgs,
            message: '已提交审批。用户在界面批准后，请用相同工具与参数再次调用；未批准前该工具会被拒绝。',
          };
        },
      });
    }
    // 计划级授权：模型提交一份「研究计划 + 工具白名单 + 步数/预算」，用户在界面批准后，
    // 计划内工具自动放行。没有这个入口，模型只能逐个调 request_approval，长任务会变成点击地狱。
    if (this.plans) {
      set.request_research_plan = aiTool({
        description:
          '提交一份研究计划请求用户批准。计划内工具（allowedTools，canonical 名如 document.update）在步数/预算内自动放行；计划外仍逐次审批。批准后继续任务。',
        inputSchema: jsonSchema({
          type: 'object',
          properties: {
            title: { type: 'string', description: '计划标题，一句话' },
            summary: { type: 'string', description: '计划摘要：问题/假设/协议/风险/成本' },
            plan: { type: 'object', description: '结构化计划（问题/假设/协议/风险/预计产出）' },
            allowedTools: {
              type: 'array',
              items: { type: 'string' },
              description: '计划内自动放行的工具名（canonical，如 document.update/experiment.run）',
            },
            maxSteps: { type: 'number', description: '计划内最多工具调用步数，默认 12' },
            budgetTokens: { type: 'number', description: '可选 token 预算，0 表示只记步数' },
          },
          required: ['title', 'allowedTools'],
        }),
        execute: async (args: {
          title?: string;
          summary?: string;
          plan?: unknown;
          allowedTools?: string[];
          maxSteps?: number;
          budgetTokens?: number;
        }) => {
          const known = new Set(this.mcp.list().map((t) => t.name));
          const allowed = Array.from(
            new Set(
              (args.allowedTools ?? [])
                .map((n) => this.canonicalToolName(String(n)))
                .filter((n) => known.has(n) && (this.approvals?.needsApproval(n) ?? false)),
            ),
          );
          if (!allowed.length) {
            return {
              error: '计划至少列出一个需要审批的工具（如 document.update/experiment.run/quality.audit）。只读工具不需要计划授权。',
            };
          }
          const plan = this.plans!.create({
            projectId: projectId ?? null,
            runId: runId ?? null,
            title: String(args.title || '研究计划'),
            summary: String(args.summary || ''),
            plan: args.plan ?? {},
            allowedTools: allowed,
            maxSteps: Number(args.maxSteps) || 12,
            budgetTokens: Number(args.budgetTokens) || 0,
          });
          return {
            planId: plan.id,
            status: plan.status,
            allowedTools: plan.allowedTools,
            maxSteps: plan.maxSteps,
            message: '计划已提交。用户在界面批准后，计划内工具会自动放行；批准前这些工具仍会被拒绝。',
          };
        },
      });
      set.get_research_plan = aiTool({
        description: '读取研究计划状态与剩余步数；不传 planId 时返回当前项目最近 5 份计划。',
        inputSchema: jsonSchema({
          type: 'object',
          properties: { planId: { type: 'string', description: '可选：计划 ID' } },
        }),
        execute: async (args: { planId?: string }) => {
          if (args.planId) return this.plans!.get(String(args.planId));
          return { plans: this.plans!.list(projectId ?? null).slice(0, 5) };
        },
      });
    }
    // ── 动态工具面：先检索 schema，再通过 tool_invoke 执行 ──
    // full 模式也会暴露 search（用于让模型发现“有哪些工具”），但工具本身已直接可调。
    set.tool_search = aiTool({
      description:
        '检索当前会话真正可用的工具（名称/说明/入参 schema/是否需要审批）。dynamic 模式下，未直接暴露的工具必须先用本工具查到 schema，再调用 tool_invoke 执行。',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词，例如“实验”“文档”“质量评审”；留空列出前 N 个' },
          limit: { type: 'number', description: '返回上限，默认 8，最大 20' },
        },
      }),
      execute: async (args: { query?: string; limit?: number }) => {
        const q = String(args.query ?? '').trim().toLowerCase();
        const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
        const candidates = this.mcp.list().filter((t) => {
          if (!allow.has(t.name)) return false;
          if (!profileAllowsTool(ctx.profile, t.name)) return false;
          if (this.policy && !this.policy.canUse(t.name)) return false;
          if (!this.allowedBySkills(t.name, ctx.skills)) return false;
          const required = Array.isArray(t.inputSchema?.required) ? (t.inputSchema.required as string[]) : [];
          if (!projectId && required.includes('projectId')) return false;
          return true;
        });
        const scored = candidates.map((t) => {
          const name = t.name.toLowerCase();
          const desc = String(t.description ?? '').toLowerCase();
          const score = !q ? 0 : name === q ? 100 : name.includes(q) ? 60 : desc.includes(q) ? 30 : 0;
          return { t, score };
        });
        const tools = scored
          .filter((x) => (q ? x.score > 0 : true))
          .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
          .slice(0, limit)
          .map(({ t }) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            requiresApproval: this.approvals?.needsApproval(t.name) ?? false,
          }));
        return {
          mode: TOOL_MODE,
          query: q,
          count: tools.length,
          tools,
          hint:
            TOOL_MODE === 'dynamic'
              ? '用 tool_invoke({name, arguments}) 执行；写操作会走计划级/单次审批。'
              : '这些工具已直接暴露，可直接调用；tool_invoke 仅作兜底。',
        };
      },
    });
    set.tool_invoke = aiTool({
      description:
        '按工具名执行一个 MCP 工具。用于 dynamic 模式下调用未直接暴露的工具；参数必须符合 tool_search 返回的 inputSchema。',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          name: { type: 'string', description: '工具名，例如 document.update' },
          arguments: { type: 'object', description: '工具入参对象，严格按 schema 传' },
        },
        required: ['name'],
      }),
      execute: async (args: { name?: string; arguments?: Record<string, unknown> }) => {
        const name = this.canonicalToolName(String(args?.name ?? ''));
        const t = this.mcp.list().find((x) => x.name === name);
        if (!t) return { error: `未知工具：${String(args?.name ?? '')}。请先调用 tool_search 查可用工具。` };
        if (!allow.has(name)) return { error: `工具 ${name} 不在当前允许列表内。` };
        if (args?.arguments && typeof args.arguments !== 'object') {
          return { error: 'arguments 必须是对象；字符串请先解析为 JSON 对象。' };
        }
        return this.runGuarded(t, (args.arguments ?? {}) as Record<string, unknown>, ctx);
      },
    });
    return set;
  }

  /**
   * 统一执行闸：直接暴露的工具与 tool_invoke 共用同一套护栏。
   * 顺序：调用上限 → 权限档 → profile → 技能开关 → 项目作用域 → 重复检测 → 计划/单次审批 → 执行。
   */
  private async runGuarded(t: BridgeTool, args: Record<string, unknown>, ctx: GuardCtx): Promise<unknown> {
    ctx.calls.n += 1;
    if (ctx.calls.n > MAX_TOOL_CALLS) {
      return { error: `工具调用次数已达上限（${MAX_TOOL_CALLS} 次），请直接基于已有信息回答` };
    }
    if (this.policy && !this.policy.canUse(t.name)) {
      return { error: this.policy.denyReason(t.name) };
    }
    if (!profileAllowsTool(ctx.profile, t.name)) {
      return { error: `当前工具档位不允许 ${t.name}；可换只读工具，或让用户切换工具档位。` };
    }
    if (!this.allowedBySkills(t.name, ctx.skills)) {
      return { error: `工具 ${t.name} 已被当前技能开关停用。` };
    }
    const required = Array.isArray(t.inputSchema?.required) ? (t.inputSchema.required as string[]) : [];
    if (!ctx.projectId && required.includes('projectId')) {
      return { error: `工具 ${t.name} 需要项目上下文，但当前会话没有绑定项目。` };
    }
    const schemaProps = (t.inputSchema?.properties ?? {}) as Record<string, unknown>;
    const scoped = ctx.projectId && 'projectId' in schemaProps ? { ...args, projectId: ctx.projectId } : args;
    const key = toolCallKey(t.name, scoped);
    const seen = (ctx.repeat.get(key) ?? 0) + 1;
    ctx.repeat.set(key, seen);
    if (seen > TOOL_REPEAT_LIMIT) {
      return {
        error: `该工具与相同参数已重复调用 ${seen - 1} 次（上限 ${TOOL_REPEAT_LIMIT}），结果不会变化。请换不同参数、改用其他工具，或直接基于已有信息回答`,
      };
    }
    if (this.approvals?.needsApproval(t.name)) {
      const plan = this.plans?.authorize(t.name, ctx.projectId ?? null, ctx.runId ?? null);
      if (!plan) {
        const approved = this.approvals.findApproved({
          toolName: t.name,
          args: scoped,
          projectId: ctx.projectId ?? null,
          runId: ctx.runId ?? null,
        });
        if (!approved) {
          return {
            error: `工具 ${t.name} 需要用户批准后才能执行。请先调用 request_research_plan（计划级授权）或 request_approval（单次授权），等待用户在界面批准后再调用本工具。`,
          };
        }
        this.approvals.consume(approved.id);
      }
    }
    return this.invoke(t.name, scoped, ctx.runId, ctx.user, ctx.projectId);
  }

  /** 模型可能传 "config.snapshot" 或安全名 "config_snapshot"；统一回规范名 */
  private canonicalToolName(name: string): string {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    const tools = this.mcp.list();
    const alias = resolveMcpToolName(raw);
    return tools.find((t) => t.name === alias)?.name ?? tools.find((t) => t.name.replace(/\./g, '_') === raw)?.name ?? alias;
  }

  /** 与执行时一致的项目作用域参数（request_approval 与真正执行必须看到同一份 args） */
  private scopeArgs(toolName: string, args: Record<string, unknown>, projectId?: string): Record<string, unknown> {
    const tool = this.mcp.list().find((t) => t.name === toolName);
    const props = (tool?.inputSchema?.properties ?? {}) as Record<string, unknown>;
    return projectId && 'projectId' in props ? { ...args, projectId } : args;
  }

  /** 执行一次工具调用（带超时、轨迹落库） */
  private async invoke(name: string, args: Record<string, unknown>, runId?: string, user?: AuthPayload, projectId?: string): Promise<unknown> {
    const t0 = Date.now();
    let ok = true;
    let error: string | undefined;
    let result: unknown;
    try {
      // AbortSignal.timeout 自带清理，不会像 setTimeout 那样留下悬挂定时器
      const timeoutMs = TOOL_TIMEOUT_OVERRIDES[name] ?? TOOL_TIMEOUT_MS;
      result = await Promise.race([
        this.mcp.call(name, args, user),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`工具超时（${timeoutMs}ms）`)), timeoutMs);
          timer.unref?.();
        }),
      ]);
      // strict 档：返回值整体脱敏（含密钥/路径字段连回答都不给）
      if (this.policy && shouldRedactForMode(this.policy.mode())) {
        if (result && typeof result === 'object') result = redactSensitive(result);
        else if (typeof result === 'string') result = redactSensitive(result);
      }
      const r = result as { isError?: boolean; content?: { text?: string }[] };
      if (r?.isError) {
        ok = false;
        error = r.content?.[0]?.text?.slice(0, 200) || '工具返回错误';
      }
    } catch (e: any) {
      ok = false;
      error = e?.message || String(e);
      result = { error };
    }
    const durationMs = Date.now() - t0;
    this.recordStep(runId, projectId, { name, args, ok, durationMs, error });
    this.logger.log(`[tool] ${name} ${ok ? 'ok' : 'fail'} ${durationMs}ms`);
    return result;
  }

  /**
   * 工具调用留痕。
   *
   * - 有 runId（流水线图内）：写 agent_step，前端「Agent 执行历史」可见完整工具链；
   * - 无 runId（chat 会话）：写 llm_call_log（kind='tool'），供用量看板统计
   *   （chat 每次对话都是独立请求，不建 agent_execution，避免历史表被会话淹没）。
   */
  private recordStep(runId: string | undefined, projectId: string | undefined, rec: AgentToolCallRecord): void {
    try {
      if (runId && this.trace) {
        this.trace.addStep(runId, {
          kind: 'tool',
          title: `tool:${rec.name}`,
          input: JSON.stringify(rec.args).slice(0, 4000),
          output: typeof rec.error === 'string' ? rec.error : '',
          durationMs: rec.durationMs,
          toolName: rec.name,
          status: rec.ok ? 'ok' : 'error',
          error: rec.error,
        });
        return;
      }
      db.insert(llmCallLogs)
        .values({
          id: randomUUID(),
          caller: `tool:${rec.name}`,
          kind: 'tool',
          projectId: projectId ?? '',
          model: runId ? `run:${runId.slice(0, 8)}` : '',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: rec.durationMs,
          success: rec.ok ? 1 : 0,
          error: rec.error ?? '',
          createdAt: Date.now(),
        })
        .run();
    } catch {
      /* 轨迹写入失败不影响工具结果 */
    }
  }
}
