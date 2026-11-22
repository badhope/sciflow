import { describe, expect, it, vi, beforeEach } from 'vitest';
import { streamChat } from './core';

/**
 * streamChat（SSE 解析）行为测试。
 *
 * 此前完全没有测试：WorkspacePage.test 把 streamChat 整个 mock 掉，
 * 真实的 SSE 分片/坏行/[DONE]/error 事件语义零覆盖。这里用 ReadableStream
 * 构造服务端字节流，直接驱动真实解析器。
 */

function sseResponse(chunks: string[], init: ResponseInit = { status: 200 }) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' }, ...init });
}

function run() {
  const onDelta = vi.fn<(t: string) => void>();
  const onReasoning = vi.fn<(t: string) => void>();
  const onSources = vi.fn();
  const onUsage = vi.fn();
  const onDone = vi.fn<(t: string) => void>();
  const onError = vi.fn<(m: string) => void>();
  const onToolCall = vi.fn();
  const onToolResult = vi.fn();
  streamChat({ message: 'hi', onDelta, onReasoning, onSources, onUsage, onToolCall, onToolResult, onDone, onError });
  return { onDelta, onReasoning, onSources, onUsage, onToolCall, onToolResult, onDone, onError };
}

describe('streamChat SSE 解析', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('累积语义：每个 delta 都是增量，onDelta 收到的是累积全文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"delta":"科研"}\n\n',
      'data: {"delta":"论文"}\n\n',
      'data: [DONE]\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onDone).toHaveBeenCalledTimes(1));
    expect(spies.onDelta.mock.calls.map((c) => c[0])).toEqual(['科研', '科研论文']);
    expect(spies.onDone).toHaveBeenCalledWith('科研论文');
  });

  it('分片跨 chunk 边界（一行被拆成两个字节块）仍能正确解析', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"del',
      'ta":"跨块"}\n\ndata: [DONE]\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onDone).toHaveBeenCalledTimes(1));
    expect(spies.onDone).toHaveBeenCalledWith('跨块');
  });

  it('坏行（非 JSON）被跳过，不中断后续正文', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: not-json\n\n',
      'data: {"delta":"still-alive"}\n\n',
      'data: [DONE]\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onDone).toHaveBeenCalledTimes(1));
    expect(spies.onDone).toHaveBeenCalledWith('still-alive');
    expect(spies.onError).not.toHaveBeenCalled();
  });

  it('服务端 error 事件：上报错误并以当前全文收尾（不丢已生成内容）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"delta":"部分内容"}\n\n',
      'data: {"error":"上游模型超时"}\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onError).toHaveBeenCalled());
    expect(spies.onError).toHaveBeenCalledWith('上游模型超时');
    expect(spies.onDone).toHaveBeenCalledWith('部分内容');
  });

  it('sources / usage / reasoning 事件分派到对应回调', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"sources":[{"docName":"笔记","score":0.9}]}\n\n',
      'data: {"delta":"答","reasoning":"想"}\n\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onDone).toHaveBeenCalled());
    expect(spies.onSources).toHaveBeenCalledWith([{ docName: '笔记', score: 0.9 }]);
    expect(spies.onReasoning).toHaveBeenCalledWith('想');
    expect(spies.onUsage).toHaveBeenCalledWith({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it('工具调用与工具结果分开下发，并保留 id、耗时和截断字符数', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"tool_calls":[{"id":"call-1","function":{"name":"project.list","arguments":"{\\"projectId\\":\\"p1\\"}"}}]}\n\n',
      'data: {"tool_result":{"id":"call-1","name":"project.list","status":"ok","duration_ms":42,"output":"2 个项目","output_chars":6}}\n\n',
      'data: [DONE]\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onDone).toHaveBeenCalled());
    expect(spies.onToolCall).toHaveBeenCalledWith({ id: 'call-1', name: 'project.list', arguments: '{"projectId":"p1"}' });
    expect(spies.onToolResult).toHaveBeenCalledWith({
      id: 'call-1',
      name: 'project.list',
      status: 'ok',
      durationMs: 42,
      output: '2 个项目',
      outputChars: 6,
    });
  });

  it('工具失败结果按 error 状态下发，供 UI 画红色状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"tool_result":{"id":"call-2","name":"document.update","status":"error","duration_ms":18,"error":"文档不存在"}}\n\n',
      'data: [DONE]\n\n',
    ])));
    const spies = run();
    await vi.waitFor(() => expect(spies.onDone).toHaveBeenCalled());
    expect(spies.onToolResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: '文档不存在' }));
  });

  it('HTTP 错误：把后端业务文案翻译后交给 onError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '文档内容过短，暂无法评分' }), { status: 400, headers: { 'Content-Type': 'application/json' } })));
    const spies = run();
    await vi.waitFor(() => expect(spies.onError).toHaveBeenCalled());
    expect(spies.onError.mock.calls[0][0]).toContain('文档内容过短');
  });

  it('返回的 abort 函数会中断请求（用户点停止）', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    const onError = vi.fn();
    const abort = streamChat({ message: 'hi', onDone, onError });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    abort();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });
});
