import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** 全链路总览：待确认大纲 / 超期投稿 / 未决意见 / 低分文档 + 计数，字段缺失降级为空数组/0 */
  /** projectId 可选：传参时按项目过滤（StageBar/项目总览用），缺省为全库聚合 */
  @Get('overview')
  overview(@Query('projectId') projectId?: string) {
    return this.dashboard.overview(projectId || undefined);
  }
}
