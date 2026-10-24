import { Controller, Get } from '@nestjs/common';
import { AiService } from './ai/ai.service';
import { Public } from './auth/public.decorator';
import { sqlite, vecLoaded } from './db/database';

@Controller()
export class HealthController {
  constructor(private readonly ai: AiService) {}

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
    return {
      status: dbOk ? 'ok' : 'degraded',
      time: Date.now(),
      uptime: Math.floor(process.uptime()),
      authMode: process.env.AUTH_MODE || 'none',
      db: dbOk,
      desktop: process.env.SCIFLOW_DESKTOP === '1',
      ai: this.ai.config,
      // 能力探测：前端据此显示「向量检索 / 仅全文检索」降级状态，而不是静默劣化
      capabilities: {
        vectorSearch: vecLoaded,
        embeddingModel: Boolean(process.env.EMBEDDING_MODEL_PATH),
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
        ai: { configured: ai.configured, model: ai.model, strongModel: ai.strongModel, baseUrl: ai.baseUrl },
      },
    };
  }
}
