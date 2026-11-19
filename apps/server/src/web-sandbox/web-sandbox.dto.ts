import { ApiProperty } from '@nestjs/swagger';

/** Web 项目沙箱记录：创建/列表/详情共用；安装/构建/预览的日志字段随状态更新。 */
export class WebProjectDto {
  @ApiProperty({ description: 'Web 项目 ID' })
  id!: string;

  @ApiProperty({ description: '所属项目 ID' })
  projectId!: string;

  @ApiProperty({ description: 'Web 项目名' })
  name!: string;

  @ApiProperty({ description: '模板', example: 'static' })
  template!: string;

  @ApiProperty({ description: '沙箱工作目录' })
  workDir!: string;

  @ApiProperty({ description: '状态', example: 'created' })
  status!: string;

  @ApiProperty({ description: '预览端口（未启动为 null）', type: Number, nullable: true })
  previewPort!: number | null;

  @ApiProperty({ description: '预览 URL' })
  previewUrl!: string;

  @ApiProperty({ description: '安装日志（截断）' })
  installLog!: string;

  @ApiProperty({ description: '构建日志（截断）' })
  buildLog!: string;

  @ApiProperty({ description: '错误信息' })
  error!: string;

  @ApiProperty({ description: '创建时间' })
  createdAt!: number;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: number;
}
