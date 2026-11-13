import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ResearchCycleService } from './research-cycle.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 自主研究循环 API。
 *
 * 端点：
 *  - POST /research-cycles/start        启动一轮循环（PI→审批→实验→评审→修订）
 *  - POST /research-cycles/:cycleId/resume  审批后恢复（协议已批准走 DB 状态；approved=false 表示驳回并终止）
 *  - GET  /research-cycles/:cycleId      循环状态（驾驶舱轮询）
 *  - GET  /research-cycles?programId=... 某研究项目的全部循环
 */
@Controller('research-cycles')
export class ResearchCycleController {
  constructor(
    private readonly cycles: ResearchCycleService,
    private readonly access: ProjectAccessService,
  ) {}

  @Post('start')
  start(
    @Body() body: { programId: string; question?: string; maxIterations?: number; maxTokens?: number; approvalMode?: 'human' | 'ai' },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchProgram(body?.programId, req.user);
    return this.cycles.start(body.programId, {
      question: body.question,
      maxIterations: body.maxIterations,
      maxTokens: body.maxTokens,
      approvalMode: body.approvalMode,
    });
  }

  @Post(':cycleId/resume')
  resume(
    @Param('cycleId') cycleId: string,
    @Body() body: { approved?: boolean },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchCycle(cycleId, req.user);
    return this.cycles.resume(cycleId, { approved: body?.approved !== false });
  }

  @Get(':cycleId')
  status(@Param('cycleId') cycleId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchCycle(cycleId, req.user);
    return this.cycles.status(cycleId);
  }

  @Get()
  list(@Query('programId') programId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(programId, req.user);
    return this.cycles.list(programId);
  }
}
