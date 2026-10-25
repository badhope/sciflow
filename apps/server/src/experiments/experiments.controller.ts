import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, BadRequestException } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

@Controller('experiments')
export class ExperimentsController {
  constructor(
    private readonly experiments: ExperimentsService,
    private readonly access: ProjectAccessService,
  ) {}

  /**
   * 执行沙箱：保存实验行并在本机临时目录运行 python3
   *
   * 安全说明：沙箱本机运行任意 Python 是该功能的核心能力（隔离的超时/内存/env 白名单）。
   * 企业模式（AUTH_MODE=jwt）下仍要求 projectId 归属校验——任意登录用户只能在自己的项目下
   * 执行，不能借他人项目触发。若部署方要求更严格（仅管理员可执行），应在部署层限制
   * /api/experiments/run 的访问（如网关白名单或独立服务），而非关闭本校验。
   */
  @Post('run')
  run(@Body() body: { projectId: string; goal?: string; code: string; documentId?: string | null }, @Req() req: { user?: AuthPayload }) {
    if (!body?.projectId?.trim()) throw new BadRequestException('projectId 必填');
    this.access.assertProject(body.projectId, req.user);
    if (body.documentId) this.access.assertDocument(body.documentId, req.user);
    return this.experiments.run(body);
  }

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.experiments.list(projectId);
  }

  /** 按文档回流写作页：返回关联该文档的实验列表（须声明在 :id 之前，避免 by-document 被当成实验 id） */
  @Get('by-document/:documentId')
  byDocument(@Param('documentId') documentId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertDocument(documentId, req.user);
    return this.experiments.byDocument(documentId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertExperiment(id, req.user);
    return this.experiments.get(id);
  }

  /** 更新实验目的 / 结论（zod 校验，仅这两个字段可改） */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { goal?: string; conclusion?: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertExperiment(id, req.user);
    return this.experiments.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertExperiment(id, req.user);
    return this.experiments.remove(id);
  }
}
