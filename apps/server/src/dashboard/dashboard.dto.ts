import { ApiProperty } from '@nestjs/swagger';

/** 超期投稿卡点条目（后端 join 期刊周期与修回截止）。 */
export class OverdueSubmissionItemDto {
  @ApiProperty({ description: '投稿记录 ID' })
  id!: string;

  @ApiProperty({ description: '期刊名' })
  journalName!: string;

  @ApiProperty({ description: '稿件标题' })
  title!: string;

  @ApiProperty({ description: '当前状态' })
  status!: string;

  @ApiProperty({ description: '超期天数' })
  overdueDays!: number;
}

/** 低分文档卡点条目（后端取最新一次质量报告）。 */
export class LowQualityDocItemDto {
  @ApiProperty({ description: '文档 ID' })
  id!: string;

  @ApiProperty({ description: '文档标题' })
  title!: string;

  @ApiProperty({ description: '质量分（客观分优先）' })
  score!: number;

  @ApiProperty({ description: '质量报告时间' })
  date!: number;
}

/** 驾驶舱总览：待办计数 + 卡点列表；单块失败时后端降级为 0/空数组。 */
export class DashboardOverviewDto {
  @ApiProperty({ description: '待确认大纲数' })
  pendingOutline!: number;

  @ApiProperty({ description: '超期投稿列表', type: [OverdueSubmissionItemDto] })
  overdueSubmissions!: OverdueSubmissionItemDto[];

  @ApiProperty({ description: '未决评审意见数' })
  openReviewComments!: number;

  @ApiProperty({ description: '低分文档列表', type: [LowQualityDocItemDto] })
  lowQualityDocs!: LowQualityDocItemDto[];

  @ApiProperty({ description: '实验记录数' })
  experimentCount!: number;

  @ApiProperty({ description: '文档数' })
  docCount!: number;

  @ApiProperty({ description: '文献数' })
  refCount!: number;

  @ApiProperty({ description: '知识库资料数' })
  knowledgeCount!: number;

  @ApiProperty({ description: '流水线任务数' })
  pipelineCount!: number;
}
