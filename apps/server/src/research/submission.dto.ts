import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SUBMISSION_STATUSES, type SubmissionStatus } from '../db/schema';

/** 期刊库条目：全局共享，投稿匹配与状态周期推断共用。 */
export class JournalDto {
  @ApiProperty({ description: '期刊 ID' })
  id!: string;

  @ApiProperty({ description: '期刊名' })
  name!: string;

  @ApiProperty({ description: 'ISSN' })
  issn!: string;

  @ApiProperty({ description: '出版方' })
  publisher!: string;

  @ApiProperty({ description: '收稿范围' })
  scopeText!: string;

  @ApiProperty({ description: '2024 影响因子（未知为 null）', type: Number, nullable: true })
  if2024!: number | null;

  @ApiProperty({ description: '分区' })
  quartile!: string;

  @ApiProperty({ description: '首次决定周期（周，未知为 null）', type: Number, nullable: true })
  firstDecisionWeeks!: number | null;

  @ApiProperty({ description: '录用率（未知为 null）', type: Number, nullable: true })
  acceptanceRate!: number | null;

  @ApiProperty({ description: '开放获取状态' })
  oa!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;
}

/** 投稿状态历史事件（append-only）。 */
export class SubmissionStatusEventDto {
  @ApiProperty({ description: '事件 ID' })
  id!: string;

  @ApiProperty({ description: '投稿记录 ID' })
  submissionId!: string;

  @ApiProperty({ description: '变更前状态；首条为空串' })
  fromStatus!: string;

  @ApiProperty({ description: '变更后状态', enum: SUBMISSION_STATUSES })
  toStatus!: SubmissionStatus;

  @ApiProperty({ description: '状态实际发生时间' })
  eventAt!: number;

  @ApiProperty({ description: '来源', example: 'manual' })
  source!: string;

  @ApiProperty({ description: '邮件原文片段（来源为 email_ai 时）' })
  rawEmailText!: string;

  @ApiProperty({ description: '解析置信度；手动录入为 1' })
  confidence!: number;

  @ApiProperty({ description: '备注' })
  note!: string;

  @ApiProperty({ description: '录入时间' })
  createdAt!: number;
}

/** 一条投稿记录：包含事件流与 L3 周期推断字段。 */
export class SubmissionTrackDto {
  @ApiProperty({ description: '投稿记录 ID' })
  id!: string;

  @ApiProperty({ description: '所属项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '关联文档 ID' })
  documentId!: string;

  @ApiProperty({ description: '关联期刊库 ID' })
  journalId!: string;

  @ApiProperty({ description: '期刊名（冗余，未入库也可记）' })
  journalName!: string;

  @ApiProperty({ description: '稿号' })
  manuscriptNo!: string;

  @ApiProperty({ description: '稿件标题' })
  title!: string;

  @ApiProperty({ description: '投稿日期', type: Number, nullable: true })
  submittedAt!: number | null;

  @ApiProperty({ description: '当前状态', enum: SUBMISSION_STATUSES })
  currentStatus!: SubmissionStatus;

  @ApiProperty({ description: '当前状态最近变更时间', type: Number, nullable: true })
  statusUpdatedAt!: number | null;

  @ApiProperty({ description: '修回/缴费截止', type: Number, nullable: true })
  revisionDeadline!: number | null;

  @ApiProperty({ description: '转投时指向的旧投稿记录 ID' })
  previousSubmissionId!: string;

  @ApiProperty({ description: '来源', example: 'manual' })
  source!: string;

  @ApiProperty({ description: '备注' })
  notes!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: number;

  @ApiProperty({ description: '全部状态事件（时间正序）', type: [SubmissionStatusEventDto] })
  events!: SubmissionStatusEventDto[];

  @ApiProperty({ description: '预计首次决定时间（L3 推断）', type: Number, nullable: true })
  dueAt!: number | null;

  @ApiProperty({ description: '是否超期（L3 推断）' })
  overdue!: boolean;

  @ApiProperty({ description: '超期天数（L3 推断）' })
  overdueDays!: number;

  @ApiPropertyOptional({ description: '预计阶段（L3 推断）', enum: SUBMISSION_STATUSES, nullable: true })
  estimatedStage!: SubmissionStatus | null;
}
