import { Controller, Get, Post, Body, Param, Query, Delete, NotFoundException, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
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

  /**
   * 任务进度 SSE：1s 一次推送完整 task（steps 已解析），有变化才写 data。
   * 前端只订阅 running / awaiting_confirmation；终态发送最后一条后自动结束。
   * 服务端读 SQLite、不做长轮询；客户端断开由 req.close 清理定时器。
   */
  @Get(':id/events')
  events(@Param('id') id: string, @Req() req: Request & { user?: AuthPayload }, @Res() res: Response) {
    this.assertTask(id, req.user);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let last = '';
    let ticks = 0;
    const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
    const send = () => {
      if (closed) return;
      try {
        const task = this.pipeline.get(id);
        const payload = JSON.stringify({ task });
        if (payload !== last) {
          last = payload;
          res.write(`data: ${payload}\n\n`);
        } else {
          ticks += 1;
          if (ticks % 15 === 0) res.write(': ping\n\n');
        }
        if (terminal.has(task.status ?? '')) {
          closed = true;
          if (timer) clearInterval(timer);
          res.end();
        }
      } catch (e: any) {
        if (!closed) res.write(`data: ${JSON.stringify({ error: e?.message || '流水线任务不存在' })}\n\n`);
        closed = true;
        if (timer) clearInterval(timer);
        res.end();
      }
    };
    req.on('close', () => {
      closed = true;
      if (timer) clearInterval(timer);
    });
    send();
    if (!closed) timer = setInterval(send, 1000);
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
