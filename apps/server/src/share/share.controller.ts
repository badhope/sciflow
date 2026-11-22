import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShareService } from './share.service';
import { ProjectAccessService } from '../common/project-access.service';
import { Public } from '../auth/public.decorator';
import type { AuthPayload } from '../auth/auth.service';

export class CreateShareRequest {
  @ApiProperty({ description: '项目 ID' }) projectId!: string;
  @ApiProperty({ description: '目标类型；当前只支持 document', enum: ['document'] }) targetType!: 'document';
  @ApiProperty({ description: '文档 ID' }) targetId!: string;
  @ApiPropertyOptional({ description: '有效天数，默认 30，范围 1-365' }) expiresInDays?: number;
}

@Controller('shares')
export class ShareController {
  constructor(private readonly shares: ShareService, private readonly access: ProjectAccessService) {}

  @Post()
  create(@Body() body: CreateShareRequest, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.shares.create({ projectId: body.projectId, targetType: 'document', targetId: body.targetId, expiresInDays: body.expiresInDays });
  }

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    if (!projectId) return { shares: [] };
    this.access.assertProject(projectId, req.user);
    return { shares: this.shares.list(projectId) };
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string, @Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.shares.revoke(id, projectId);
  }
}

@Controller('public/shares')
export class PublicShareController {
  constructor(private readonly shares: ShareService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.shares.getPublic(token);
  }
}
