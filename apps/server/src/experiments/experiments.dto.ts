import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 实验记录对外契约：实验页、写作页实验回流共用。 */
export class ExperimentDto {
  @ApiProperty({ description: '实验 ID' })
  id!: string;

  @ApiProperty({ description: '所属项目 ID' })
  projectId!: string;

  @ApiProperty({ description: '关联文档 ID', type: String, nullable: true })
  documentId!: string | null;

  @ApiProperty({ description: '实验目的/假设' })
  goal!: string;

  @ApiProperty({ description: '提交的源码' })
  code!: string;

  @ApiProperty({ description: '运行时', enum: ['python', 'node', 'shell'] })
  runtime!: 'python' | 'node' | 'shell';

  @ApiProperty({ description: '标准输出（可能已截断）' })
  stdout!: string;

  @ApiProperty({ description: '标准错误（可能已截断）' })
  stderr!: string;

  @ApiProperty({ description: 'stdout 是否被截断' })
  stdoutTruncated!: boolean;

  @ApiProperty({ description: 'stderr 是否被截断' })
  stderrTruncated!: boolean;

  @ApiProperty({ description: 'matplotlib 出图（base64 data URL）', type: [String] })
  figures!: string[];

  @ApiProperty({ description: '实验结论（人工回填）' })
  conclusion!: string;

  @ApiProperty({ description: '运行耗时（毫秒）' })
  runtimeMs!: number;

  @ApiProperty({ description: '运行状态', enum: ['ok', 'error', 'timeout'] })
  status!: 'ok' | 'error' | 'timeout';

  @ApiPropertyOptional({ description: '本次运行是否启用 RSS 内存监控（仅 run 响应）' })
  memoryMonitored?: boolean;

  @ApiProperty({ description: '创建时间（毫秒时间戳）' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间（毫秒时间戳）' })
  updatedAt!: number;
}
