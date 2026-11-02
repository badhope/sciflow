/**
 * Agent 任务清单服务（harness 能力）。
 *
 * 对标 OpenCode / Codex / Qoder 的 todo 工具：模型在多步任务里先列清单，
 * 再逐项推进，用户能在界面上实时看到「做到哪一步」。价值有三：
 *  1. 长任务不迷路：模型自己回头核对清单，减少漏做；
 *  2. 用户可核：进度不是黑盒，能看出卡在哪一项；
 *  3. 中断可续：清单落库，服务重启后仍能接着做。
 *
 * 设计取舍：整份清单替换（replaceAll）而非逐条增删，因为模型一次给出的
 * 清单往往整体重排；逐条操作会让界面在中间态闪烁，也会产生大量无意义记录。
 */

import { Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { agentTasks } from '../db/schema';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface TaskInput {
  content: string;
  status?: TaskStatus;
  priority?: TaskPriority;
}

export interface TaskView {
  id: string;
  content: string;
  status: TaskStatus;
  priority: TaskPriority;
  seq: number;
  group: string;
  createdAt: number;
  updatedAt: number;
}

const VALID_STATUS: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const VALID_PRIORITY: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

/** 单个清单的条目上限：防止模型输出失控把界面塞满 */
const MAX_TASKS = 50;
/** 清单内容长度上限（字符） */
const MAX_CONTENT_LEN = 300;

function normalizeStatus(raw: unknown): TaskStatus {
  const s = String(raw ?? 'pending');
  return (VALID_STATUS.has(s) ? s : 'pending') as TaskStatus;
}

function normalizePriority(raw: unknown): TaskPriority {
  const p = String(raw ?? 'medium');
  return (VALID_PRIORITY.has(p) ? p : 'medium') as TaskPriority;
}

function normalizeContent(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return text.length > MAX_CONTENT_LEN ? `${text.slice(0, MAX_CONTENT_LEN)}…` : text;
}

@Injectable()
export class TaskListService {
  /** 读取清单（按 seq 升序） */
  list(projectId?: string | null, runId?: string | null): TaskView[] {
    const conds: SQL[] = [];
    if (projectId) conds.push(eq(agentTasks.projectId, projectId));
    if (runId) conds.push(eq(agentTasks.runId, runId));
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
    const rows = where
      ? db.select().from(agentTasks).where(where).orderBy(asc(agentTasks.seq)).all()
      : db.select().from(agentTasks).orderBy(asc(agentTasks.seq)).all();
    return rows.map((r) => ({
      id: r.id,
      content: r.content,
      status: normalizeStatus(r.status),
      priority: normalizePriority(r.priority),
      seq: r.seq ?? 0,
      group: r.group ?? 'default',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * 用给定清单整体替换当前清单。
   * 保留既有 id（按 content 匹配），使前端能沿用动画状态而不是整块重绘。
   */
  replaceAll(tasks: TaskInput[], projectId?: string | null, runId?: string | null, group = 'default'): TaskView[] {
    const now = Date.now();
    const existing = this.list(projectId, runId);
    const byContent = new Map(existing.map((t) => [t.content, t]));

    const rows = tasks
      .slice(0, MAX_TASKS)
      .map((t, i) => {
        const content = normalizeContent(t.content);
        const prev = byContent.get(content);
        return {
          id: prev?.id ?? randomUUID(),
          projectId: projectId ?? null,
          runId: runId ?? null,
          group,
          content,
          status: normalizeStatus(t.status),
          priority: normalizePriority(t.priority),
          seq: i,
          createdAt: prev?.createdAt ?? now,
          updatedAt: now,
        };
      })
      .filter((r) => r.content.length > 0);

    // 同一 scope 下整份替换：先清后写，避免残留已删除条目
    const conds: SQL[] = [];
    if (projectId) conds.push(eq(agentTasks.projectId, projectId));
    if (runId) conds.push(eq(agentTasks.runId, runId));
    if (conds.length === 0) {
      // 无 scope 时只清理无归属的清单，避免误删项目清单
      db.delete(agentTasks).where(eq(agentTasks.projectId, null as never)).run();
    } else {
      db.delete(agentTasks).where(conds.length === 1 ? conds[0] : and(...conds)).run();
    }
    if (rows.length) db.insert(agentTasks).values(rows).run();
    return this.list(projectId, runId);
  }

  /** 只改状态，不动清单结构（模型推进单项时用） */
  setStatus(id: string, status: TaskStatus): TaskView | null {
    db.update(agentTasks).set({ status: normalizeStatus(status), updatedAt: Date.now() }).where(eq(agentTasks.id, id)).run();
    const row = db.select().from(agentTasks).where(eq(agentTasks.id, id)).get();
    if (!row) return null;
    return {
      id: row.id,
      content: row.content,
      status: normalizeStatus(row.status),
      priority: normalizePriority(row.priority),
      seq: row.seq ?? 0,
      group: row.group ?? 'default',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 进度摘要（供前端与流水线状态卡展示） */
  summary(projectId?: string | null, runId?: string | null): {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    percent: number;
  } {
    const tasks = this.list(projectId, runId);
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const counted = completed + inProgress + pending;
    return {
      total: counted,
      completed,
      inProgress,
      pending,
      percent: counted === 0 ? 0 : Math.round((completed / counted) * 100),
    };
  }

  /** 清空清单 */
  clear(projectId?: string | null, runId?: string | null): void {
    const conds: SQL[] = [];
    if (projectId) conds.push(eq(agentTasks.projectId, projectId));
    if (runId) conds.push(eq(agentTasks.runId, runId));
    if (conds.length === 0) return;
    db.delete(agentTasks).where(conds.length === 1 ? conds[0] : and(...conds)).run();
  }
}
