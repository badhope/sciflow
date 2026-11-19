import { ApiProperty } from '@nestjs/swagger';

/** 单次 Agent 执行：来自 agent_execution 表，字段与真实落库一致。 */
export class AgentExecutionDto {
  @ApiProperty({ description: '执行 ID' })
  id!: string;

  @ApiProperty({ description: '项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '触发来源', example: 'chat' })
  source!: string;

  @ApiProperty({ description: '用户原始输入' })
  input!: string;

  @ApiProperty({ description: '最终输出摘要' })
  outputSummary!: string;

  @ApiProperty({ description: '总耗时（ms）' })
  durationMs!: number;

  @ApiProperty({ description: '总 token' })
  totalTokens!: number;

  @ApiProperty({ description: '状态', example: 'running' })
  status!: string;

  @ApiProperty({ description: '错误信息' })
  error!: string;

  @ApiProperty({ description: '模型名' })
  model!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;
}

/** 执行步骤：llm/tool/search/retrieve/thinking。 */
export class AgentStepDto {
  @ApiProperty({ description: '步骤 ID' })
  id!: string;

  @ApiProperty({ description: '所属执行 ID' })
  runId!: string;

  @ApiProperty({ description: '步骤序号' })
  seq!: number;

  @ApiProperty({ description: '步骤类型' })
  kind!: string;

  @ApiProperty({ description: '步骤标题' })
  title!: string;

  @ApiProperty({ description: '输入（截断）' })
  input!: string;

  @ApiProperty({ description: '输出（截断）' })
  output!: string;

  @ApiProperty({ description: '耗时（ms）' })
  durationMs!: number;

  @ApiProperty({ description: 'token' })
  tokens!: number;

  @ApiProperty({ description: '工具名（kind=tool）' })
  toolName!: string;

  @ApiProperty({ description: '状态', example: 'ok' })
  status!: string;

  @ApiProperty({ description: '错误信息' })
  error!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;
}

/** 执行详情：执行记录 + 完整步骤链。 */
export class AgentRunDetailDto extends AgentExecutionDto {
  @ApiProperty({ description: '步骤链', type: [AgentStepDto] })
  steps!: AgentStepDto[];
}

/** 执行列表响应。 */
export class AgentExecutionListDto {
  @ApiProperty({ description: '执行记录', type: [AgentExecutionDto] })
  executions!: AgentExecutionDto[];
}

/** 任务清单条目。 */
export class TaskItemDto {
  @ApiProperty({ description: '任务 ID' })
  id!: string;

  @ApiProperty({ description: '任务内容' })
  content!: string;

  @ApiProperty({ description: '状态', enum: ['pending', 'in_progress', 'completed', 'cancelled'] })
  status!: 'pending' | 'in_progress' | 'completed' | 'cancelled';

  @ApiProperty({ description: '优先级', enum: ['high', 'medium', 'low'] })
  priority!: 'high' | 'medium' | 'low';

  @ApiProperty({ description: '序号' })
  seq!: number;

  @ApiProperty({ description: '分组' })
  group!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: number;
}

/** 任务清单进度摘要。 */
export class TaskSummaryDto {
  @ApiProperty({ description: '总数' })
  total!: number;

  @ApiProperty({ description: '已完成' })
  completed!: number;

  @ApiProperty({ description: '进行中' })
  inProgress!: number;

  @ApiProperty({ description: '待开始' })
  pending!: number;

  @ApiProperty({ description: '完成百分比' })
  percent!: number;
}

/** 任务清单响应。 */
export class TaskListDto {
  @ApiProperty({ type: [TaskItemDto] })
  tasks!: TaskItemDto[];

  @ApiProperty({ type: TaskSummaryDto })
  summary!: TaskSummaryDto;
}

/** 工具审批请求。 */
export class AgentApprovalDto {
  @ApiProperty({ description: '审批 ID' })
  id!: string;

  @ApiProperty({ description: '工具名' })
  toolName!: string;

  @ApiProperty({ description: '参数 JSON' })
  args!: string;

  @ApiProperty({ description: '需要批准的原因' })
  reason!: string;

  @ApiProperty({ description: '状态', enum: ['pending', 'approved', 'rejected', 'expired', 'consumed'] })
  status!: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';

  @ApiProperty({ description: '项目 ID', type: String, nullable: true })
  projectId!: string | null;

  @ApiProperty({ description: 'run ID', type: String, nullable: true })
  runId!: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;

  @ApiProperty({ description: '决定时间', type: Number, nullable: true })
  decidedAt!: number | null;
}

/** 审批列表响应。 */
export class AgentApprovalListDto {
  @ApiProperty({ type: [AgentApprovalDto] })
  approvals!: AgentApprovalDto[];
}

/** 审批决定响应。 */
export class AgentApprovalDecisionDto {
  @ApiProperty({ type: AgentApprovalDto, nullable: true })
  approval!: AgentApprovalDto | null;
}

/** 研究计划级授权。 */
export class AgentPlanDto {
  @ApiProperty({ description: '计划 ID' })
  id!: string;

  @ApiProperty({ description: '项目 ID', type: String, nullable: true })
  projectId!: string | null;

  @ApiProperty({ description: 'run ID', type: String, nullable: true })
  runId!: string | null;

  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '摘要' })
  summary!: string;

  @ApiProperty({ description: '结构化计划', type: Object, nullable: true, additionalProperties: true })
  plan!: Record<string, unknown> | null;

  @ApiProperty({ description: '允许自动放行的工具白名单', type: [String] })
  allowedTools!: string[];

  @ApiProperty({ description: '状态', enum: ['pending', 'approved', 'rejected', 'expired', 'exhausted'] })
  status!: 'pending' | 'approved' | 'rejected' | 'expired' | 'exhausted';

  @ApiProperty({ description: '步数上限' })
  maxSteps!: number;

  @ApiProperty({ description: '已用步数' })
  usedSteps!: number;

  @ApiProperty({ description: 'token 预算（0=不限）' })
  budgetTokens!: number;

  @ApiProperty({ description: '已用 token' })
  usedTokens!: number;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;

  @ApiProperty({ description: '批准时间', type: Number, nullable: true })
  approvedAt!: number | null;

  @ApiProperty({ description: '有效期', type: Number, nullable: true })
  expiresAt!: number | null;
}

/** 计划列表响应。 */
export class AgentPlanListDto {
  @ApiProperty({ type: [AgentPlanDto] })
  plans!: AgentPlanDto[];
}

/** 单份计划响应。 */
export class AgentPlanResponseDto {
  @ApiProperty({ type: AgentPlanDto })
  plan!: AgentPlanDto;
}
