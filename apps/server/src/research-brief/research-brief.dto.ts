import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 研究 Brief 的对外契约（同时作为 Swagger schema 源，前端从 OpenAPI 生成类型）。 */
export class ResearchBriefDto {
  @ApiProperty({ description: '项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '研究问题' })
  question!: string;

  @ApiProperty({ description: '范围与边界' })
  scope!: string;

  @ApiProperty({ description: '方法与数据' })
  methods!: string;

  @ApiProperty({ description: '约束条件' })
  constraints!: string;

  @ApiProperty({ description: '成功标准' })
  successCriteria!: string;

  @ApiProperty({ description: '最后更新时间（毫秒时间戳；0 表示未设置）' })
  updatedAt!: number;
}

/** 局部更新：未提交字段保留旧值。 */
export class ResearchBriefPatchDto {
  @ApiPropertyOptional({ description: '研究问题' })
  question?: string;

  @ApiPropertyOptional({ description: '范围与边界' })
  scope?: string;

  @ApiPropertyOptional({ description: '方法与数据' })
  methods?: string;

  @ApiPropertyOptional({ description: '约束条件' })
  constraints?: string;

  @ApiPropertyOptional({ description: '成功标准' })
  successCriteria?: string;
}
