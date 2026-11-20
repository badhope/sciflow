import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TaskListService, type TaskInput } from './task-list.service';
import { ApprovalService } from './approval.service';
import { PlanAuthorizationService } from './plan-authorization.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AgentMetricsService } from './agent-metrics.service';
import { AgentMetricsDto } from './agent-metrics.dto';
import {
  AgentApprovalDecisionDto,
  AgentApprovalListDto,
  AgentPlanListDto,
  AgentPlanResponseDto,
  TaskListDto,
} from './agent-api.dto';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * Harness 能力端点：任务清单 + 工具审批。
 *
 * 这些能力对标 OpenCode / Codex / Qoder 的 agent 基础设施，服务两个使用者：
 *  - 模型（经 MCP 工具读写清单、请求审批）
 *  - 界面（轮询清单进度、弹出审批对话框）
 */
@ApiTags('Agent')
@Controller('agent')
export class AgentHarnessController {
  constructor(
    private readonly tasks: TaskListService,
    private readonly approvals: ApprovalService,
    private readonly access: ProjectAccessService,
    private readonly plans: PlanAuthorizationService,
    private readonly metrics: AgentMetricsService,
  ) {}

  /**
   * 企业模式下任务清单必须绑定项目；本地模式保持无项目也能用。
   * 无项目归属的全局清单只有管理员能操作，避免任意登录用户清空/读取全局状态。
   */
  private scopedProject(projectId: string | undefined, user?: AuthPayload): string | undefined {
    if (projectId) {
      this.access.assertProject(projectId, user);
      return projectId;
    }
    if (this.access.enforced) throw new BadRequestException('企业模式下必须指定 projectId');
    return undefined;
  }

