import { Controller, Get, Header } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { Public } from './auth/public.decorator';
import { sqlite, vecLoaded } from './db/database';
import { EmbeddingService } from './knowledge/embedding.service';

@Controller()
export class HealthController {
  constructor(
    private readonly ai: AiService,
    private readonly embedding: EmbeddingService,
  ) {}

  @Public()
  @Get('health')
  health() {
    // 数据库可用性自检（轻量 SELECT，失败不阻断 health 返回—— degraded 状态上报）
    let dbOk = true;
    try {
      sqlite.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    const emb = this.embedding.status();
    return {
      status: dbOk ? 'ok' : 'degraded',
      time: Date.now(),
      uptime: Math.floor(process.uptime()),
      authMode: process.env.AUTH_MODE || 'none',
      db: dbOk,
      desktop: process.env.SCIFLOW_DESKTOP === '1',
      ai: this.ai.config,
      // 能力探测：前端据此显示「向量检索 / 仅全文检索」降级状态，而不是静默劣化。
      // embeddingModel 必须反映**真实可用后端**（local/api）：此前只看 EMBEDDING_MODEL_PATH
      // 是否存在，配了远程 Key 也会显示「未配置」，与实际能力相反。
      capabilities: {
        vectorSearch: vecLoaded,
        embeddingModel: emb.backend !== 'none',
        embeddingBackend: emb.backend,
        embeddingDimension: emb.dimension,
      },
    };
  }

  /**
   * 深度健康探针（Q-10.3）：db 往返时延 / 向量扩展可用性 / AI 端点配置三探针。
   * 只读、不发真实模型请求（AI 连通性由设置页「测试模型」承担）；
   * desktop 托盘与运维巡检用，单项失败不互相阻断。
   */
  @Public()
  @Get('health/deep')
  healthDeep() {
    let dbOk = true;
    let dbLatencyMs = -1;
    const t0 = Date.now();
    try {
      sqlite.prepare('SELECT 1').get();
      dbLatencyMs = Date.now() - t0;
    } catch {
      dbOk = false;
    }
    let vecOk = false;
    let vecRows = -1;
    try {
      const r = sqlite.prepare('SELECT COUNT(*) AS c FROM knowledge_chunks_embedding').get() as { c: number };
      vecOk = true;
      vecRows = Number(r.c);
    } catch {
      vecOk = false;
    }
    const ai = this.ai.config;
    return {
      status: dbOk ? 'ok' : 'degraded',
      time: Date.now(),
      checks: {
        db: { ok: dbOk, latencyMs: dbLatencyMs },
        vector: { ok: vecOk, extensionLoaded: vecLoaded, embeddedChunks: vecRows },
        ai: { configured: ai.configured, mock: ai.mock, model: ai.model, strongModel: ai.strongModel, baseUrl: ai.baseUrl },
      },
    };
  }

  /**
   * Prometheus 指标端点（text/plain; version=0.0.4）。
   *
   * 企业部署里 scrape 一个端点即可看到容量与健康趋势，不必自己算 SQL。指标均为
   * 低成本 COUNT 聚合（走主键索引），不做全表扫描；任何一项查询失败只让该项缺席，
   * 不让整个端点 500——监控端点自己挂掉是最糟的失败模式。
   */
  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  metrics(): string {
    const lines: string[] = [];
    const put = (name: string, help: string, type: string, samples: { labels?: string; value: number }[]) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
      for (const s of samples) lines.push(`${name}${s.labels ?? ''} ${s.value}`);
    };
    // 用 SQL COUNT 聚合（走主键/索引），不做全表拉取——监控端点自身不能成为负载
    const countOf = (table: string): number => {
      try {
        const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c?: number } | undefined;
        return Number(row?.c ?? 0);
      } catch {
        return -1;
      }
    };

    const projectCount = countOf('project');
    const documentCount = countOf('document');
    const referenceCount = countOf('reference');
    const chunkCount = countOf('knowledge_chunk');
    const llmCalls = countOf('llm_call_log');
    const agentRuns = countOf('agent_execution');
    const qualityReports = countOf('quality_report');

    let dbUp = 0;
    let dbLatency = -1;
    try {
      const t0 = Date.now();
      sqlite.prepare('SELECT 1').get();
      dbLatency = Date.now() - t0;
      dbUp = 1;
    } catch {
      dbUp = 0;
    }

    lines.push('# HELP sciflow_build_info Build info as labels', '# TYPE sciflow_build_info gauge');
    lines.push(`sciflow_build_info{version="${process.env.npm_package_version ?? 'unknown'}",desktop="${process.env.SCIFLOW_DESKTOP === '1' ? 'true' : 'false'}"} 1`);

    put('sciflow_up', 'Whether the service and its database are reachable', 'gauge', [{ value: dbUp }]);
    put('sciflow_db_latency_ms', 'Round-trip latency of a trivial DB query', 'gauge', [{ value: dbLatency }]);
    put('sciflow_process_uptime_seconds', 'Process uptime in seconds', 'gauge', [{ value: Math.floor(process.uptime()) }]);
    put('sciflow_process_resident_memory_bytes', 'Resident memory size in bytes', 'gauge', [{ value: process.memoryUsage().rss }]);
    put('sciflow_projects_total', 'Number of research projects', 'gauge', [{ value: projectCount }]);
    put('sciflow_documents_total', 'Number of documents', 'gauge', [{ value: documentCount }]);
    put('sciflow_references_total', 'Number of references', 'gauge', [{ value: referenceCount }]);
    put('sciflow_knowledge_chunks_total', 'Number of knowledge chunks', 'gauge', [{ value: chunkCount }]);
    put('sciflow_llm_calls_total', 'Number of logged LLM calls', 'counter', [{ value: llmCalls }]);
    put('sciflow_agent_runs_total', 'Number of agent executions', 'counter', [{ value: agentRuns }]);
    put('sciflow_quality_reports_total', 'Number of quality reports', 'counter', [{ value: qualityReports }]);

    return lines.join('\n') + '\n';
  }
}
