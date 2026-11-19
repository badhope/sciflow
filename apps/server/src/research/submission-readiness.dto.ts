import { ApiProperty } from '@nestjs/swagger';

export class SubmissionReadinessItemDto {
  @ApiProperty({ description: '检查项 key' })
  key!: string;

  @ApiProperty({ description: '检查项名称' })
  label!: string;

  @ApiProperty({ enum: ['pass', 'warn', 'fail'], description: 'pass 通过 / warn 提醒 / fail 阻塞' })
  status!: 'pass' | 'warn' | 'fail';

  @ApiProperty({ description: '可行动说明' })
  detail!: string;
}

export class SubmissionReadinessStandardDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  passScore!: number;

  @ApiProperty()
  minChars!: number;

  @ApiProperty()
  minSections!: number;

  @ApiProperty()
  minUniqueCitations!: number;
}

export class SubmissionReadinessStatsDto {
  @ApiProperty()
  chars!: number;

  @ApiProperty()
  sections!: number;

  @ApiProperty()
  citations!: number;

  @ApiProperty()
  uniqueCitations!: number;

  @ApiProperty()
  referenceEntries!: number;

  @ApiProperty()
  libraryReferences!: number;

  @ApiProperty()
  citationLinks!: number;
}

export class SubmissionReadinessDto {
  @ApiProperty()
  projectId!: string;

  @ApiProperty()
  documentId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  documentStatus!: string;

  @ApiProperty()
  updatedAt!: number;

  @ApiProperty({ description: '无 fail 项即视为可投稿；warn 不阻塞' })
  ready!: boolean;

  @ApiProperty({ description: '加权就绪分（0-100）' })
  score!: number;

  @ApiProperty()
  failCount!: number;

  @ApiProperty()
  warnCount!: number;

  @ApiProperty({ type: SubmissionReadinessStandardDto })
  standard!: SubmissionReadinessStandardDto;

  @ApiProperty({ type: [SubmissionReadinessItemDto] })
  items!: SubmissionReadinessItemDto[];

  @ApiProperty({ type: SubmissionReadinessStatsDto })
  stats!: SubmissionReadinessStatsDto;

  @ApiProperty({ description: '检查时间（毫秒时间戳）' })
  checkedAt!: number;
}
