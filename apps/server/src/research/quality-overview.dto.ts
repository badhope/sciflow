import { ApiProperty } from '@nestjs/swagger';

/** 单篇文档的最新质量分总览。 */
export class ProjectQualityOverviewItemDto {
  @ApiProperty({ description: '文档 ID' })
  documentId!: string;

  @ApiProperty({ description: '文档标题' })
  title!: string;

  @ApiProperty({ description: '文档状态' })
  status!: string;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: number;

  @ApiProperty({ description: '正文字符数' })
  chars!: number;

  @ApiProperty({ description: '客观质量分' })
  objectiveScore!: number;

  @ApiProperty({ description: '客观报告指纹' })
  fingerprint!: string;

  @ApiProperty({ description: '硬失败数量' })
  hardFailCount!: number;

  @ApiProperty({ description: '硬失败条目', type: [String] })
  hardFails!: string[];

  @ApiProperty({ description: '最新 LLM 分', type: Number, nullable: true })
  llmScore!: number | null;

  @ApiProperty({ description: '最新 LLM 评分时间', type: Number, nullable: true })
  llmScoredAt!: number | null;

  @ApiProperty({ description: '当前标准的及格线' })
  passScore!: number;

  @ApiProperty({ description: '客观分是否达到及格线' })
  passed!: boolean;
}

/** 项目内全部文档的最新分总览。 */
export class ProjectQualityOverviewDto {
  @ApiProperty({ description: '项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '文档总数' })
  total!: number;

  @ApiProperty({ description: '达标数' })
  passed!: number;

  @ApiProperty({ description: '未达标数' })
  failed!: number;

  @ApiProperty({ description: '空稿/未评分数' })
  unscored!: number;

  @ApiProperty({ description: '文档条目（按客观分升序）', type: [ProjectQualityOverviewItemDto] })
  items!: ProjectQualityOverviewItemDto[];
}
