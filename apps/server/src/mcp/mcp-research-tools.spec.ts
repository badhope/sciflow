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

  it('resolves legacy tool names to canonical names', () => {
    expect(resolveMcpToolName('reference.search')).toBe('literature.search');
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
