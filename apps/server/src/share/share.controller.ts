import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShareService } from './share.service';
import { ProjectAccessService } from '../common/project-access.service';
import { Public } from '../auth/public.decorator';
import type { AuthPayload } from '../auth/auth.service';

export class CreateShareRequest {
  @ApiProperty({ description: '项目 ID' }) projectId!: string;
  @ApiProperty({ description: '目标类型', enum: ['document', 'conversation'] }) targetType!: 'document' | 'conversation';
  @ApiProperty({ description: '文档 ID 或会话 ID' }) targetId!: string;
  @ApiPropertyOptional({ description: '有效天数，默认 30，范围 1-365' }) expiresInDays?: number;
  @ApiPropertyOptional({ description: '是否开启只读评论（默认关闭）' }) allowComments?: boolean;
}

export class CommentRequest {
  @ApiPropertyOptional() authorName?: string;
  @ApiProperty() content!: string;
}

@Controller('shares')
export class ShareController {
  constructor(private readonly shares: ShareService, private readonly access: ProjectAccessService) {}

  @Post()
  create(@Body() body: CreateShareRequest, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.shares.create({
      projectId: body.projectId,
      targetType: body.targetType === 'conversation' ? 'conversation' : 'document',
      targetId: body.targetId,
      expiresInDays: body.expiresInDays,
      allowComments: body.allowComments,
    });
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

  @Get(':id/comments')
  comments(@Param('id') id: string, @Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return { comments: this.shares.commentsForShare(id, projectId) };
  }

  @Delete(':id/comments/:commentId')
  deleteComment(@Param('id') id: string, @Param('commentId') commentId: string, @Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.shares.deleteComment(id, commentId, projectId);
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

  @Public()
  @Get(':token/comments')
  comments(@Param('token') token: string) {
    return { comments: this.shares.listComments(token) };
  }

  @Public()
  @Post(':token/comments')
  comment(@Param('token') token: string, @Body() body: CommentRequest) {
    return this.shares.addComment(token, body);
  }
}
