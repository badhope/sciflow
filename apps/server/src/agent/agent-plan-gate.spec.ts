import { beforeEach, describe, expect, it } from 'vitest';
import { AgentToolBridge } from './agent-tool-bridge';
import { ApprovalService } from './approval.service';
import { PlanAuthorizationService } from './plan-authorization.service';
import { db } from '../db/database';
import { agentPlans, toolApprovals } from '../db/schema';
import type { McpService } from '../mcp/mcp.service';

/**
 * 计划级授权闸门的回归：
 *  - 没有计划时，document.update 必须被拒绝（要求单次审批）；
 *  - 有计划且已批准、工具在白名单内时，document.update 直接执行，不再要求审批；
 *  - 计划外工具仍被拒绝。
 */

const tools = [
  {
    name: 'document.update',
    description: 'x',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id'] },
  },
];

function fakeMcp(calls: { name: string; args: unknown }[]): McpService {
  return {
    list: () => tools,
    call: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  } as unknown as McpService;
}

const approvals = new ApprovalService();
const plans = new PlanAuthorizationService();
const PROJECT = 'test-plan-gate';

beforeEach(() => {
  db.delete(agentPlans).run();
  db.delete(toolApprovals).run();
});

type ExecutableTool = { execute: (args: Record<string, unknown>) => Promise<unknown> };

describe('AgentToolBridge 计划级授权', () => {
  it('无计划时拒绝执行，并提示申请计划/单次审批', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls), undefined, undefined, approvals, plans);
    const tool = bridge.buildToolSet(PROJECT)['document_update'] as ExecutableTool;
    const r = (await tool.execute({ id: 'd1', content: 'x' })) as { error?: string };
    expect(r.error).toContain('需要用户批准');
    expect(r.error).toContain('request_research_plan');
    expect(calls).toHaveLength(0);
  });

  it('已批准计划内工具直接执行，不要求单次审批', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls), undefined, undefined, approvals, plans);
    const plan = plans.create({ projectId: PROJECT, title: 'P', allowedTools: ['document.update'] });
    plans.decide(plan.id, true);
    const tool = bridge.buildToolSet(PROJECT)['document_update'] as ExecutableTool;
    const r = (await tool.execute({ id: 'd1', content: 'x' })) as { content?: { text?: string }[] };
    expect(r.content?.[0]?.text).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('document.update');
  });

  it('计划外工具仍被拒绝', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls), undefined, undefined, approvals, plans);
    const plan = plans.create({ projectId: PROJECT, title: 'P', allowedTools: ['experiment.run'] });
    plans.decide(plan.id, true);
    const tool = bridge.buildToolSet(PROJECT)['document_update'] as ExecutableTool;
    const r = (await tool.execute({ id: 'd1', content: 'x' })) as { error?: string };
    expect(r.error).toContain('需要用户批准');
    expect(calls).toHaveLength(0);
  });

  it('tool_search 能发现工具；tool_invoke 复用同一套计划闸门', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls), undefined, undefined, approvals, plans);
    const set = bridge.buildToolSet(PROJECT);
    const search = set['tool_search'] as ExecutableTool;
    const found = (await search.execute({ query: 'document' })) as { tools: { name: string; requiresApproval: boolean }[] };
    expect(found.tools.map((t) => t.name)).toContain('document.update');
    expect(found.tools.find((t) => t.name === 'document.update')?.requiresApproval).toBe(true);

    const invoke = set['tool_invoke'] as ExecutableTool;
    const denied = (await invoke.execute({ name: 'document.update', arguments: { id: 'd1', content: 'x' } })) as { error?: string };
    expect(denied.error).toContain('需要用户批准');

    const plan = plans.create({ projectId: PROJECT, title: 'P', allowedTools: ['document.update'] });
    plans.decide(plan.id, true);
    const ok = (await invoke.execute({ name: 'document.update', arguments: { id: 'd1', content: 'x' } })) as { content?: { text?: string }[] };
    expect(ok.content?.[0]?.text).toBe('ok');
    expect(calls).toHaveLength(1);
  });
});
