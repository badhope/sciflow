import { describe, expect, it } from 'vitest';
import { McpService, resolveMcpToolName } from './mcp.service';

/** 研究角色工具必须可被 MCP 客户端发现；handler 里的 AI 调用由 critic/expert 各自 spec 覆盖。 */
describe('MCP research role tools', () => {
  const svc = new (McpService as any)(...Array.from({ length: 12 }, () => ({}))) as McpService;
  const tools = svc.list();
  const byName = new Map(tools.map((t) => [t.name, t]));

  it('exposes research.critic / research.expert', () => {
    expect(byName.has('research.plan')).toBe(true);
    expect(byName.has('research.experiment')).toBe(true);
    expect(byName.has('research.critic')).toBe(true);
    expect(byName.has('research.expert')).toBe(true);
  });

  it('exposes standalone novelty check for the pre-project stage', () => {
    expect(byName.has('research.novelty')).toBe(true);
    expect(byName.get('research.novelty')!.inputSchema.required).toEqual(['projectId', 'topic']);
  });

  it('exposes deterministic research plan audit', () => {
    expect(byName.has('research.plan_audit')).toBe(true);
    expect(byName.get('research.plan_audit')!.inputSchema.required).toEqual(['content']);
    expect(byName.get('research.plan_audit')!.description).toContain('确定性');
  });

  it('exposes key-free public literature discovery without writing the local library', () => {
    expect(byName.has('literature.discover')).toBe(true);
    expect(byName.get('literature.discover')!.inputSchema.required).toEqual(['query']);
    expect(byName.get('literature.discover')!.description).toContain('OpenAlex');
  });

  it('exposes submission readiness with project + document inputs', () => {
    expect(byName.has('submission.readiness')).toBe(true);
    expect(byName.get('submission.readiness')!.inputSchema.required).toEqual(['projectId', 'documentId']);
  });

  it('exposes quality.history instead of leaving a profile-only phantom', () => {
    expect(byName.has('quality.history')).toBe(true);
    expect(byName.get('quality.history')!.inputSchema.required).toEqual(['documentId']);
  });

  it('exposes the approval-gated document snapshot tool', () => {
    expect(byName.has('document.snapshot')).toBe(true);
    expect(byName.get('document.snapshot')!.inputSchema.required).toEqual(['documentId']);
  });

  it('exposes section revision with the inputs the reviewer flow needs', () => {
    expect(byName.has('document.revise_section')).toBe(true);
    expect(byName.get('document.revise_section')!.inputSchema.required).toEqual(['documentId', 'title', 'reviewPoints']);
  });

  it('exposes external MCP discovery and call as tools', () => {
    expect(byName.has('mcp.external.list')).toBe(true);
    expect(byName.get('mcp.external.discover')!.inputSchema.required).toEqual(['url']);
    expect(byName.get('mcp.external.call')!.inputSchema.required).toEqual(['serverId', 'tool']);
  });

  it('exposes the project research brief as a read + approval-gated write pair', () => {
    expect(byName.has('research.brief.get')).toBe(true);
    expect(byName.get('research.brief.get')!.inputSchema.required).toEqual(['projectId']);
    expect(byName.has('research.brief.update')).toBe(true);
    expect(byName.get('research.brief.update')!.inputSchema.required).toEqual(['projectId']);
  });


  it('document.update 写入研究计划时自动附带确定性审计', async () => {
    const documents = {
      update: async (id: string, patch: { content?: string }) => ({
        id,
        title: id === 'doc-plan' ? '研究计划验收' : '普通论文草稿',
        content: patch.content || '',
      }),
    };
    const args: unknown[] = Array.from({ length: 18 }, () => ({}));
    args[7] = documents;
    const svcWithDocuments = new (McpService as any)(...args) as McpService;
    const bad = '# 研究计划\n## 研究问题\nRQ1：组织 HR 实践是否影响员工投入？\n## 样本\nT1 目标 140 人，流失 25%；配对样本 ≥200。\n## 时间表\nW7–W8 收 T1；W9 收 T2（间隔 4 周）。\n## 理论缺口\n需系统检索核实。';
    const r = await svcWithDocuments.call('document.update', { id: 'doc-plan', content: bad });
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.planAudit.ok).toBe(false);
    expect(parsed.planAudit.blockers).toBeGreaterThan(0);
    expect(parsed.planAudit.message).toContain('必须先按 findings 修复');

    const normal = '研究设计：采用问卷法，样本 300 人，时间表 12 周；本文报告实验结果。';
    const r2 = await svcWithDocuments.call('document.update', { id: 'doc-normal', content: normal });
    expect(JSON.parse(r2.content[0].text).planAudit).toBeUndefined();
  });

  it('resolves legacy tool names to canonical names', () => {
    expect(resolveMcpToolName('reference.search')).toBe('literature.search');
    expect(resolveMcpToolName('reference.discover')).toBe('literature.discover');
    expect(resolveMcpToolName('config.inspect')).toBe('config.snapshot');
    expect(resolveMcpToolName('document.write')).toBe('document.update');
    expect(resolveMcpToolName('document.get')).toBe('document.get');
  });

  it('requires the inputs the role prompts depend on', () => {
    expect(byName.get('research.plan')!.inputSchema.required).toEqual(['question']);
    expect(byName.get('research.experiment')!.inputSchema.required).toEqual(['hypothesisStatement', 'design']);
    expect(byName.get('research.critic')!.inputSchema.required).toEqual(['hypothesisStatement', 'runOutput']);
    expect(byName.get('research.expert')!.inputSchema.required).toEqual(['question', 'hypothesisStatement', 'design']);
  });
});
