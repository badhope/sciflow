import { beforeEach, describe, expect, it } from 'vitest';
import { ApprovalService } from './approval.service';
import { db } from '../db/database';
import { toolApprovals } from '../db/schema';

/**
 * 工具审批的行为回归。
 *
 * 存在的理由：有副作用的工具不能静默执行，但本地单用户场景下频繁弹窗会把
 * 工具链变成点击地狱。所以策略必须是"按工具白名单"，而不是"全部询问"。
 */

const svc = new ApprovalService();

beforeEach(() => {
  db.delete(toolApprovals).run();
});

describe('ApprovalService', () => {
  it('只读工具不触发审批', () => {
    expect(svc.needsApproval('literature.search')).toBe(false);
    expect(svc.needsApproval('knowledge.query')).toBe(false);
    expect(svc.needsApproval('references.list')).toBe(false);
  });

  it('有副作用的工具需要审批', () => {
    expect(svc.needsApproval('experiment.run')).toBe(true);
    expect(svc.needsApproval('document.update')).toBe(true);
    expect(svc.needsApproval('project.delete')).toBe(true);
    expect(svc.needsApproval('config.write')).toBe(true);
  });

  it('登记后出现在待处理列表', () => {
    const a = svc.request({ toolName: 'experiment.run', args: { code: 'print(1)' }, projectId: 'p1' });
    expect(a.status).toBe('pending');
    const pending = svc.pending('p1');
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe('experiment.run');
  });

  it('批准后状态变更且不再出现在待处理列表', () => {
    const a = svc.request({ toolName: 'document.update', args: {}, projectId: 'p1' });
    const decided = svc.decide(a.id, true);
    expect(decided?.status).toBe('approved');
    expect(svc.pending('p1')).toHaveLength(0);
  });

  it('拒绝保留可读原因，模型可据此换路径', () => {
    const a = svc.request({ toolName: 'experiment.run', args: {}, projectId: 'p1' });
    const decided = svc.decide(a.id, false);
    expect(decided?.status).toBe('rejected');
    expect(decided?.reason).toBeTruthy();
  });

  it('待处理列表按项目隔离', () => {
    svc.request({ toolName: 'experiment.run', args: {}, projectId: 'p1' });
    svc.request({ toolName: 'experiment.run', args: {}, projectId: 'p2' });
    expect(svc.pending('p1')).toHaveLength(1);
    expect(svc.pending('p2')).toHaveLength(1);
  });
});
