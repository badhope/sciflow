import { Injectable, Logger } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { db } from '../db/database';
import { agentExecutions, llmCallLogs } from '../db/schema';
import { safeOutboundFetch } from '../ai/safe-outbound';
import { agentExecutionToSpan, buildOtlpPayload, llmCallToSpan, parseOtelHeaders } from './otel-export';

/**
 * OTel OTLP/HTTP-JSON 导出服务（生态缺口 #2 的落地）。
 *
 * OTEL_EXPORTER_OTLP_ENDPOINT 未配置时整体关闭（disabled），零开销；
 * 配置后按标准 OTLP/JSON 线格式把最近的 llm_call_log / agent_execution 记录
 * 推送到 /v1/traces，属性遵循 GenAI 语义约定。本地 collector（127.0.0.1:4318）
 * 需配合 ALLOW_PRIVATE_OUTBOUND=1，出站守卫与模型端点共用同一策略。
 */
@Injectable()
export class OtelExportService {
  private readonly logger = new Logger(OtelExportService.name);

  async exportTraces(limit = 200): Promise<{ disabled?: boolean; exported?: number; endpoint?: string }> {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (!endpoint) return { disabled: true, exported: 0 };

    const url = `${endpoint.replace(/\/+$/, '')}/v1/traces`;
    const llmRows = db.select().from(llmCallLogs).orderBy(desc(llmCallLogs.createdAt)).limit(limit).all();
    const execRows = db.select().from(agentExecutions).orderBy(desc(agentExecutions.createdAt)).limit(limit).all();
    const spans = [
      ...llmRows.map((r) => llmCallToSpan(r)),
      ...execRows.map((r) => agentExecutionToSpan(r)),
    ];
    const payload = buildOtlpPayload(spans, process.env.OTEL_SERVICE_NAME || 'sciflow');

    const res = await safeOutboundFetch(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...parseOtelHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      },
      { allowPrivate: process.env.ALLOW_PRIVATE_OUTBOUND === '1' },
    );
    if (!res.ok) {
      this.logger.warn(`OTLP 导出被拒：${res.status}`);
      throw new Error(`OTLP exporter 返回 ${res.status}`);
    }
    return { exported: spans.length, endpoint: url };
  }
}
