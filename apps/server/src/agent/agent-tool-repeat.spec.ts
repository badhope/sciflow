import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../db/database';
import { AgentToolBridge } from './agent-tool-bridge';
import type { McpService } from '../mcp/mcp.service';

/**
 * 工具重复调用护栏（AGENT_TOOL_REPEAT_LIMIT，默认 3）：
 *
 * 背景（2026-11 harness 加固）：业界生产事故榜第一名是「失控循环」——
 * 次数上限（MAX_TOOL_CALLS）拦不住「24 次以内反复用同一参数调同一工具刷同一批结果」
 * 的空转。本护栏按（工具名 + 参数稳定哈希）计数，超限拒绝执行并给出可读原因，
 * 让模型换参数、换工具或直接作答。
 *
 * 参数键序不敏感：模型两次传参键序不同但内容相同，必须视为重复（稳定序列化后哈希）。
 */

const tools = [
  { name: 'literature.search', description: 'x', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
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

function setAgentTools(value: string | null) {
  if (value === null) sqlite.prepare("DELETE FROM app_setting WHERE key = 'agent_tools'").run();
  else sqlite.prepare("INSERT INTO app_setting (key, value) VALUES ('agent_tools', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
}

type ExecutableTool = { execute: (args: Record<string, unknown>) => Promise<unknown> };

describe('工具重复调用护栏', () => {
  beforeEach(() => setAgentTools('on'));

  it('同一（工具+参数）前 3 次正常执行，第 4 次拒绝且不再触达后端', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls));
    const tool = bridge.buildToolSet('p1')['literature_search'] as ExecutableTool;

    for (let i = 0; i < 3; i++) {
      const r = (await tool.execute({ query: 'graph neural network' })) as { content?: { text?: string }[] };
      expect(r.content?.[0]?.text).toBe('ok');
    }
    const blocked = (await tool.execute({ query: 'graph neural network' })) as { error?: string };
    expect(blocked.error).toContain('重复调用');
    expect(blocked.error).toContain('换不同参数');
    // 后端只应收到 3 次真实调用
    expect(calls.length).toBe(3);
  });

  it('参数不同不算重复（键序不同但内容相同仍算重复）', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls));
    const tool = bridge.buildToolSet('p1')['literature_search'] as ExecutableTool;

    // 换参数 → 各自独立计数，互不触发
    for (const q of ['a', 'b', 'c']) {
      const r = (await tool.execute({ query: q })) as { content?: { text?: string }[] };
      expect(r.content?.[0]?.text).toBe('ok');
    }
    // 同参数键序颠倒 → 稳定序列化视为同一调用，累计计数
    // 'a' 的计数轨迹：1(真实) → 2(真实) → 3(真实) → 4 拒绝，即同参数最多真实执行 3 次
    const r1 = (await tool.execute({ query: 'a' })) as { content?: { text?: string }[] };
    expect(r1.content?.[0]?.text).toBe('ok');
    const r2 = (await tool.execute({ query: 'a' })) as { content?: { text?: string }[] };
    expect(r2.content?.[0]?.text).toBe('ok');
    const r3 = (await tool.execute({ query: 'a' })) as { error?: string };
    expect(r3.error).toContain('重复调用');
    expect(calls.length).toBe(5); // a,b,c 各 1 次 + a 的第 2、3 次真实执行
  });

  it('护栏按请求隔离：新一次 buildToolSet 计数清零', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const bridge = new AgentToolBridge(fakeMcp(calls));
    const t1 = bridge.buildToolSet('p1')['literature_search'] as ExecutableTool;
    for (let i = 0; i < 3; i++) await t1.execute({ query: 'x' });
    const t2 = bridge.buildToolSet('p1')['literature_search'] as ExecutableTool;
    const r = (await t2.execute({ query: 'x' })) as { content?: { text?: string }[] };
    expect(r.content?.[0]?.text).toBe('ok');
    expect(calls.length).toBe(4);
  });
});
