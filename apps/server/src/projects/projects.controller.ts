import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, HttpCode, HttpStatus, Res } from '@nestjs/common';
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

  /** 项目全量导出（自包含 JSON）：迁移、归档、交接给自己或同事 */
  @Get(':id/export')
  exportBundle(
    @Param('id') id: string,
    @Query('includeRuntime') includeRuntime: string | undefined,
    @Req() req: { user?: AuthPayload },
    @Res({ passthrough: true }) res: { setHeader: (k: string, v: string) => void },
  ) {
    this.access.assertProject(id, req.user);
    const bundle = this.projects.exportBundle(id, includeRuntime === '1' || includeRuntime === 'true');
    const rawName = String((bundle.project as { name?: string }).name || 'project');
    // 只保留字母/数字/中文/连字符，避免头注入与非法文件名
    const name = rawName.replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 60) || 'project';
    // HTTP 头只能是 ASCII：中文项目名必须走 RFC 5987 的 filename*，否则 setHeader 抛
    // ERR_INVALID_CHAR（本项目项目名默认中文，这是必踩路径）。filename 留 ASCII 兜底。
    const asciiName = name.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}-sciflow.json"; filename*=UTF-8''${encodeURIComponent(name)}-sciflow-${Date.now()}.json`,
    );
    return bundle;
  }

  /** 项目导入：生成新 id，不覆盖既有项目；同名自动加「（导入）」 */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  importBundle(@Body() body: { bundle: unknown }, @Req() req: { user?: AuthPayload }) {
    return this.projects.importBundle(body?.bundle, this.access.ownerOf(req.user));
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
