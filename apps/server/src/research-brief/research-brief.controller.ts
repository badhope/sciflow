import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Req } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';
import { ResearchBriefService } from './research-brief.service';
import { ResearchBriefDto, ResearchBriefPatchDto } from './research-brief.dto';

@ApiTags('ResearchBrief')
@Controller('projects/:projectId/research-brief')
export class ResearchBriefController {
  constructor(
    private readonly brief: ResearchBriefService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ResearchBriefDto })
  get(@Param('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.brief.get(projectId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: ResearchBriefPatchDto })
  @ApiOkResponse({ type: ResearchBriefDto })
  update(
    @Param('projectId') projectId: string,
    @Body() body: ResearchBriefPatchDto,
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(projectId, req.user);
    return this.brief.upsert(projectId, body);
  }
}
