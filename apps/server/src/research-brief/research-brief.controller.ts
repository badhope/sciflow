import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Req } from '@nestjs/common';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';
import { ResearchBriefService } from './research-brief.service';

@Controller('projects/:projectId/research-brief')
export class ResearchBriefController {
  constructor(
    private readonly brief: ResearchBriefService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  get(@Param('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.brief.get(projectId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  update(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(projectId, req.user);
    return this.brief.upsert(projectId, body);
  }
}
