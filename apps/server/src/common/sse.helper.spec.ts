import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { forwardOpenAiSse } from './sse.helper';

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
}

function fakeResponse() {
  const chunks: string[] = [];
  const res = {
    write: vi.fn((value: string) => {
      chunks.push(value);
      return true;
    }),
  } as unknown as Response;
  return { res, chunks };
}

describe('forwardOpenAiSse', () => {
  it('把 tool_result 原样透传给前端，供工具卡展示结果/错误/耗时', async () => {
    const { res, chunks } = fakeResponse();
    const result = await forwardOpenAiSse(res, {
      stream: sseStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"project.list","arguments":"{}"}}]}}]}\n\n',
        'data: {"tool_result":{"id":"call-1","name":"project.list","status":"ok","duration_ms":42,"output":"2 个项目","output_chars":6}}\n\n',
        'data: [DONE]\n\n',
      ]),
      forwardReasoning: false,
    });

    expect(result.error).toBeUndefined();
    const joined = chunks.join('');
    expect(joined).toContain('"tool_calls"');
    expect(joined).toContain('"tool_result"');
    expect(joined).toContain('"duration_ms":42');
    expect(joined).toContain('2 个项目');
  });

  it('自然结束会继续读到 EOF，避免把正常完成误判为取消', async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        // 真实上游在 [DONE] 后还有一个微任务才 close；helper 不能在这里就 cancel。
        setTimeout(() => controller.close(), 0);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { res } = fakeResponse();
    await forwardOpenAiSse(res, { stream, forwardReasoning: false });
    expect(cancelled).toBe(false);
  });

  it('工具失败结果同样透传，不被 choices 解析丢掉', async () => {
    const { res, chunks } = fakeResponse();
    await forwardOpenAiSse(res, {
      stream: sseStream([
        'data: {"tool_result":{"id":"call-2","name":"document.update","status":"error","error":"文档不存在"}}\n\n',
        'data: [DONE]\n\n',
      ]),
      forwardReasoning: false,
    });
    expect(chunks.join('')).toContain('"status":"error"');
    expect(chunks.join('')).toContain('文档不存在');
  });
});