  /**
   * Agent 任务事件流：任务清单 / 摘要 / 待审批 / 计划变化时推送一次完整快照。
   * 前端用同一份 SSE 触发 React Query 失效，不再各自 15s 轮询。
   */
  @Get('events')
  events(@Query('projectId') projectId: string | undefined, @Req() req: Request & { user?: AuthPayload }, @Res() res: Response) {
    const pid = this.scopedProject(projectId, req.user);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let last = '';
    let ticks = 0;
    const snapshot = () => ({
      tasks: this.tasks.list(pid),
      summary: this.tasks.summary(pid),
      approvals: this.approvals.pending(pid),
      plans: this.plans.list(pid),
    });
    const send = () => {
      if (closed) return;
      try {
        const payload = JSON.stringify(snapshot());
        if (payload !== last) {
          last = payload;
          res.write(`data: ${payload}\n\n`);
        } else {
          ticks += 1;
          if (ticks % 15 === 0) res.write(': ping\n\n');
        }
      } catch (e: any) {
        if (!closed) res.write(`data: ${JSON.stringify({ error: e?.message || 'Agent 数据读取失败' })}\n\n`);
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
    if (!closed) timer = setInterval(send, 2000);
  }

  /** Agent 观测指标：工具调用成功率/耗时/P95/按工具分布 + run 完成情况。 */
  @Get('metrics')
  @ApiOkResponse({ type: AgentMetricsDto })
  getMetrics(
    @Query('days') days?: string,
    @Query('projectId') projectId?: string,
    @Req() req?: { user?: AuthPayload },
  ) {
    const pid = projectId ? this.scopedProject(projectId, req?.user) : undefined;
    if (!projectId && this.access.enforced) this.access.assertAdmin(req?.user);
    return this.metrics.get(Number(days) || 7, pid);
  }

  /** 读取任务清单（含进度摘要） */
  @Get('tasks')
  @ApiOkResponse({ type: TaskListDto })
  listTasks(@Query('projectId') projectId?: string, @Query('runId') runId?: string, @Req() req?: { user?: AuthPayload }) {
    const pid = this.scopedProject(projectId, req?.user);
    return {
      tasks: this.tasks.list(pid, runId),
      summary: this.tasks.summary(pid, runId),
    };
  }

  /** 整份替换清单（模型一次给出全部条目） */
  @Post('tasks')
  replaceTasks(
    @Body() body: { tasks?: TaskInput[]; projectId?: string; runId?: string; group?: string },
    @Req() req?: { user?: AuthPayload },
  ) {
    const pid = this.scopedProject(body.projectId, req?.user);
    const tasks = this.tasks.replaceAll(body.tasks ?? [], pid, body.runId, body.group);
    return { tasks, summary: this.tasks.summary(pid, body.runId) };
  }

  /** 单项状态推进 */
  @Post('tasks/:id/status')
  setTaskStatus(@Param('id') id: string, @Body() body: { status: string }, @Req() req?: { user?: AuthPayload }) {
    this.access.assertAgentTask(id, req?.user);
    const task = this.tasks.setStatus(id, body.status as never);
    return { task };
  }

  /** 清空清单 */
  @Delete('tasks')
  clearTasks(@Query('projectId') projectId?: string, @Query('runId') runId?: string, @Req() req?: { user?: AuthPayload }) {
    const pid = this.scopedProject(projectId, req?.user);
    this.tasks.clear(pid, runId);
    return { ok: true };
  }

  /** 待处理审批：带项目则校验项目；不带项目时企业模式仅管理员可看全局 */
  @Get('approvals')
  @ApiOkResponse({ type: AgentApprovalListDto })
  pendingApprovals(@Query('projectId') projectId?: string, @Req() req?: { user?: AuthPayload }) {
    if (projectId) this.access.assertProject(projectId, req?.user);
    else if (this.access.enforced) this.access.assertAdmin(req?.user);
    return { approvals: this.approvals.pending(projectId) };
  }

  /** 批准或拒绝：审批记录必须属于当前用户的项目，全局审批仅管理员 */
  @Post('approvals/:id')
  @ApiOkResponse({ type: AgentApprovalDecisionDto })
  decideApproval(@Param('id') id: string, @Body() body: { approved: boolean }, @Req() req?: { user?: AuthPayload }) {
    this.access.assertToolApproval(id, req?.user);
    return { approval: this.approvals.decide(id, body.approved === true) };
  }

  /** 研究计划列表：项目内计划；无项目归属的全局计划企业模式仅管理员可看 */
  @Get('plans')
  @ApiOkResponse({ type: AgentPlanListDto })
  listPlans(@Query('projectId') projectId?: string, @Req() req?: { user?: AuthPayload }) {
    if (projectId) this.access.assertProject(projectId, req?.user);
    else if (this.access.enforced) this.access.assertAdmin(req?.user);
    return { plans: this.plans.list(projectId) };
  }

  /** 创建研究计划（模型经 request_research_plan 创建；界面也可直接建） */
  @Post('plans')
  @ApiOkResponse({ type: AgentPlanResponseDto })
  createPlan(
    @Body() body: { projectId?: string; title?: string; summary?: string; plan?: unknown; allowedTools?: string[]; maxSteps?: number; budgetTokens?: number },
    @Req() req?: { user?: AuthPayload },
  ) {
    if (body.projectId) this.access.assertProject(body.projectId, req?.user);
    else if (this.access.enforced) this.access.assertAdmin(req?.user);
    return {
      plan: this.plans.create({
        projectId: body.projectId,
        title: body.title || '未命名研究计划',
        summary: body.summary,
        plan: body.plan,
        allowedTools: body.allowedTools,
        maxSteps: body.maxSteps,
        budgetTokens: body.budgetTokens,
      }),
    };
  }

  /** 读取单份计划（含预算/步数/白名单） */
  @Get('plans/:id')
  @ApiOkResponse({ type: AgentPlanResponseDto })
  getPlan(@Param('id') id: string, @Req() req?: { user?: AuthPayload }) {
    this.access.assertAgentPlan(id, req?.user);
    return { plan: this.plans.get(id) };
  }

  /** 批准 / 拒绝研究计划：批准后计划内工具在步数/预算内自动放行 */
  @Post('plans/:id')
  @ApiOkResponse({ type: AgentPlanResponseDto })
  decidePlan(@Param('id') id: string, @Body() body: { approved: boolean }, @Req() req?: { user?: AuthPayload }) {
    this.access.assertAgentPlan(id, req?.user);
    return { plan: this.plans.decide(id, body.approved === true) };
  }
}
