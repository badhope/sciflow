import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScholarSourceStatusDto } from '../references/references.dto';

/** 选题查新请求：projectId 用于离线降级时只读本项目文献库 */
export class NoveltyCheckRequestDto {
  @ApiProperty({ description: '项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '选题原文（中文/英文均可）' })
  topic!: string;

  @ApiPropertyOptional({ description: '可选英文检索词；中文选题建议补充，提高境外学术源命中率' })
  searchQuery?: string;
}

export class NoveltySimilarWorkDto {
  @ApiProperty({ description: '标题' })
  title!: string;

  @ApiProperty({ description: '发表年份', type: Number, nullable: true })
  year!: number | null;

  @ApiProperty({ description: '期刊/会议' })
  venue!: string;

  @ApiProperty({ description: 'DOI' })
  doi!: string;

  @ApiProperty({ description: '原文链接' })
  url!: string;

  @ApiProperty({ description: '来源', example: 'openalex' })
  source!: string;

  @ApiProperty({ description: '引用次数' })
  citationCount!: number;
}

/** 选题查新结果：状态、重叠度、相近工作、可行动建议与逐源可达性 */
export class NoveltyCheckDto {
  @ApiProperty({ description: '结果状态', enum: ['ok', 'degraded', 'offline', 'disabled'] })
  status!: 'ok' | 'degraded' | 'offline' | 'disabled';

  @ApiProperty({ description: '学术检索是否开启' })
  enabled!: boolean;

  @ApiProperty({ description: '是否使用本地库离线降级' })
  offline!: boolean;

  @ApiProperty({ description: '结论依据', enum: ['scholar', 'offline-fallback'] })
  basis!: 'scholar' | 'offline-fallback';

  @ApiProperty({ description: '选题与最相近工作的 token 重叠度（0-100）' })
  overlap!: number;

  @ApiProperty({ description: '选题特异性（0-100）' })
  specificity!: number;

  @ApiProperty({ type: [NoveltySimilarWorkDto] })
  similar!: NoveltySimilarWorkDto[];

  @ApiProperty({ description: '可行动建议' })
  advice!: string;

  @ApiProperty({ description: '源不可达/功能关闭时的提示；正常查新为空串' })
  notice!: string;

  @ApiProperty({ type: [ScholarSourceStatusDto] })
  sources!: ScholarSourceStatusDto[];

  @ApiProperty({ description: '本次学术源命中总数（未去重前）' })
  hitCount!: number;
}
