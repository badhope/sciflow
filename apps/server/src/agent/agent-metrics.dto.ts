import { ApiProperty } from '@nestjs/swagger';

/** 工具调用汇总（totals 用 total，单工具用 calls，语义不能混用）。 */
export class AgentToolCallsSummaryDto {
  @ApiProperty({ description: '调用总次数' })
  total!: number;

  @ApiProperty({ description: '成功次数' })
  ok!: number;

  @ApiProperty({ description: '失败次数' })
  fail!: number;

  @ApiProperty({ description: '成功率（0-100）' })
  successRate!: number;

  @ApiProperty({ description: '平均耗时（ms）' })
  avgMs!: number;

  @ApiProperty({ description: 'P95 耗时（ms）' })
  p95Ms!: number;
}

/** 单个工具的调用字段。 */
export class AgentMetricFieldsDto {
  @ApiProperty({ description: '调用次数' })
  calls!: number;

  @ApiProperty({ description: '成功次数' })
  ok!: number;

  @ApiProperty({ description: '失败次数' })
  fail!: number;

  @ApiProperty({ description: '成功率（0-100）' })
  successRate!: number;

  @ApiProperty({ description: '平均耗时（ms）' })
  avgMs!: number;

  @ApiProperty({ description: 'P95 耗时（ms）' })
  p95Ms!: number;
}

/** 单个工具指标。 */
export class AgentToolMetricDto extends AgentMetricFieldsDto {
  @ApiProperty({ description: '工具名' })
  tool!: string;
}

/** 按天指标。 */
export class AgentDayMetricDto {
  @ApiProperty({ description: '日期 YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ description: '工具调用次数' })
  calls!: number;

  @ApiProperty({ description: '失败次数' })
  fail!: number;

  @ApiProperty({ description: 'run token 合计' })
  tokens!: number;
}

/** run 状态汇总。 */
export class AgentRunSummaryDto {
  @ApiProperty({ description: 'run 总数' })
  total!: number;

  @ApiProperty({ description: '成功数' })
  done!: number;

  @ApiProperty({ description: '失败数' })
  error!: number;

  @ApiProperty({ description: '运行中数' })
  running!: number;

  @ApiProperty({ description: '平均耗时（ms）' })
  avgDurationMs!: number;

  @ApiProperty({ description: 'token 合计' })
  totalTokens!: number;
}

/** 最近一次 run（驾驶舱直接渲染）。 */
export class AgentRecentRunDto {
  @ApiProperty({ description: 'run ID' })
  id!: string;

  @ApiProperty({ description: '触发来源' })
  source!: string;

  @ApiProperty({ description: '状态' })
  status!: string;

  @ApiProperty({ description: '耗时（ms）' })
  durationMs!: number;

  @ApiProperty({ description: 'token 合计' })
  tokens!: number;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;
}

/** Agent 观测指标：工具调用 + 按工具/按天分布 + run 汇总。 */
export class AgentMetricsDto {
  @ApiProperty({ description: '统计窗口天数' })
  rangeDays!: number;

  @ApiProperty({ description: '工具调用汇总', type: AgentToolCallsSummaryDto })
  toolCalls!: AgentToolCallsSummaryDto;

  @ApiProperty({ description: '按工具分布', type: [AgentToolMetricDto] })
  byTool!: AgentToolMetricDto[];

  @ApiProperty({ description: '按天分布', type: [AgentDayMetricDto] })
  byDay!: AgentDayMetricDto[];

  @ApiProperty({ description: 'run 汇总', type: AgentRunSummaryDto })
  runs!: AgentRunSummaryDto;

  @ApiProperty({ description: '最近 run', type: [AgentRecentRunDto] })
  recentRuns!: AgentRecentRunDto[];
}
