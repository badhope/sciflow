import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpService } from '../mcp/mcp.service';

/**
 * dynamic 工具面回归：默认 full 不变；显式 AGENT_TOOL_MODE=dynamic 时只直出核心工具，
 * 其余工具靠 tool_search 发现、tool_invoke 执行，避免每一步都携带 42 份 schema。
 */

const tools = [
  { name: 'literature.search', description: '检索文献', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'document.get', description: '读文档', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'document.update', description: '写文档', inputSchema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' } }, required: ['id'] } },
];

function fakeMcp(): McpService {
  return {
    list: () => tools,
    call: async (name: string) => ({ name, content: [{ type: 'text', text: 'ok' }] }),
  } as unknown as McpService;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('AGENT_TOOL_MODE=dynamic', () => {
  it('只直出核心工具，写工具需经 tool_search/tool_invoke', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_TOOL_MODE', 'dynamic');
    const { AgentToolBridge } = await import('./agent-tool-bridge');
    const set = new AgentToolBridge(fakeMcp()).buildToolSet('p1');
    const keys = Object.keys(set);
    expect(keys).toContain('literature_search');
    expect(keys).toContain('document_get');
    expect(keys).not.toContain('document_update');
    expect(keys).toContain('tool_search');
    expect(keys).toContain('tool_invoke');

    const search = set['tool_search'] as { execute: (a: Record<string, unknown>) => Promise<unknown> };
    const found = (await search.execute({ query: 'document.update' })) as { tools: { name: string }[] };
    expect(found.tools.map((t) => t.name)).toContain('document.update');
  // 全量并发/冷缓存下，动态工具集导入与 DB 初始化可能接近 30s；给测试留出 CI 余量。
  }, 60_000);
});
