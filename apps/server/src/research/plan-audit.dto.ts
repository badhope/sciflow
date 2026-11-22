import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 计划确定性审计请求：正文可直接传编辑器当前内容（含未保存改动）。 */
export class PlanAuditRequestDto {
  @ApiPropertyOptional({ description: '项目 ID；传入时校验当前用户是否有权访问该项目' })
  projectId?: string;

  @ApiPropertyOptional({ description: '文档标题；仅用于结果回显与引用时效检查' })
  title?: string;

  @ApiProperty({ description: '研究计划正文（Markdown/纯文本均可），上限 500000 字' })
  content!: string;
}

export class PlanAuditFindingDto {
  @ApiProperty({ description: '规则 ID，如 sample-flow / timeline-lag' })
  id!: string;

  @ApiProperty({ description: '严重度', enum: ['blocker', 'warning', 'info'] })
  severity!: 'blocker' | 'warning' | 'info';

  @ApiProperty({
    description: '规则分类',
    enum: ['sample', 'timeline', 'construct', 'measurement', 'novelty', 'journal', 'references', 'terminology'],
  })
  category!: 'sample' | 'timeline' | 'construct' | 'measurement' | 'novelty' | 'journal' | 'references' | 'terminology';

  @ApiProperty({ description: '问题说明' })
  message!: string;

  @ApiPropertyOptional({ description: '触发规则的原文证据' })
  evidence?: string;

  @ApiProperty({ description: '可执行修复建议' })
  suggestion!: string;
}

export class PlanAuditMetricsDto {
  @ApiPropertyOptional({ description: 'T1 目标样本量' })
  t1Target?: number;

  @ApiPropertyOptional({ description: '配对样本目标量' })
  pairedTarget?: number;

  @ApiPropertyOptional({ description: '预计流失率（百分比）' })
  attritionPct?: number;

  @ApiPropertyOptional({ description: 'T1 收集周次，如 W7-W8' })
  t1Weeks?: string;

  @ApiPropertyOptional({ description: 'T2 收集周次，如 W9-W9' })
  t2Weeks?: string;

  @ApiPropertyOptional({ description: '名义设计间隔（周）' })
  lagWeeks?: number;

  @ApiPropertyOptional({ description: '排期实际间隔（周）' })
  gapWeeks?: number;
}

export class PlanAuditResultDto {
  @ApiProperty({ description: '是否通过硬门禁（无 blocker）' })
  ok!: boolean;

  @ApiProperty({ description: '回显标题' })
  title!: string;

  @ApiProperty({ description: '审计正文字数' })
  chars!: number;

  @ApiProperty({ description: '确定性评分：100 - 18*blockers - 6*warnings，最低 0' })
  score!: number;

  @ApiProperty({ description: 'blocker 数量' })
  blockers!: number;

  @ApiProperty({ description: 'warning 数量' })
  warnings!: number;

  @ApiProperty({ type: [PlanAuditFindingDto] })
  findings!: PlanAuditFindingDto[];

  @ApiProperty({ type: PlanAuditMetricsDto })
  metrics!: PlanAuditMetricsDto;

  @ApiProperty({ description: '一句话结论' })
  summary!: string;
}
