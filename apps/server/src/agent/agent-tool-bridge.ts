import { Injectable, Logger } from '@nestjs/common';
import { tool as aiTool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { createHash } from 'node:crypto';
import { McpService } from '../mcp/mcp.service';
import { TaskListService, type TaskInput } from './task-list.service';
import { ApprovalService } from './approval.service';
import { AgentTraceService } from './agent-trace.service';
import { db } from '../db/database';
import { appSettings, llmCallLogs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { envInt } from '../common/env';
import { profileAllowsTool, resolveAgentToolProfile } from './agent-tool-profiles';
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
/** 同一（工具，参数）组合在一次请求内的最大重复次数——超过即拒绝执行并要求模型换路径。
 *  这是 2026 生产事故榜第一名「失控循环」的重复检测护栏：次数上限拦不住
 *  「24 次以内反复调同一个工具刷同一批结果」的空转。 */
const TOOL_REPEAT_LIMIT = envInt('AGENT_TOOL_REPEAT_LIMIT', 3, { min: 2, max: 20 });

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
      (process.env.AGENT_TOOLS_ALLOW || 'literature.search,literature.summarize,knowledge.query,outline.generate,writing.polish,writing.translate,writing.review,references.extract,references.evidence,chat.answer,config.snapshot,config.set_permission,config.upsert_role,config.upsert_constraint,config.delete_constraint,config.upsert_hook,config.apply_preset,config.preview,extension.list,extension.create,extension.toggle,extension.generate')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const profile = resolveAgentToolProfile(opts?.profile);
    let callCount = 0;
    // 重复调用护栏：键 → 已出现次数（每次请求独立闭包，并发会话互不影响）
    const repeatCounts = new Map<string, number>();
    const set: ToolSet = {};
    const skills = this.enabledSkillKeys();
    for (const t of this.mcp.list()) {
      if (!allow.has(t.name)) continue;
      if (!profileAllowsTool(profile, t.name)) continue;
      if (!this.allowedBySkills(t.name, skills)) continue;
      // 无项目上下文时不暴露「必须带 projectId」的工具：避免模型编造 projectId 跨项目取数
      const required = Array.isArray(t.inputSchema?.required) ? (t.inputSchema.required as string[]) : [];
      if (!projectId && required.includes('projectId')) continue;
      // 工具名不能含点号（部分 provider 拒绝），统一转下划线
      const safeName = t.name.replace(/\./g, '_');
      set[safeName] = aiTool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (args: Record<string, unknown>) => {
          callCount += 1;
          if (callCount > MAX_TOOL_CALLS) {
            return { error: `工具调用次数已达上限（${MAX_TOOL_CALLS} 次），请直接基于已有信息回答` };
          }
          // 项目作用域：凡是 schema 里声明了 projectId 的工具，一律用当前会话的项目覆盖
          const schemaProps = (t.inputSchema?.properties ?? {}) as Record<string, unknown>;
          const scoped = projectId && 'projectId' in schemaProps ? { ...args, projectId } : args;
          // 重复检测：同一（工具+参数）出现次数达上限即拒绝，给出可读原因让模型换路径
          const key = toolCallKey(t.name, scoped);
          const seen = (repeatCounts.get(key) ?? 0) + 1;
          repeatCounts.set(key, seen);
          if (seen > TOOL_REPEAT_LIMIT) {
            return {
              error: `该工具与相同参数已重复调用 ${seen - 1} 次（上限 ${TOOL_REPEAT_LIMIT}），结果不会变化。请换不同参数、改用其他工具，或直接基于已有信息回答`,
            };
          }
          // 审批闸：有副作用的工具必须命中一条「已批准且参数一致」的记录才执行。
          // 否则模型只要绕开 request_approval 直接调工具，审批就形同虚设。
          if (this.approvals?.needsApproval(t.name)) {
            const approved = this.approvals.findApproved({
              toolName: t.name,
              args: scoped,
              projectId: projectId ?? null,
              runId: runId ?? null,
            });
            if (!approved) {
              return {
                error: `工具 ${t.name} 需要用户批准后才能执行。请先调用 request_approval（toolName="${t.name}"，args 与此处一致），等待用户在界面批准后再调用本工具。`,
              };
            }
            // 一次批准只执行一次：先消费，失败需重新申请（宁可多问一次，不可复用授权）
            this.approvals.consume(approved.id);
          }
          return this.invoke(t.name, scoped, runId, opts?.user);
        },
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
    return set;
  }

  /** 模型可能传 "config.snapshot" 或安全名 "config_snapshot"；统一回规范名 */
  private canonicalToolName(name: string): string {
    const raw = String(name || '').trim();
    if (!raw) return raw;
    const tools = this.mcp.list();
    return tools.find((t) => t.name === raw)?.name ?? tools.find((t) => t.name.replace(/\./g, '_') === raw)?.name ?? raw;
  }

  /** 与执行时一致的项目作用域参数（request_approval 与真正执行必须看到同一份 args） */
  private scopeArgs(toolName: string, args: Record<string, unknown>, projectId?: string): Record<string, unknown> {
    const tool = this.mcp.list().find((t) => t.name === toolName);
    const props = (tool?.inputSchema?.properties ?? {}) as Record<string, unknown>;
    return projectId && 'projectId' in props ? { ...args, projectId } : args;
  }

  /** 执行一次工具调用（带超时、轨迹落库） */
  private async invoke(name: string, args: Record<string, unknown>, runId?: string, user?: AuthPayload): Promise<unknown> {
    const t0 = Date.now();
    let ok = true;
    let error: string | undefined;
    let result: unknown;
    try {
      // AbortSignal.timeout 自带清理，不会像 setTimeout 那样留下悬挂定时器
      result = await Promise.race([
        this.mcp.call(name, args, user),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`工具超时（${TOOL_TIMEOUT_MS}ms）`)), TOOL_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
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
    this.recordStep(runId, { name, args, ok, durationMs, error });
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
  private recordStep(runId: string | undefined, rec: AgentToolCallRecord): void {
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
