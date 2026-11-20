import { ApiProperty } from '@nestjs/swagger';

export class SubmissionPackageFileDto {
  @ApiProperty({ description: '包内文件名' })
  name!: string;

  @ApiProperty({ description: '未压缩字节数' })
  bytes!: number;
}

export class SubmissionPackageDto {
  @ApiProperty()
  projectId!: string;

  @ApiProperty()
  documentId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ description: '生成时间（ISO 8601）' })
  generatedAt!: string;

  @ApiProperty({ description: '下载文件名（中文标题-投稿包.zip）' })
  filename!: string;

  @ApiProperty({ format: 'byte', description: 'ZIP 内容（base64）' })
  base64!: string;

  @ApiProperty({ description: 'ZIP 字节数' })
  size!: number;

  @ApiProperty({ type: [SubmissionPackageFileDto] })
  files!: SubmissionPackageFileDto[];

  @ApiProperty()
  ready!: boolean;

  @ApiProperty()
  score!: number;

  @ApiProperty()
  failCount!: number;

  @ApiProperty()
  warnCount!: number;
}
