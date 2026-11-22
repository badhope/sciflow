/**
 * SSE 流式响应助手（封装 NestJS + 原生 fetch 的 OpenAI 兼容流式转发）
 *
 * 替代 chat.controller.ts 中手写的 SSE 拼接 + JSON 解析逻辑，
 * 统一处理 delta/reasoning/usage 三种事件。
 */

import type { Response } from 'express';

export interface SseStreamOptions {
  /** 上游 Web ReadableStream（来自 OpenAI 兼容网关响应体） */
  stream: ReadableStream<Uint8Array>;
  /** 是否转发 reasoning_content / thinking（对应前端"深度思考"开关） */
  forwardReasoning: boolean;
  /** 客户端断连信号 */
  signal?: AbortSignal;
  /** 流完整结束（自然中止或 [DONE]）时的回调：传入累积的 assistant 全文 + 总 usage tokens */
  onComplete?: (fullText: string, totalTokens: number) => void;
}

export interface SseStreamResult {
  /** 异常（客户端断连除外） */
  error?: string;
  /** 累积的 assistant 正文全文（完整生成时；断连时为截至断开时已生成部分） */
  fullText?: string;
}

/**
 * 将 OpenAI 兼容 SSE 流转发到客户端
 *  - delta.content → { delta: string }
 *  - delta.reasoning_content / thinking → { reasoning: string } (仅 forwardReasoning)
 *  - usage → { usage: { prompt_tokens, completion_tokens, total_tokens } }
 *  - [DONE] → 自动终止
 */
export async function forwardOpenAiSse(res: Response, opts: SseStreamOptions): Promise<SseStreamResult> {
  const { stream, forwardReasoning, signal, onComplete } = opts;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let naturalEnd = false;
  let fullText = '';
  let totalTokens = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        onComplete?.(fullText, totalTokens);
        return { fullText };
      }
      const { done, value } = await reader.read();
      if (done) { naturalEnd = true; break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') { naturalEnd = true; break; }
        try {
          const json = JSON.parse(payload) as Record<string, unknown>;
          const choice = (json?.choices as Array<{ delta?: Record<string, unknown> }>)?.[0]?.delta ?? {};
          const delta = choice.content;
          // 上游推理增量：AI SDK 用 reasoning_content，部分厂商用 thinking
          const reasoning = forwardReasoning ? (choice.reasoning_content ?? choice.thinking) : undefined;
          if (typeof delta === 'string') fullText += delta;
          const chunk: Record<string, unknown> = {};
          if (typeof delta === 'string') chunk.delta = delta;
          if (typeof reasoning === 'string') chunk.reasoning = reasoning;
          // 工具调用透传（Agent 循环消费；前端可选展示）
          if (Array.isArray(choice.tool_calls)) chunk.tool_calls = choice.tool_calls;
          // 工具结果透传（上游 transport 在工具完成后发 tool_result，同样带 id/状态/耗时）
          if (json?.tool_result && typeof json.tool_result === 'object') chunk.tool_result = json.tool_result;
          if (Object.keys(chunk).length) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          // 收尾 usage 块
          const usage = json?.usage as Record<string, number> | undefined;
          if (usage && (usage.prompt_tokens != null || usage.total_tokens != null)) {
            totalTokens = Number(usage.total_tokens) || (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
            res.write(
              `data: ${JSON.stringify({
                usage: {
                  prompt_tokens: Number(usage.prompt_tokens) || 0,
                  completion_tokens: Number(usage.completion_tokens) || 0,
                  total_tokens: totalTokens,
                },
              })}\n\n`,
            );
          }
        } catch {
          /* 忽略坏行 */
        }
      }
      if (naturalEnd) break;
    }
    // [DONE] 只是协议标记，不代表上游 ReadableStream 已经关闭。
    // 继续读到 EOF，trackRunStream 才能把 run 标成 done；否则 finally 里的
    // reader.cancel() 会把一次正常完成误判成 cancelled。
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
    res.write('data: [DONE]\n\n');
    onComplete?.(fullText, totalTokens);
    return { fullText };
  } catch (e: any) {
    if (signal?.aborted) {
      onComplete?.(fullText, totalTokens);
      return { fullText };
    }
    return { error: e?.message || String(e), fullText };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}