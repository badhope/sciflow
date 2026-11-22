import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSpilledToolOutput, spillToolText, previewToolText, toolResultText } from './tool-output-store';
import type { McpService } from '../mcp/mcp.service';
import { AgentToolBridge } from './agent-tool-bridge';

const TOOLS = [
  { name: 'literature.search', description: '检索文献', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'project.list', description: '项目列表', inputSchema: { type: 'object', properties: {} } },
  { name: 'document.update', description: '更新文档', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

function fakeMcp(call: McpService['call']): McpService {
  return { list: () => TOOLS, call } as unknown as McpService;
}

type ExecutableTool = { execute: (args: Record<string, unknown>, options?: { abortSignal?: AbortSignal }) => Promise<unknown> };

let tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sciflow-tool-output-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('tool output store', () => {
  it('保留头尾并回读完整内容', () => {
    vi.stubEnv('SCIFLOW_TOOL_OUTPUT_DIR', tempDir());
    const text = '头'.repeat(100) + '中间内容'.repeat(200) + '尾'.repeat(100);
    const preview = previewToolText(text, 120);
    expect(preview.truncated).toBe(true);
    expect(preview.text.startsWith('头')).toBe(true);
    expect(preview.text.endsWith('尾')).toBe(true);
    expect(preview.text).toContain('中间省略');

    const spilled = spillToolText(text, 120);
    expect(spilled?.originalChars).toBe(text.length);
    expect(spilled?.outputId).toMatch(/^[0-9a-f-]{36}$/);
    const page = readSpilledToolOutput(spilled!.outputId, 0, 200);
    expect('text' in page ? page.text : '').toBe(text.slice(0, 200));
    expect('nextOffset' in page ? page.nextOffset : 0).toBe(200);
  });

  it('拒绝非法/过期 outputId，避免路径穿越', () => {
    const bad = readSpilledToolOutput('../etc/passwd');
    expect('error' in bad ? bad.error : '').toContain('格式不合法');
    const missing = readSpilledToolOutput('00000000-0000-0000-0000-000000000000');
    expect('error' in missing ? missing.error : '').toContain('已过期或不存在');
  });

  it('MCP content.text 优先于 JSON 转义后的结果', () => {
    expect(toolResultText({ name: 'x', content: [{ text: '真实内容' }] })).toBe('真实内容');
    expect(toolResultText({ error: 'bad' })).toBe('{"error":"bad"}');
  });
});

describe('tool harness hardening', () => {
  it('只读工具遇到 503 会自动重试，最终成功', async () => {
    let calls = 0;
    const bridge = new AgentToolBridge(
      fakeMcp(async () => {
        calls += 1;
        return calls === 1
          ? { name: 'literature.search', isError: true, content: [{ text: '503 service unavailable' }] }
          : { name: 'literature.search', content: [{ text: 'ok' }] };
      }),
    );
    const tool = bridge.buildToolSet('p1')['literature_search'] as ExecutableTool;
    const result = await tool.execute({ query: 'graph' });
    expect((result as { content?: { text?: string }[] }).content?.[0]?.text).toBe('ok');
    expect(calls).toBe(2);
  });

  it('写工具不自动重试，避免重复副作用', async () => {
    let calls = 0;
    const bridge = new AgentToolBridge(
      fakeMcp(async () => {
        calls += 1;
        return { name: 'document.update', isError: true, content: [{ text: '503 service unavailable' }] };
      }),
    );
    const tool = bridge.buildToolSet('p1')['document_update'] as ExecutableTool;
    const result = await tool.execute({ id: 'd1' });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(calls).toBe(1);
  });

  it('已取消的 AbortSignal 不触达后端', async () => {
    let calls = 0;
    const bridge = new AgentToolBridge(
      fakeMcp(async () => {
        calls += 1;
        return { name: 'project.list', content: [{ text: 'ok' }] };
      }),
    );
    const ac = new AbortController();
    ac.abort();
    const tool = bridge.buildToolSet('p1')['project_list'] as ExecutableTool;
    const result = await tool.execute({}, { abortSignal: ac.signal });
    expect((result as { error?: string }).error).toContain('取消');
    expect(calls).toBe(0);
  });

  it('成功结果写入 AgentStep output，而不是只留错误', async () => {
    const addStep = vi.fn();
    const bridge = new AgentToolBridge(
      fakeMcp(async () => ({ name: 'literature.search', content: [{ text: '检索结果摘要' }] })),
      { addStep } as never,
    );
    const tool = bridge.buildToolSet('p1', 'run-1')['literature_search'] as ExecutableTool;
    await tool.execute({ query: 'graph' });
    expect(addStep).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ toolName: 'literature.search', status: 'ok', output: '检索结果摘要' }),
    );
  });

  it('超长工具结果被截断并可通过 read_tool_output 回读', async () => {
    vi.stubEnv('SCIFLOW_TOOL_OUTPUT_DIR', tempDir());
    vi.stubEnv('AGENT_TOOL_OUTPUT_MAX_CHARS', '100');
    vi.resetModules();
    const { AgentToolBridge: Bridge } = await import('./agent-tool-bridge');
    const text = '开头'.repeat(80) + '中段'.repeat(400) + '结尾';
    const bridge = new Bridge(fakeMcp(async () => ({ name: 'literature.search', content: [{ text }] })));
    const set = bridge.buildToolSet('p1');
    const tool = set['literature_search'] as ExecutableTool;
    const result = await tool.execute({ query: 'graph' });
    const truncated = result as { truncated?: boolean; outputId?: string; preview?: string };
    expect(truncated.truncated).toBe(true);
    expect(truncated.outputId).toBeTruthy();
    expect(truncated.preview).toContain('中间省略');
    expect(truncated.preview).not.toBe(text);

    const reader = set['read_tool_output'] as ExecutableTool;
    const page = (await reader.execute({ outputId: truncated.outputId, offset: 0, limit: 200 })) as {
      text?: string;
      totalChars?: number;
      eof?: boolean;
    };
    expect(page.text).toBe(text.slice(0, 200));
    expect(page.totalChars).toBe(text.length);
    expect(page.eof).toBe(false);
  });

  it('原生 read_tool_output 也写入轨迹，不只是 MCP 工具', async () => {
    vi.stubEnv('SCIFLOW_TOOL_OUTPUT_DIR', tempDir());
    vi.stubEnv('AGENT_TOOL_OUTPUT_MAX_CHARS', '100');
    vi.resetModules();
    const { AgentToolBridge: Bridge } = await import('./agent-tool-bridge');
    const addStep = vi.fn();
    const text = 'x'.repeat(1_000);
    const bridge = new Bridge(
      fakeMcp(async () => ({ name: 'literature.search', content: [{ text }] })),
      { addStep } as never,
    );
    const set = bridge.buildToolSet('p1', 'run-2');
    const result = (await (set['literature_search'] as ExecutableTool).execute({ query: 'graph' })) as { outputId?: string };
    const page = await (set['read_tool_output'] as ExecutableTool).execute({ outputId: result.outputId, offset: 0, limit: 100 });
    expect(page).toBeTruthy();
    expect(addStep).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({ toolName: 'read_tool_output', status: 'ok', output: expect.any(String) }),
    );
  });

  it('read_tool_output 计入单轮总输出预算，不能绕开上限', async () => {
    vi.stubEnv('SCIFLOW_TOOL_OUTPUT_DIR', tempDir());
    vi.stubEnv('AGENT_TOOL_OUTPUT_MAX_CHARS', '100');
    vi.stubEnv('AGENT_TOOL_OUTPUT_TOTAL_CHARS', '10000');
    vi.resetModules();
    const { AgentToolBridge: Bridge } = await import('./agent-tool-bridge');
    const text = 'x'.repeat(15_000);
    const bridge = new Bridge(fakeMcp(async () => ({ name: 'literature.search', content: [{ text }] })));
    const set = bridge.buildToolSet('p1');
    const result = (await (set['literature_search'] as ExecutableTool).execute({ query: 'graph' })) as {
      outputId?: string;
    };
    const reader = set['read_tool_output'] as ExecutableTool;
    const first = (await reader.execute({ outputId: result.outputId, offset: 0, limit: 9_800 })) as {
      text?: string;
      error?: string;
    };
    expect(first.error).toBeUndefined();
    expect((first.text ?? '').length).toBeGreaterThan(9_000);

    const second = (await reader.execute({ outputId: result.outputId, offset: 9_800, limit: 9_800 })) as {
      error?: string;
      budgetRemaining?: number;
    };
    expect(second.error).toContain('预算');
    expect(second.budgetRemaining).toBeLessThan(500);
  });
});
