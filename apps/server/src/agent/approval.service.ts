/**
 * 工具审批服务（harness 能力）。
 *
 * 对标 Claude Code / Codex 的权限确认：默认只读工具直接放行；有副作用或高成本的
 * 工具（写库、跑代码、外发请求）在 approvalMode=ask 时挂起，等用户在前端批准。
 *
 * 关键设计：**默认不阻塞**。本地单用户场景下频繁弹窗会把工具链变成点击地狱，
 * 因此策略是「按工具名配置」——只有显式列入 askTools 的才挂起，其余照常执行。
 * 拒绝时返回结构化原因，模型可据此换路径，而不是整轮失败。
 */

import { Injectable, Logger } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { toolApprovals } from '../db/schema';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalView {
  id: string;
  toolName: string;
  args: string;
  reason: string;
  status: ApprovalStatus;
  projectId: string | null;
  runId: string | null;
  createdAt: number;
  decidedAt: number | null;
}

/** 默认需要确认的工具（按前缀匹配）：都是会产生副作用或消耗外部资源的 */
const DEFAULT_ASK_PREFIXES = [
  'experiment.', // 跑本机代码
  'document.', // 改文档正文
  'project.', // 改项目结构
  'config.', // 改全局配置
];

/** 待确认请求的超时：超时视为拒绝，避免模型无限等待 */
const PENDING_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);
  /** 运行期覆盖：设置页可把这些前缀改为放行 */
  private alwaysAllow = new Set<string>();

  /** 该工具是否需要用户批准 */
  needsApproval(toolName: string): boolean {
    if (this.alwaysAllow.has(toolName)) return false;
    return DEFAULT_ASK_PREFIXES.some((prefix) => toolName.startsWith(prefix));
  }

  /** 登记一条待批准请求，返回 id */
  request(input: { toolName: string; args: unknown; reason?: string; projectId?: string | null; runId?: string | null }): ApprovalView {
    const now = Date.now();
    const row = {
      id: randomUUID(),
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      toolName: input.toolName,
      args: JSON.stringify(input.args ?? {}),
      reason: input.reason ?? this.defaultReason(input.toolName),
      status: 'pending' as const,
      createdAt: now,
      decidedAt: null as number | null,
    };
    db.insert(toolApprovals).values(row).run();
    this.logger.log(`[approval] 待确认 ${input.toolName} id=${row.id.slice(0, 8)}`);
    return row;
  }

  private defaultReason(toolName: string): string {
    if (toolName.startsWith('experiment.')) return '将在本机执行代码，请确认来源可信。';
    if (toolName.startsWith('document.')) return '将修改论文正文，此操作会写入版本历史。';
    if (toolName.startsWith('project.')) return '将修改项目结构或配置。';
    if (toolName.startsWith('config.')) return '将修改全局配置，影响后续所有会话。';
    return '该操作会产生副作用，请确认。';
  }

  /** 待处理列表（前端轮询或事件推送） */
  pending(projectId?: string | null): ApprovalView[] {
    this.expireStale();
    const rows = db
      .select()
      .from(toolApprovals)
      .where(eq(toolApprovals.status, 'pending'))
      .orderBy(desc(toolApprovals.createdAt))
      .all();
    return rows
      .filter((r) => !projectId || r.projectId === projectId || r.projectId === null)
      .map((r) => this.toView(r));
  }

  /** 批准 / 拒绝 */
  decide(id: string, approved: boolean): ApprovalView | null {
    db.update(toolApprovals)
      .set({ status: approved ? 'approved' : 'rejected', decidedAt: Date.now() })
      .where(eq(toolApprovals.id, id))
      .run();
    const row = db.select().from(toolApprovals).where(eq(toolApprovals.id, id)).get();
    return row ? this.toView(row) : null;
  }

  /** 查询单条（工具执行前复核状态） */
  get(id: string): ApprovalView | null {
    const row = db.select().from(toolApprovals).where(eq(toolApprovals.id, id)).get();
    return row ? this.toView(row) : null;
  }

  /** 把超时未处理的标记为 expired，避免界面长期挂着过期请求 */
  private expireStale(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    const stale = db
      .select()
      .from(toolApprovals)
      .where(eq(toolApprovals.status, 'pending'))
      .all()
      .filter((r) => r.createdAt < cutoff);
    for (const r of stale) {
      db.update(toolApprovals).set({ status: 'expired', decidedAt: Date.now() }).where(eq(toolApprovals.id, r.id)).run();
    }
  }

  private toView(r: typeof toolApprovals.$inferSelect): ApprovalView {
    return {
      id: r.id,
      toolName: r.toolName,
      args: r.args ?? '{}',
      reason: r.reason ?? '',
      status: (r.status ?? 'pending') as ApprovalStatus,
      projectId: r.projectId ?? null,
      runId: r.runId ?? null,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt ?? null,
    };
  }
}
