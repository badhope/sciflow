import { Body, Controller, Delete, Get, Param, Post, Query, Req, BadRequestException } from '@nestjs/common';
import { TaskListService, type TaskInput } from './task-list.service';
import { ApprovalService } from './approval.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

/**
 * Harness 能力端点：任务清单 + 工具审批。
 *
 * 这些能力对标 OpenCode / Codex / Qoder 的 agent 基础设施，服务两个使用者：
 *  - 模型（经 MCP 工具读写清单、请求审批）
 *  - 界面（轮询清单进度、弹出审批对话框）
 */
@Controller('agent')
export class AgentHarnessController {
  constructor(
    private readonly tasks: TaskListService,
    private readonly approvals: ApprovalService,
    private readonly access: ProjectAccessService,
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

  /** 读取任务清单（含进度摘要） */
  @Get('tasks')
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
  pendingApprovals(@Query('projectId') projectId?: string, @Req() req?: { user?: AuthPayload }) {
    if (projectId) this.access.assertProject(projectId, req?.user);
    else if (this.access.enforced) this.access.assertAdmin(req?.user);
    return { approvals: this.approvals.pending(projectId) };
  }

  /** 批准或拒绝：审批记录必须属于当前用户的项目，全局审批仅管理员 */
  @Post('approvals/:id')
  decideApproval(@Param('id') id: string, @Body() body: { approved: boolean }, @Req() req?: { user?: AuthPayload }) {
    this.access.assertToolApproval(id, req?.user);
    return { approval: this.approvals.decide(id, body.approved === true) };
  }
}
