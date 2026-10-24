import { Controller, Get, Post, Body, Param, Query, Delete } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Post()
  create(@Body() body: { projectId: string; topic: string }) {
    return this.pipeline.create(body.projectId, body.topic);
  }

  @Get()
  listByProject(@Query('projectId') projectId: string) {
    return this.pipeline.listByProject(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.pipeline.get(id);
  }

  /** 人工确认大纲节点（可携带编辑后的大纲） */
  @Post(':id/confirm-outline')
  confirmOutline(@Param('id') id: string, @Body() body: { outline?: { title: string; sections: { title: string; subsections: string[] }[] } }) {
    return this.pipeline.confirmOutline(id, body.outline);
  }

  /** 停止运行中的流水线（用户主动中止；此前无此入口，挂起任务只能重启服务） */
  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.pipeline.stop(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.pipeline.remove(id);
  }
}
