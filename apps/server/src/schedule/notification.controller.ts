import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

export class CreateNotificationRequest {
  @ApiPropertyOptional() title?: string;
}

@Controller('agent/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService, private readonly access: ProjectAccessService) {}

  @Get()
  list(@Query('projectId') projectId: string, @Query('limit') limit: string | undefined, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return { notifications: this.notifications.list(projectId, Number(limit) || 30), unread: this.notifications.unreadCount(projectId) };
  }

  @Patch(':id/read')
  read(@Param('id') id: string, @Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.notifications.markRead(id, projectId);
  }

  @Post('read-all')
  readAll(@Body() body: { projectId: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.notifications.markAllRead(body.projectId);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @Body() body: { projectId: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.notifications.retry(id, body.projectId);
  }
}
