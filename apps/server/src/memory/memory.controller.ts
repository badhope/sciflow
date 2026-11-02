import { Controller, Get, Post, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 记忆中心 API。
 * v1.8 安全：此前零归属校验 —— 企业模式下可读他人项目的情景记忆
 * （含每次研究的主题、结论摘要）与删除他人记忆。现在按 projectId / memoryId 断言。
 */
@Controller('memory')
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    private readonly access: ProjectAccessService,
  ) {}

  /** 新增记忆（程序记忆=写作风格指令） */
  @Post()
  add(@Body() body: { type?: string; content: string; projectId?: string; keywords?: string[] }, @Req() req: { user?: AuthPayload }) {
    if (body?.projectId) this.access.assertProject(body.projectId, req.user);
    const type = body.type === 'procedural' ? 'procedural' : 'episodic';
    return this.memory.add(type, body.content, body.projectId, body.keywords || []);
  }

  /** 记忆列表：?type=procedural|episodic&q=关键词&projectId=项目ID */
  @Get()
  list(@Query('type') type?: string, @Query('q') q?: string, @Query('projectId') projectId?: string, @Req() req?: { user?: AuthPayload }) {
    if (projectId) this.access.assertProject(projectId, req?.user);
    else if (this.access.enforced) {
      // 企业模式禁止「不带项目」拉全库记忆（含他人研究摘要）；程序记忆无项目归属，按创建者隔离不可行，
      // 因此这里要求显式 projectId，前端记忆页始终带 projectId。
      this.access.deny('企业模式必须指定 projectId');
    }
    return this.memory.list(
      type === 'procedural' || type === 'episodic' ? type : undefined,
      q,
      projectId,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertMemory(id, req.user);
    return this.memory.remove(id);
  }
}
