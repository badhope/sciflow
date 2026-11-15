import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { WebSandboxService } from './web-sandbox.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * Web 项目沙箱 API：创建骨架 → 安装 → 构建 → 预览。
 *
 * 每个步骤独立端点，前端可以逐步展示日志与状态；也提供 run-all 一键跑通。
 * 预览只监听 127.0.0.1，返回 URL 供前端 iframe 展示。
 */
@Controller('web-projects')
export class WebSandboxController {
  constructor(
    private readonly sandbox: WebSandboxService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get('templates')
  templates() {
    return this.sandbox.templates();
  }

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.sandbox.list(projectId);
  }

  @Post()
  create(
    @Body() body: { projectId: string; name: string; template?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(body?.projectId, req.user);
    return this.sandbox.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    const row = this.sandbox.get(id);
    this.access.assertProject(row.projectId, req.user);
    return row;
  }

  @Post(':id/install')
  install(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.install(id);
  }

  /** 项目文件列表（不含 node_modules/dist） */
  @Get(':id/files')
  files(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.listFiles(id);
  }

  /** 读单个文件（Agent 迭代页面时要先看现状） */
  @Get(':id/file')
  readFile(@Param('id') id: string, @Query('path') filePath: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.readFile(id, filePath);
  }

  /** 写单个文件（覆盖或新建）；路径限定在项目目录内 */
  @Put(':id/file')
  writeFile(@Param('id') id: string, @Body() body: { path: string; content: string }, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    if (!body?.path?.trim()) throw new BadRequestException('path 必填');
    return this.sandbox.writeFile(id, body.path, String(body.content ?? ''));
  }

  /** 删除单个文件 */
  @Delete(':id/file')
  removeFile(@Param('id') id: string, @Query('path') filePath: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.removeFile(id, filePath);
  }

  @Post(':id/build')
  build(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.build(id);
  }

  @Post(':id/preview')
  preview(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.preview(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.stopPreview(id);
  }

  @Post(':id/run-all')
  runAll(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.runAll(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertOwn(id, req.user);
    return this.sandbox.remove(id);
  }

  private assertOwn(id: string, user?: AuthPayload) {
    const row = this.sandbox.get(id);
    this.access.assertProject(row.projectId, user);
    if (!row.id) throw new BadRequestException('Web 项目不存在');
    return row;
  }
}
