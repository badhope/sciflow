import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PlanAuthorizationService } from './plan-authorization.service';
import { db } from '../db/database';
import { agentPlans } from '../db/schema';

/**
 * 计划级授权的行为回归。
 *
 * 价值：计划批准后，计划内工具应自动放行；计划外工具必须回落逐次审批；
 * 步数耗尽/过期必须失效，不能变成永久放行。
 */

const svc = new PlanAuthorizationService();
const PROJECT = 'test-plan-project';

beforeEach(() => {
  db.delete(agentPlans).run();
});

describe('PlanAuthorizationService', () => {
  it('创建时是 pending，批准后进入 approved', () => {
    const plan = svc.create({
      projectId: PROJECT,
      title: '验证假设 H1',
      allowedTools: ['document.update', 'experiment.run'],
      maxSteps: 3,
    });
    expect(plan.status).toBe('pending');
    expect(plan.allowedTools).toEqual(['document.update', 'experiment.run']);

    const approved = svc.decide(plan.id, true);
    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeTruthy();
    expect(approved.expiresAt).toBeGreaterThan(Date.now());
  });

  it('计划内工具放行并消费步数，计划外工具不放行', () => {
    const plan = svc.create({ projectId: PROJECT, title: 'P', allowedTools: ['document.update'], maxSteps: 2 });
    svc.decide(plan.id, true);

    expect(svc.authorize('document.update', PROJECT)?.id).toBe(plan.id);
    expect(svc.authorize('document.update', PROJECT)?.id).toBe(plan.id);
    expect(svc.authorize('document.update', PROJECT)).toBeNull(); // 步数耗尽
    expect(svc.get(plan.id).status).toBe('exhausted');

    const other = svc.create({ projectId: PROJECT, title: 'P2', allowedTools: ['document.update'] });
    svc.decide(other.id, true);
    expect(svc.authorize('experiment.run', PROJECT)).toBeNull();
  });

  it('项目隔离：A 项目的计划不能放行 B 项目', () => {
    const plan = svc.create({ projectId: 'A', title: 'A', allowedTools: ['document.update'] });
    svc.decide(plan.id, true);
    expect(svc.authorize('document.update', 'A')).not.toBeNull();
    expect(svc.authorize('document.update', 'B')).toBeNull();
  });

  it('过期计划不放行，并标记 expired', () => {
    const plan = svc.create({ projectId: PROJECT, title: 'P', allowedTools: ['document.update'] });
    svc.decide(plan.id, true);
    db.update(agentPlans).set({ expiresAt: Date.now() - 1000 }).where(eq(agentPlans.id, plan.id)).run();
    expect(svc.authorize('document.update', PROJECT)).toBeNull();
    expect(svc.get(plan.id).status).toBe('expired');
  });

  it('非法工具名/通配符被过滤', () => {
    const plan = svc.create({
      projectId: PROJECT,
      title: 'P',
      allowedTools: ['document.update', '*', '', '   '],
    });
    expect(plan.allowedTools).toEqual(['document.update']);
  });

  it('token 记账到预算上限后计划失效', () => {
    const plan = svc.create({ projectId: PROJECT, title: 'P', allowedTools: ['document.update'], budgetTokens: 100 });
    svc.decide(plan.id, true);
    svc.recordTokens(plan.id, 60);
    expect(svc.get(plan.id).status).toBe('approved');
    svc.recordTokens(plan.id, 50);
    expect(svc.get(plan.id).status).toBe('exhausted');
  });

  it('按项目记真实 token：chat 收尾 usage 能命中当前生效计划', () => {
    const plan = svc.create({ projectId: PROJECT, title: 'P', allowedTools: ['document.update'], budgetTokens: 100 });
    svc.decide(plan.id, true);
    svc.recordProjectTokens(PROJECT, 60);
    expect(svc.get(plan.id).usedTokens).toBe(60);
    expect(svc.get(plan.id).status).toBe('approved');
    svc.recordProjectTokens(PROJECT, 50);
    expect(svc.get(plan.id).usedTokens).toBe(110);
    expect(svc.get(plan.id).status).toBe('exhausted');

    // 没有生效计划的项目不串账
    expect(svc.get(plan.id).usedTokens).toBe(110);
    svc.recordProjectTokens('other-project', 30);
    expect(svc.get(plan.id).usedTokens).toBe(110);
  });
});
