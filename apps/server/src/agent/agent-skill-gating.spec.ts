import { beforeEach, describe, expect, it } from 'vitest';
import { sqlite } from '../db/database';
import { AgentToolBridge } from './agent-tool-bridge';
import type { McpService } from '../mcp/mcp.service';

/**
 * 技能开关必须真实作用于工具暴露面：
 * - 未配置 skills（默认）→ 全部放行（保持历史行为）
 * - 停用「文献检索」→ literature.* / references.* 工具不再出现在 ToolSet
 * - 配置工具（config.*）不受科研技能开关影响（否则用户关掉技能就无法在对话里改回来）
 */

const tools = [
  { name: 'literature.search', description: 'x', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'references.extract', description: 'x', inputSchema: { type: 'object', properties: { papers: { type: 'string' } }, required: ['papers'] } },
  { name: 'knowledge.query', description: 'x', inputSchema: { type: 'object', properties: { projectId: { type: 'string' }, question: { type: 'string' } }, required: ['projectId', 'question'] } },
  { name: 'writing.polish', description: 'x', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'chat.answer', description: 'x', inputSchema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'config.snapshot', description: 'x', inputSchema: { type: 'object', properties: {} } },
];

function fakeMcp(): McpService {
  return {
    list: () => tools,
    call: async (name: string) => ({ name, content: [{ type: 'text', text: 'ok' }] }),
  } as unknown as McpService;
}

function setSkills(value: string | null) {
  if (value === null) sqlite.prepare("DELETE FROM app_setting WHERE key = 'skills'").run();
  else sqlite.prepare("INSERT INTO app_setting (key, value) VALUES ('skills', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(value);
}

describe('技能开关 → 工具暴露面', () => {
  beforeEach(() => setSkills(null));

  it('未配置技能时全部工具可用（含配置工具）', () => {
    const bridge = new AgentToolBridge(fakeMcp());
    const set = bridge.buildToolSet('p1');
    expect(Object.keys(set).sort()).toEqual(tools.map((t) => t.name.replace(/\./g, '_')).sort());
  });

  it('停用文献检索 → literature/references 工具消失，其余保留', () => {
    setSkills(JSON.stringify([
      { key: 'literature_search', name: '文献检索', enabled: 0 },
      { key: 'knowledge_qa', name: '知识库问答', enabled: 1 },
      { key: 'writing_assist', name: '写作辅助', enabled: 1 },
    ]));
    const bridge = new AgentToolBridge(fakeMcp());
    const keys = Object.keys(bridge.buildToolSet('p1'));
    expect(keys).not.toContain('literature_search');
    expect(keys).not.toContain('references_extract');
    expect(keys).toContain('knowledge_query');
    expect(keys).toContain('writing_polish');
    expect(keys).toContain('config_snapshot');
  });

  it('全部科研技能停用 → 只剩配置工具（对话仍可修复配置）', () => {
    setSkills(JSON.stringify([
      { key: 'literature_search', enabled: 0 },
      { key: 'knowledge_qa', enabled: 0 },
      { key: 'writing_assist', enabled: 0 },
      { key: 'web_research', enabled: 0 },
    ]));
    const bridge = new AgentToolBridge(fakeMcp());
    expect(Object.keys(bridge.buildToolSet('p1'))).toEqual(['config_snapshot']);
  });

  it('畸形 skills JSON 回落全放行（不因脏数据误伤功能）', () => {
    setSkills('{oops');
    const bridge = new AgentToolBridge(fakeMcp());
    expect(Object.keys(bridge.buildToolSet('p1')).length).toBe(tools.length);
  });
});
