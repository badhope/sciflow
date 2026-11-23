import { Controller, Get, Query, Req } from '@nestjs/common';
import { SearchService } from './search.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/** 聚合搜索：唯一新增的后端模块；不做独立搜索页，只服务 Cmd+K。 */
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  run(
    @Query('q') q?: string,
    @Query('projectId') projectId?: string,
    @Query('types') types?: string,
    @Req() req?: { user?: AuthPayload },
  ) {
    if (!projectId) return [];
    this.access.assertProject(projectId, req?.user);
    if (!String(q || '').trim()) return [];
    return this.search.search(projectId, String(q).trim(), types);
  }
}
