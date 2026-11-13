import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { projects, toolApprovals } from '../db/schema';
import { ApprovalService } from './approval.service';

/**
 * 审批闸回归：批准记录必须能被「执行侧」按工具+参数命中并消费。
 *
 * 历史缺陷：request_approval 只写一行 pending/approved，执行侧从不检查，
 * 导致模型绕过 request_approval 直接调工具也能执行 —— 审批只是界面装饰。
 */
describe('审批闸：批准记录必须被消费', () => {
  let svc: ApprovalService;
  let projectId: string;

  beforeEach(() => {
    projectId = randomUUID();
    const now = Date.now();
    db.insert(projects).values({ id: projectId, name: '审批测试', description: '', createdAt: now, updatedAt: now }).run();
    svc = new ApprovalService();
    db.delete(toolApprovals).where(eq(toolApprovals.projectId, projectId)).run();
  });

  it('未批准时找不到匹配记录', () => {
    svc.request({ toolName: 'config.upsert_role', args: { name: 'X' }, projectId });
    expect(svc.findApproved({ toolName: 'config.upsert_role', args: { name: 'X' }, projectId })).toBeNull();
  });

  it('批准后按参数匹配命中；参数不同则不命中', () => {
    const rec = svc.request({ toolName: 'config.upsert_role', args: { name: 'X', prompt: 'p' }, projectId });
    svc.decide(rec.id, true);
    expect(svc.findApproved({ toolName: 'config.upsert_role', args: { prompt: 'p', name: 'X' }, projectId })?.id).toBe(rec.id);
    expect(svc.findApproved({ toolName: 'config.upsert_role', args: { name: 'Y', prompt: 'p' }, projectId })).toBeNull();
    // 工具名不同也不命中
    expect(svc.findApproved({ toolName: 'config.delete_constraint', args: { name: 'X', prompt: 'p' }, projectId })).toBeNull();
  });

  it('项目不同不命中（防止 A 项目的批准被 B 项目复用）', () => {
    const rec = svc.request({ toolName: 'config.upsert_role', args: { a: 1 }, projectId });
    svc.decide(rec.id, true);
    expect(svc.findApproved({ toolName: 'config.upsert_role', args: { a: 1 }, projectId: randomUUID() })).toBeNull();
  });

  it('消费后不可再次命中（一次批准只执行一次）', () => {
    const rec = svc.request({ toolName: 'config.upsert_role', args: { a: 1 }, projectId });
    svc.decide(rec.id, true);
    const hit = svc.findApproved({ toolName: 'config.upsert_role', args: { a: 1 }, projectId });
    expect(hit?.id).toBe(rec.id);
    svc.consume(rec.id);
    expect(svc.findApproved({ toolName: 'config.upsert_role', args: { a: 1 }, projectId })).toBeNull();
  });

  it('只读工具不要求审批，写工具要求审批', () => {
    expect(svc.needsApproval('config.snapshot')).toBe(false);
    expect(svc.needsApproval('config.preview')).toBe(false);
    expect(svc.needsApproval('extension.list')).toBe(false);
    expect(svc.needsApproval('config.upsert_role')).toBe(true);
    expect(svc.needsApproval('extension.generate')).toBe(true);
    expect(svc.needsApproval('literature.search')).toBe(false);
  });

  it('拒绝的请求永远不命中', () => {
    const rec = svc.request({ toolName: 'config.upsert_role', args: { a: 1 }, projectId });
    svc.decide(rec.id, false);
    expect(svc.findApproved({ toolName: 'config.upsert_role', args: { a: 1 }, projectId })).toBeNull();
  });
});
