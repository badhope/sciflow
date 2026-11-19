import { describe, expect, it } from 'vitest';
import { McpService } from './mcp.service';

/** 研究角色工具必须可被 MCP 客户端发现；handler 里的 AI 调用由 critic/expert 各自 spec 覆盖。 */
describe('MCP research role tools', () => {
  const svc = new (McpService as any)(...Array.from({ length: 12 }, () => ({}))) as McpService;
  const tools = svc.list();
  const byName = new Map(tools.map((t) => [t.name, t]));

  it('exposes research.critic / research.expert', () => {
    expect(byName.has('research.critic')).toBe(true);
    expect(byName.has('research.expert')).toBe(true);
  });

  it('requires the inputs the role prompts depend on', () => {
    expect(byName.get('research.critic')!.inputSchema.required).toEqual(['hypothesisStatement', 'runOutput']);
    expect(byName.get('research.expert')!.inputSchema.required).toEqual(['question', 'hypothesisStatement', 'design']);
  });
});
