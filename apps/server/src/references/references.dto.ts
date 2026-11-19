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

/** 学术发现检索的单条命中（只返回元数据，不入库）。 */
export class DiscoveredReferenceDto {
  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '作者列表', type: [String] })
  authors!: string[];

  @ApiProperty({ description: '发表年份', type: Number, nullable: true })
  year!: number | null;

  @ApiProperty({ description: '期刊/会议' })
  venue!: string;

  @ApiProperty({ description: 'DOI' })
  doi!: string;

  @ApiProperty({ description: '原文链接' })
  url!: string;

  @ApiProperty({ description: '摘要' })
  abstract!: string;

  @ApiProperty({ description: '引用次数' })
  citationCount!: number;

  @ApiProperty({ description: '来源', example: 'scholar' })
  source!: string;
}

/** 单个公开学术源的本次可达性。 */
export class ScholarSourceStatusDto {
  @ApiProperty({ description: '来源', enum: ['openalex', 'crossref', 'arxiv'] })
  source!: 'openalex' | 'crossref' | 'arxiv';

  @ApiProperty({ description: '至少一次请求成功' })
  ok!: boolean;

  @ApiProperty({ description: '成功请求数' })
  success!: number;

  @ApiProperty({ description: '失败请求数' })
  failed!: number;

  @ApiPropertyOptional({ description: '失败原因（已归一化，不含内部堆栈）' })
  error?: string;
}

/** 学术发现检索结果：包含可达性状态，前端据此提示代理/本地降级。 */
export class ReferenceDiscoverDto {
  @ApiProperty({ description: '学术检索是否开启' })
  enabled!: boolean;

  @ApiProperty({
    description: '结果状态：正常 / 部分源不可达 / 全部源不可达 / 功能关闭',
    enum: ['ok', 'degraded', 'offline', 'disabled'],
    example: 'ok',
  })
  status!: 'ok' | 'degraded' | 'offline' | 'disabled';

  @ApiProperty({ type: [DiscoveredReferenceDto] })
  hits!: DiscoveredReferenceDto[];

  @ApiProperty({ type: [ScholarSourceStatusDto] })
  sources!: ScholarSourceStatusDto[];

  @ApiProperty({ description: '面向用户的提示（含代理与本地替代路径）' })
  notice!: string;
}
