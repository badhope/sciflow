/**
 * OpenTelemetry OTLP/HTTP-JSON 导出（纯映射层，无 IO，单测可直接覆盖）。
 *
 * SciFlow 的轨迹已持久化在 SQLite（llm_call_log / agent_execution）；这里不做进程内
 * 埋点，而是把已持久化的记录映射为符合 OTLP/JSON 线格式的 span（uint64 一律十进制
 * 字符串，proto3 JSON 规范），属性命名遵循 OpenTelemetry GenAI 语义约定
 * （gen_ai.* namespace，open-telemetry/semantic-conventions-genai）。
 *
 * trace/span id 由行 id 经 SHA-1 确定性派生——同一行重复导出得到同一 id，幂等。
 */

import { createHash } from 'node:crypto';

export interface OtelAttr {
  key: string;
  value: { stringValue?: string; intValue?: number };
}

export interface OtelSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtelAttr[];
  status: { code: number; message?: string };
}

export function hexId(seed: string, length: number): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, length);
}

function msToNano(ms: number): string {
  return `${BigInt(Math.round(ms)) * 1000000n}`.toString();
}

function attr(key: string, value: string | number): OtelAttr {
  return {
    key,
    value: typeof value === 'number' ? { intValue: value } : { stringValue: value },
  };
}

function statusOf(success: boolean, error: string): { code: number; message?: string } {
  if (success) return { code: 1 };
  return { code: 2, message: error || 'error' };
}

/** llm_call_log → GenAI chat span（gen_ai.usage.* 遵循 semconv token 属性名）。 */
export function llmCallToSpan(row: {
  id: string;
  caller: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  success: number | null;
  error: string | null;
  createdAt: number;
}): OtelSpan {
  const model = row.model || 'unknown';
  const start = row.createdAt;
  const end = start + (row.latencyMs || 0);
  const attributes: OtelAttr[] = [
    attr('gen_ai.system', 'sciflow'),
    attr('gen_ai.operation.name', 'chat'),
    attr('gen_ai.request.model', model),
    attr('gen_ai.usage.input_tokens', row.promptTokens || 0),
    attr('gen_ai.usage.output_tokens', row.completionTokens || 0),
    attr('gen_ai.usage.total_tokens', row.totalTokens || 0),
    attr('sciflow.caller', row.caller || 'general'),
  ];
  if (row.error) attributes.push(attr('error.message', row.error));
  return {
    traceId: hexId(row.id, 32),
    spanId: hexId(`${row.id}:span`, 16),
    name: `chat ${model}`,
    kind: 3,
    startTimeUnixNano: msToNano(start),
    endTimeUnixNano: msToNano(end),
    attributes,
    status: statusOf((row.success ?? 1) === 1, row.error || ''),
  };
}

/** agent_execution → GenAI agent execute_task span。 */
export function agentExecutionToSpan(row: {
  id: string;
  projectId: string;
  source: string;
  outputSummary: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  status: string | null;
  error: string | null;
  model: string | null;
  createdAt: number;
}): OtelSpan {
  const source = row.source || 'unknown';
  const start = row.createdAt;
  const end = start + (row.durationMs || 0);
  const ok = row.status === 'done';
  const attributes: OtelAttr[] = [
    attr('gen_ai.agent.id', row.id),
    attr('sciflow.project_id', row.projectId),
    attr('sciflow.source', source),
    attr('gen_ai.request.model', row.model || 'unknown'),
    attr('gen_ai.usage.total_tokens', row.totalTokens || 0),
  ];
  if (row.outputSummary) attributes.push(attr('sciflow.output_summary', row.outputSummary.slice(0, 400)));
  return {
    traceId: hexId(row.id, 32),
    spanId: hexId(`${row.id}:span`, 16),
    name: `execute_task ${source}`,
    kind: 3,
    startTimeUnixNano: msToNano(start),
    endTimeUnixNano: msToNano(end),
    attributes,
    status: statusOf(ok, row.error || ''),
  };
}

/** 组装 OTLP/JSON traces 请求体（POST ${endpoint}/v1/traces）。 */
export function buildOtlpPayload(spans: OtelSpan[], serviceName: string) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [attr('service.name', serviceName), attr('service.namespace', 'sciflow')],
        },
        scopeSpans: [
          {
            scope: { name: 'sciflow.traces', version: '1.12.0' },
            spans,
          },
        ],
      },
    ],
  };
}

/** OTEL_EXPORTER_OTLP_HEADERS（逗号分隔 key=value）→ 请求头对象。 */
export function parseOtelHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (key && value) headers[key] = value;
    }
  }
  return headers;
}
