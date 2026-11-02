import { Controller, Get, Query, Req } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 项目总览 API。
 * v1.8 安全：`overview` 支持不传 projectId 做全库聚合（本地单用户有用），
 * 但企业模式下这是跨租户数据汇总（他人待确认大纲、超期投稿、低分文档标题）。
 * 因此企业模式要求显式 projectId 并断言归属，本地模式保持原行为。
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 全链路总览：待确认大纲 / 超期投稿 / 未决意见 / 低分文档 + 计数，字段缺失降级为空数组/0 */
  /** projectId 可选：传参时按项目过滤（StageBar/项目总览用），缺省为全库聚合 */
  @Get('overview')
  overview(@Query('projectId') projectId: string | undefined, @Req() req: { user?: AuthPayload }) {
    if (projectId) this.access.assertProject(projectId, req.user);
    else if (this.access.enforced) this.access.deny('企业模式必须指定 projectId');
    return this.dashboard.overview(projectId || undefined);
  }
}
