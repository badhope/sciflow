import { describe, expect, it } from 'vitest';
import { llmCallToSpan, agentExecutionToSpan, buildOtlpPayload, hexId } from './otel-export';

describe('hexId', () => {
  it('derives a stable 32-char trace id from a string seed', () => {
    expect(hexId('row-1', 32)).toBe(hexId('row-1', 32));
    expect(hexId('row-1', 32)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces different ids for different seeds', () => {
    expect(hexId('row-1', 32)).not.toBe(hexId('row-2', 32));
  });

  it('supports 16-char span ids', () => {
    expect(hexId('row-1', 16)).toMatch(/^[0-9a-f]{16}$/);
  });
});

const llmRow = {
  id: 'call-1',
  caller: 'pipeline',
  kind: 'llm',
  model: 'glm-5',
  promptTokens: 120,
  completionTokens: 30,
  totalTokens: 150,
  latencyMs: 900,
  success: 1,
  error: '',
  createdAt: 1700000000000,
};

describe('llmCallToSpan', () => {
  it('names the span after the GenAI operation and model', () => {
    const span = llmCallToSpan(llmRow);
    expect(span.name).toBe('chat glm-5');
  });

  it('emits gen_ai usage attributes', () => {
    const span = llmCallToSpan(llmRow);
    const get = (key: string) => span.attributes.find((a) => a.key === key);
    expect(get('gen_ai.request.model')?.value.stringValue).toBe('glm-5');
    expect(get('gen_ai.usage.input_tokens')?.value.intValue).toBe(120);
    expect(get('gen_ai.usage.output_tokens')?.value.intValue).toBe(30);
    expect(get('gen_ai.usage.total_tokens')?.value.intValue).toBe(150);
    expect(get('sciflow.caller')?.value.stringValue).toBe('pipeline');
  });

  it('uses decimal-string unix nano timestamps', () => {
    const span = llmCallToSpan(llmRow);
    expect(typeof span.startTimeUnixNano).toBe('string');
    expect(span.startTimeUnixNano).toBe('1700000000000000000');
    expect(span.endTimeUnixNano).toBe('1700000000900000000');
  });

  it('marks failed calls with an error status', () => {
    const span = llmCallToSpan({ ...llmRow, success: 0, error: 'timeout' });
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe('timeout');
  });

  it('marks successful calls with status code 1', () => {
    const span = llmCallToSpan(llmRow);
    expect(span.status.code).toBe(1);
  });
});

const execRow = {
  id: 'exec-1',
  projectId: 'proj-1',
  source: 'chat',
  input: '总结文献',
  outputSummary: '完成',
  durationMs: 4000,
  totalTokens: 500,
  status: 'done',
  error: '',
  model: 'glm-5',
  createdAt: 1700000000000,
};

describe('agentExecutionToSpan', () => {
  it('names the span as an agent execution with source', () => {
    const span = agentExecutionToSpan(execRow);
    expect(span.name).toBe('execute_task chat');
  });

  it('carries agent identity attributes', () => {
    const span = agentExecutionToSpan(execRow);
    const get = (key: string) => span.attributes.find((a) => a.key === key);
    expect(get('gen_ai.agent.id')?.value.stringValue).toBe('exec-1');
    expect(get('sciflow.project_id')?.value.stringValue).toBe('proj-1');
    expect(get('gen_ai.usage.total_tokens')?.value.intValue).toBe(500);
  });

  it('marks error executions', () => {
    const span = agentExecutionToSpan({ ...execRow, status: 'error', error: 'boom' });
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe('boom');
  });
});

describe('buildOtlpPayload', () => {
  it('wraps spans into OTLP/JSON resourceSpans structure', () => {
    const spans = [llmCallToSpan(llmRow), agentExecutionToSpan(execRow)];
    const payload = buildOtlpPayload(spans, 'sciflow');
    const rs = payload.resourceSpans;
    expect(rs.length).toBe(1);
    const serviceName = rs[0].resource.attributes.find((a) => a.key === 'service.name');
    expect(serviceName?.value.stringValue).toBe('sciflow');
    expect(rs[0].scopeSpans[0].scope.name).toBe('sciflow.traces');
    expect(rs[0].scopeSpans[0].spans.length).toBe(2);
  });
});
