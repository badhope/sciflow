import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat.service';

/** 流式 Agent 执行的收尾：不能刚拿到 stream 就标 done，必须等真正读完/中止。 */
describe('agent run stream lifecycle', () => {
  it('读完才 finishRun(done)，首块到达时仍保持运行中', async () => {
    const finishRun = vi.fn();
    const svc = new (ChatService as any)({}, {}, {}, {}, {}, {}, {}, {}, { finishRun }, {});
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'));
        controller.enqueue(new TextEncoder().encode('b'));
        controller.close();
      },
    });
    const stream = (svc as any).trackRunStream(source, 'run-1', 3, () => 42) as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.value?.length).toBe(1);
    expect(finishRun).not.toHaveBeenCalled();
    const second = await reader.read();
    expect(second.value?.length).toBe(1);
    const done = await reader.read();
    expect(done.done).toBe(true);
    expect(finishRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'done', totalTokens: 42, outputSummary: 'chat 工具会话（3 个工具可用）' }),
    );
    expect(finishRun).toHaveBeenCalledTimes(1);
  });

  it('用户中止流时标记 cancelled，不伪装成完成', async () => {
    const finishRun = vi.fn();
    const svc = new (ChatService as any)({}, {}, {}, {}, {}, {}, {}, {}, { finishRun }, {});
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'));
      },
    });
    const stream = (svc as any).trackRunStream(source, 'run-2', 1) as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel('user aborted');
    expect(finishRun).toHaveBeenCalledWith(
      'run-2',
      expect.objectContaining({ status: 'cancelled', error: '用户中止' }),
    );
    expect(finishRun).toHaveBeenCalledTimes(1);
  });

  it('上游异常标记 error 并透传错误', async () => {
    const finishRun = vi.fn();
    const svc = new (ChatService as any)({}, {}, {}, {}, {}, {}, {}, {}, { finishRun }, {});
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('gateway reset'));
      },
    });
    const stream = (svc as any).trackRunStream(source, 'run-3', 0) as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    await expect(reader.read()).rejects.toThrow('gateway reset');
    expect(finishRun).toHaveBeenCalledWith(
      'run-3',
      expect.objectContaining({ status: 'error', error: 'gateway reset' }),
    );
  });
});
