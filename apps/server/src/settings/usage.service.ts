import { Injectable, Logger } from '@nestjs/common';
import { sqlite } from '../db/database';

interface UsageRow {
  caller: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  avg_latency_ms: number;
  success_rate: number;
}

interface UsageSummary {
  total: UsageRow;
  byCaller: UsageRow[];
  byDay: { day: string; calls: number; total_tokens: number }[];
  byModel: { model: string; calls: number; total_tokens: number }[];
  budgetTokens: number;
  /** Agent 工具调用汇总（kind='tool'，不计入 token 成本） */
  tools: { calls: number; failures: number; avgLatencyMs: number; byName: { name: string; calls: number }[] };
}

/** LLM 用量分析：汇总 + 按调用方分组 + 按天分布（成本追踪仪表盘数据源）
 *  只统计 kind='llm'：工具调用（kind='tool'）没有 token，混进来会让成本与成功率失真。 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  summary(): UsageSummary {
    try {
      const total = sqlite
        .prepare(
          `SELECT caller, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens),0) AS completion_tokens,
             COALESCE(SUM(total_tokens),0) AS total_tokens,
             COALESCE(CAST(AVG(CASE WHEN success = 1 THEN latency_ms END) AS INT), 0) AS avg_latency_ms,
             COALESCE(ROUND(100.0 * SUM(success) / NULLIF(COUNT(*), 0), 1), 0) AS success_rate
           FROM llm_call_log WHERE kind = 'llm'`,
        )
        .get() as UsageRow;
      const byCaller = sqlite
        .prepare(
          `SELECT caller, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
             COALESCE(SUM(completion_tokens),0) AS completion_tokens,
             COALESCE(SUM(total_tokens),0) AS total_tokens,
             COALESCE(CAST(AVG(CASE WHEN success = 1 THEN latency_ms END) AS INT), 0) AS avg_latency_ms,
             COALESCE(ROUND(100.0 * SUM(success) / NULLIF(COUNT(*), 0), 1), 0) AS success_rate
           FROM llm_call_log WHERE kind = 'llm' GROUP BY caller ORDER BY total_tokens DESC`,
        )
        .all() as UsageRow[];
      const byDay = sqlite
        .prepare(
          `SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS total_tokens
           FROM llm_call_log WHERE kind = 'llm' GROUP BY day ORDER BY day DESC LIMIT 14`,
        )
        .all() as { day: string; calls: number; total_tokens: number }[];
      const byModel = sqlite
        .prepare(
          `SELECT model, COUNT(*) AS calls, COALESCE(SUM(total_tokens),0) AS total_tokens
           FROM llm_call_log WHERE kind = 'llm' GROUP BY model ORDER BY total_tokens DESC LIMIT 6`,
        )
        .all() as { model: string; calls: number; total_tokens: number }[];
      // 工具调用单独汇总：次数/失败数/平均耗时/按工具名分布
      const toolTotal = sqlite
        .prepare(`SELECT COUNT(*) AS calls, COALESCE(SUM(1 - success),0) AS failures, COALESCE(CAST(AVG(latency_ms) AS INT), 0) AS avg_latency_ms FROM llm_call_log WHERE kind = 'tool'`)
        .get() as { calls: number; failures: number; avg_latency_ms: number } | undefined;
      const toolByName = sqlite
        .prepare(`SELECT caller AS name, COUNT(*) AS calls FROM llm_call_log WHERE kind = 'tool' GROUP BY caller ORDER BY calls DESC LIMIT 8`)
        .all() as { name: string; calls: number }[];
      // B-2.2 预算上限透出（app_setting pipeline_token_budget，0=不限）
      const budgetRow = sqlite.prepare(`SELECT value FROM app_setting WHERE key='pipeline_token_budget'`).get() as { value?: string } | undefined;
      const budgetTokens = budgetRow ? Number(budgetRow.value) || 0 : 300_000;
      return {
        byModel,
        budgetTokens,
        total: total || { caller: 'all', calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, avg_latency_ms: 0, success_rate: 100 },
        byCaller,
        byDay,
        tools: {
          calls: toolTotal?.calls ?? 0,
          failures: toolTotal?.failures ?? 0,
          avgLatencyMs: toolTotal?.avg_latency_ms ?? 0,
          byName: toolByName,
        },
      };
    } catch {
      // 表不存在（首次部署无调用）时返回零值
      this.logger.debug('llm_call_log 表不存在或查询失败，返回零值');
      return {
        total: { caller: 'all', calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, avg_latency_ms: 0, success_rate: 100 },
        byCaller: [],
        byDay: [],
        byModel: [],
        budgetTokens: 300_000,
        tools: { calls: 0, failures: 0, avgLatencyMs: 0, byName: [] },
      };
    }
  }
}
