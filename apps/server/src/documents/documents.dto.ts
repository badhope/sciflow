import { ApiProperty } from '@nestjs/swagger';

/** 文档对外契约：写作、质量、投稿、实验四条链路共用。 */
export class DocDto {
  @ApiProperty({ description: '文档 ID' })
  id!: string;

  @ApiProperty({ description: '所属项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '正文 Markdown' })
  content!: string;

  @ApiProperty({ description: '大纲 JSON 字符串' })
  outline!: string;

  @ApiProperty({ description: '当前版本号' })
  version!: number;

  @ApiProperty({ description: '历史版本 JSON 字符串' })
  versions!: string;

  @ApiProperty({ description: '文档状态', example: 'draft' })
  status!: string;

  @ApiProperty({ description: '创建时间（毫秒时间戳）' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间（毫秒时间戳）' })
  updatedAt!: number;
}
