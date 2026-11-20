import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({ description: '最近一次修改计划执行队列 JSON 字符串' })
  revisionQueue?: string;

  @ApiProperty({ description: '创建时间（毫秒时间戳）' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间（毫秒时间戳）' })
  updatedAt!: number;
}


/** 修改队列单条：状态 + 逐条 before/after，前端直接渲染 diff */
export class RevisionQueueItemDto {
  @ApiProperty({ description: '队列条目 ID' }) id!: string;
  @ApiProperty({ description: '回链的评审计划条目 ID', example: 'R1' }) planItemId!: string;
  @ApiProperty({ description: '目标章节标题' }) sectionTitle!: string;
  @ApiProperty({ description: '交给改写模型的要求' }) reviewPoints!: string;
  @ApiProperty({ description: 'pending | running | done | failed | skipped' }) status!: string;
  @ApiProperty({ description: '失败/跳过原因' }) error!: string;
  @ApiProperty({ description: '修改前章节正文' }) before!: string;
  @ApiProperty({ description: '修改后章节正文' }) after!: string;
  @ApiProperty({ description: '内容是否实际变化' }) changed!: boolean;
  @ApiPropertyOptional({ description: '开始时间（毫秒）' }) startedAt?: number | null;
  @ApiPropertyOptional({ description: '完成时间（毫秒）' }) finishedAt?: number | null;
}

/** 修改计划执行队列（单文档仅保留当前/最近一队） */
export class RevisionQueueDto {
  @ApiProperty({ description: '队列 ID' }) id!: string;
  @ApiProperty({ description: '文档 ID' }) documentId!: string;
  @ApiProperty({ description: 'queued | running | completed | partial | failed | stopped' }) status!: string;
  @ApiProperty({ description: '创建时间（毫秒）' }) createdAt!: number;
  @ApiProperty({ description: '更新时间（毫秒）' }) updatedAt!: number;
  @ApiPropertyOptional({ description: '结束时间（毫秒）' }) finishedAt?: number | null;
  @ApiProperty({ type: [RevisionQueueItemDto], description: '逐条执行状态' }) items!: RevisionQueueItemDto[];
}

/** 启动队列的单条输入 */
export class RevisionQueueInputItemDto {
  @ApiPropertyOptional({ description: '评审计划条目 ID', example: 'R1' }) planItemId?: string;
  @ApiPropertyOptional({ description: '目标章节标题；为空时按 excerpt/suggestedAction 匹配' }) sectionTitle?: string;
  @ApiPropertyOptional({ description: '实际改写要求；为空时用 excerpt + suggestedAction' }) reviewPoints?: string;
  @ApiPropertyOptional({ description: '评审原文摘录' }) excerpt?: string;
  @ApiPropertyOptional({ description: '建议动作' }) suggestedAction?: string;
}

export class StartRevisionQueueDto {
  @ApiProperty({ type: [RevisionQueueInputItemDto], description: '待执行条目' })
  items!: RevisionQueueInputItemDto[];
}
