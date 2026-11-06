/**
 * Agent 轨迹 API（GET /api/agent/runs + GET /api/agent/runs/:id + GET /api/agent/usage）
 */

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AgentTraceService } from './agent-trace.service';
import { OtelExportService } from './otel-export.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * Agent 轨迹 API。
 * v1.8 安全：此前只挂了 JwtAuthGuard（只管「是否登录」），任意登录账号可用他人 projectId
 * 读执行轨迹（输入原文、模型、耗时、token），或用 run id 读单次详情。现按归属断言。
 */
@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentTraceController {
  constructor(
    private readonly trace: AgentTraceService,
    private readonly access: ProjectAccessService,
    private readonly otel: OtelExportService,
  ) {}

  /** 项目 Agent 执行历史列表 */
  @Get('executions')
  listExecutions(@Query('projectId') projectId: string, @Req() req?: { user?: AuthPayload }, @Query('limit') limit?: string) {
    if (!projectId) return { error: 'projectId required' };
    this.access.assertProject(projectId, req?.user);
    return { executions: this.trace.listRuns(projectId, limit ? Number(limit) : 20) };
  }

  /** 单次执行详情（含步骤链） */
  @Get('runs/:id')
  getRun(@Param('id') id: string, @Req() req?: { user?: AuthPayload }) {
    this.access.assertAgentExecution(id, req?.user);
    const detail = this.trace.getRunDetail(id);
    if (!detail) return { error: 'not found' };
    return detail;
  }

  /** Token 用量走势 */
  @Get('usage')
  usageTrend(@Query('projectId') projectId: string, @Req() req?: { user?: AuthPayload }, @Query('days') days?: string) {
    if (!projectId) return { error: 'projectId required' };
    this.access.assertProject(projectId, req?.user);
    return { trend: this.trace.tokenUsageTrend(projectId, days ? Number(days) : 14) };
  }

  /** OTLP/JSON 导出：把最近轨迹推到 OTEL_EXPORTER_OTLP_ENDPOINT（未配置时返回 disabled） */
  @Post('otel/export')
  exportOtel(@Body() body: { limit?: number }) {
    return this.otel.exportTraces(body?.limit ? Math.min(Number(body.limit), 1000) : 200);
  }
}
