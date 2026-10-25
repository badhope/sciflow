import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  list(@Req() req: { user?: AuthPayload }) {
    // 企业模式：只列当前用户的项目；本地模式返回全部（行为不变）
    return this.projects.list(this.access.ownerOf(req.user));
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(id, req.user);
    return this.projects.get(id);
  }

  @Post()
  create(@Body() body: { name: string; description?: string }, @Req() req: { user?: AuthPayload }) {
    return this.projects.create(body, this.access.ownerOf(req.user));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string; preface?: string; templates?: string }, @Req() req: { user?: AuthPayload }) {
    // 归属校验（企业模式防 IDOR；本地模式 no-op）——此前 PATCH 可越权改写非本人项目
    this.access.assertProject(id, req.user);
    return this.projects.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(id, req.user);
    return this.projects.remove(id);
  }
}
