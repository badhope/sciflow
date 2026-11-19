import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 项目对外契约：列表、详情、创建、更新共用同一 schema。 */
export class ProjectDto {
  @ApiProperty({ description: '项目 ID' })
  id!: string;

  @ApiProperty({ description: '项目名称' })
  name!: string;

  @ApiProperty({ description: '项目描述' })
  description!: string;

  @ApiProperty({ description: '项目状态', example: 'active' })
  status!: string;

  @ApiProperty({ description: '创建时间（毫秒时间戳）' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间（毫秒时间戳）' })
  updatedAt!: number;

  @ApiPropertyOptional({ description: '项目级系统提示（写作偏好等）' })
  preface?: string;

  @ApiPropertyOptional({ description: '自定义大纲模板 JSON 字符串' })
  templates?: string;

  @ApiPropertyOptional({ description: '企业模式归属用户；本地模式为空串' })
  ownerId?: string;
}
