import { Injectable, Logger } from '@nestjs/common';
import { tool as aiTool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';
import { McpService } from '../mcp/mcp.service';
import { AgentTraceService } from './agent-trace.service';
import { db } from '../db/database';
import { appSettings, llmCallLogs } from '../db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { envInt } from '../../../../packages/core/src/env';

/**
 * Agent 工具桥：把 SciFlow 的 11 个 MCP 工具暴露给模型，形成真正的 tool-calling 链路。
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

const MAX_TOOL_CALLS = envInt('AGENT_MAX_TOOL_CALLS', 8, { min: 1, max: 50 });
const TOOL_TIMEOUT_MS = envInt('AGENT_TOOL_TIMEOUT_MS', 20_000, { min: 1_000, max: 300_000 });

@Injectable()
export class AgentToolBridge {
  private readonly logger = new Logger(AgentToolBridge.name);

  constructor(
    private readonly mcp: McpService,
    private readonly trace?: AgentTraceService,
  ) {}

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
   *  - **超时可控**：每次调用独立超时，结束后清理定时器。
   */
  buildToolSet(projectId?: string, runId?: string): ToolSet {
    const allow = new Set(
      (process.env.AGENT_TOOLS_ALLOW || 'literature.search,literature.summarize,knowledge.query,outline.generate,writing.polish,writing.translate,writing.review,references.extract,references.evidence,chat.answer')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    let callCount = 0;
    const set: ToolSet = {};
    for (const t of this.mcp.list()) {
      if (!allow.has(t.name)) continue;
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
          return this.invoke(t.name, scoped, runId);
        },
      });
    }
    return set;
  }

  /** 执行一次工具调用（带超时、轨迹落库） */
  private async invoke(name: string, args: Record<string, unknown>, runId?: string): Promise<unknown> {
    const t0 = Date.now();
    let ok = true;
    let error: string | undefined;
    let result: unknown;
    try {
      // AbortSignal.timeout 自带清理，不会像 setTimeout 那样留下悬挂定时器
      result = await Promise.race([
        this.mcp.call(name, args),
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
