import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ProgramsService } from './programs.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * 自主科研对象 API（阶段 2 最小纵切）。
 *
 * 所有端点都做项目归属校验；本地模式（AUTH_MODE=none）保持零登录体验。
 * 路由按对象层级组织：programs → cycles/questions → hypotheses → protocols。
 */
@Controller('programs')
export class ProgramsController {
  constructor(
    private readonly programs: ProgramsService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.programs.listPrograms(projectId);
  }

  @Post()
  create(
    @Body() body: { projectId: string; title: string; goal?: string; domain?: string; autonomyLevel?: string; constraints?: unknown; successCriteria?: unknown },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertProject(body?.projectId, req.user);
    return this.programs.createProgram(body.projectId, body, req.user?.sub || '');
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.getProgram(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { title?: string; goal?: string; domain?: string; autonomyLevel?: string; status?: string; constraints?: unknown; successCriteria?: unknown },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.updateProgram(id, body);
  }

  // ---------- Cycle ----------

  @Get(':id/cycles')
  listCycles(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.listCycles(id);
  }

  /** 项目下全部协议（Run 创建选择已审批方案） */
  @Get(':id/protocols')
  listProgramProtocols(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.listProgramProtocols(id);
  }

  @Post(':id/cycles')
  createCycle(
    @Param('id') id: string,
    @Body() body: { objective?: string; budget?: unknown; state?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.createCycle(id, body);
  }

  @Patch('cycles/:cycleId')
  updateCycle(
    @Param('cycleId') cycleId: string,
    @Body() body: { state?: string; objective?: string; summary?: string; budget?: unknown },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchCycle(cycleId, req.user);
    return this.programs.updateCycle(cycleId, body);
  }

  // ---------- Question ----------

  @Get(':id/questions')
  listQuestions(@Param('id') id: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.listQuestions(id);
  }

  @Post(':id/questions')
  createQuestion(
    @Param('id') id: string,
    @Body() body: { question: string; scope?: string; cycleId?: string; status?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchProgram(id, req.user);
    return this.programs.createQuestion(id, body);
  }

  // ---------- Hypothesis ----------

  @Get('questions/:questionId/hypotheses')
  listHypotheses(@Param('questionId') questionId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchQuestion(questionId, req.user);
    return this.programs.listHypotheses(questionId);
  }

  @Post('questions/:questionId/hypotheses')
  createHypothesis(
    @Param('questionId') questionId: string,
    @Body() body: { statement: string; rationale?: string; predictions?: unknown; status?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchQuestion(questionId, req.user);
    return this.programs.createHypothesis(questionId, body);
  }

  // ---------- Protocol ----------

  @Get('hypotheses/:hypothesisId/protocols')
  listProtocols(@Param('hypothesisId') hypothesisId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchHypothesis(hypothesisId, req.user);
    return this.programs.listProtocols(hypothesisId);
  }

  @Post('hypotheses/:hypothesisId/protocols')
  createProtocol(
    @Param('hypothesisId') hypothesisId: string,
    @Body() body: { design?: unknown; status?: string },
    @Req() req: { user?: AuthPayload },
  ) {
    this.access.assertResearchHypothesis(hypothesisId, req.user);
    return this.programs.createProtocol(hypothesisId, body);
  }

  @Post('protocols/:protocolId/approve')
  approveProtocol(@Param('protocolId') protocolId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertResearchProtocol(protocolId, req.user);
    return this.programs.approveProtocol(protocolId, req.user?.sub || '');
  }
}
