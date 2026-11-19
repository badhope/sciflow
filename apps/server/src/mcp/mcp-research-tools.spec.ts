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
