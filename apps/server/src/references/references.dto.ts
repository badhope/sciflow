import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 文献对外契约：文献库、写作引用、投稿选刊共用。 */
export class ReferenceDto {
  @ApiProperty({ description: '文献 ID' })
  id!: string;

  @ApiProperty({ description: '所属项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '作者 JSON 字符串或作者列表文本' })
  authors!: string;

  @ApiProperty({ description: '发表年份', type: Number, nullable: true })
  year!: number | null;

  @ApiProperty({ description: '期刊/会议' })
  venue!: string;

  @ApiProperty({ description: 'DOI' })
  doi!: string;

  @ApiProperty({ description: '链接' })
  url!: string;

  @ApiProperty({ description: '摘要' })
  abstract!: string;

  @ApiProperty({ description: '来源', example: 'manual' })
  source!: string;

  @ApiProperty({ description: '标签 JSON 字符串' })
  tags!: string;

  @ApiProperty({ description: '引用次数' })
  citationCount!: number;

  @ApiProperty({ description: '入库时间（毫秒时间戳）' })
  createdAt!: number;

  @ApiPropertyOptional({ description: '阅读状态', enum: ['unread', 'reading', 'read', 'cited'] })
  readingStatus?: 'unread' | 'reading' | 'read' | 'cited';

  @ApiPropertyOptional({ description: '阅读笔记' })
  notes?: string;

  @ApiPropertyOptional({ description: '标题归一化指纹（项目内去重）' })
  fingerprint?: string;

  @ApiPropertyOptional({ description: '重复文献指向的已有文献 ID' })
  isDuplicateOf?: string;
}
