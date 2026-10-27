import { Controller, Get, Post, Body, Param, Query, Delete, NotFoundException, Req } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 流水线 API。
 *
 * 归属校验（2026-10-28 安全审计）：本控制器此前**完全没有** ProjectAccessService 校验，
 * 而 documents / references / knowledge 等控制器都有 —— 企业模式（AUTH_MODE=jwt）下，
 * 知道 taskId 的任一账号可读他人流水线（含主题、产物文档 id、执行轨迹），
 * 也能替他人项目起流水线（烧对方 token）。现在按「任务 → 项目 → 归属」统一断言。
 */
@Controller('pipeline')
export class PipelineController {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 任务归属断言：任务不存在与非本人项目统一 404（不泄露存在性） */
  private assertTask(taskId: string, user?: AuthPayload) {
    const task = this.pipeline.get(taskId);
    try {
      this.access.assertProject(task.projectId, user);
    } catch {
      throw new NotFoundException('流水线任务不存在');
    }
    return task;
  }

  @Post()
  create(@Body() body: { projectId: string; topic: string }, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body?.projectId, req.user);
    return this.pipeline.create(body.projectId, body.topic);
  }

  /**
   * 列表：projectId 可选。
   *  - 本地模式（AUTH_MODE!=jwt）不传 projectId 时返回全部任务（与 references.list 同语义，CLI/回归依赖）
   *  - 企业模式必须显式指定 projectId，避免一次请求拉走他人全部任务
   */
  @Get()
  listByProject(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    if (!projectId) {
      if (this.access.enforced) throw new NotFoundException('企业模式必须指定 projectId');
      return this.pipeline.listAll();
    }
    this.access.assertProject(projectId, req.user);
    return this.pipeline.listByProject(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    return this.assertTask(id, req.user);
  }

  /** 人工确认大纲节点（可携带编辑后的大纲） */
  @Post(':id/confirm-outline')
  confirmOutline(@Param('id') id: string, @Body() body: { outline?: { title: string; sections: { title: string; subsections: string[] }[] } }, @Req() req: { user?: AuthPayload }) {
    this.assertTask(id, req.user);
    return this.pipeline.confirmOutline(id, body.outline);
  }

  /** 停止运行中的流水线（用户主动中止；此前无此入口，挂起任务只能重启服务） */
  @Post(':id/stop')
  stop(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertTask(id, req.user);
    return this.pipeline.stop(id);
  }

  /** 重跑已结束的任务（同主题起新任务；失败任务不再只能「删了重输」） */
  @Post(':id/rerun')
  rerun(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertTask(id, req.user);
    return this.pipeline.rerun(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.assertTask(id, req.user);
    return this.pipeline.remove(id);
  }
}
