import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 引用网络节点：文献基础字段 + 阅读状态/重复指向。 */
export class ReferenceGraphNodeDto {
  @ApiProperty({ description: '文献 ID' })
  id!: string;

  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '年份', type: Number, nullable: true })
  year!: number | null;

  @ApiProperty({ description: '期刊/会议' })
  venue!: string;

  @ApiProperty({ description: '引用次数' })
  citationCount!: number;

  @ApiProperty({ description: '标签', type: [String] })
  tags!: string[];

  @ApiPropertyOptional({ description: '阅读状态', example: 'unread' })
  readingStatus?: string;

  @ApiPropertyOptional({ description: '重复指向的文献 ID' })
  isDuplicateOf?: string;
}

/** 引用网络边：weight=共引文档数，dup 边固定高亮。 */
export class ReferenceGraphEdgeDto {
  @ApiProperty({ description: '节点 A ID' })
  a!: string;

  @ApiProperty({ description: '节点 B ID' })
  b!: string;

  @ApiProperty({ description: '共引文档数 / 重复边权重' })
  weight!: number;

  @ApiPropertyOptional({ description: '边类型', enum: ['co-cite', 'dup'] })
  type?: 'co-cite' | 'dup';
}

/** 引用网络聚合结果。 */
export class ReferenceGraphDto {
  @ApiProperty({ type: [ReferenceGraphNodeDto] })
  nodes!: ReferenceGraphNodeDto[];

  @ApiProperty({ type: [ReferenceGraphEdgeDto] })
  edges!: ReferenceGraphEdgeDto[];
}
