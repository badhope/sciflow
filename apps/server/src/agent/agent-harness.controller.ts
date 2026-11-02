import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { TaskListService, type TaskInput } from './task-list.service';
import { ApprovalService } from './approval.service';

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
  ) {}

  /** 读取任务清单（含进度摘要） */
  @Get('tasks')
  listTasks(@Query('projectId') projectId?: string, @Query('runId') runId?: string) {
    return {
      tasks: this.tasks.list(projectId, runId),
      summary: this.tasks.summary(projectId, runId),
    };
  }

  /** 整份替换清单（模型一次给出全部条目） */
  @Post('tasks')
  replaceTasks(
    @Body() body: { tasks?: TaskInput[]; projectId?: string; runId?: string; group?: string },
  ) {
    const tasks = this.tasks.replaceAll(body.tasks ?? [], body.projectId, body.runId, body.group);
    return { tasks, summary: this.tasks.summary(body.projectId, body.runId) };
  }

  /** 单项状态推进 */
  @Post('tasks/:id/status')
  setTaskStatus(@Param('id') id: string, @Body() body: { status: string }) {
    const task = this.tasks.setStatus(id, body.status as never);
    return { task };
  }

  /** 清空清单 */
  @Delete('tasks')
  clearTasks(@Query('projectId') projectId?: string, @Query('runId') runId?: string) {
    this.tasks.clear(projectId, runId);
    return { ok: true };
  }

  /** 待处理审批 */
  @Get('approvals')
  pendingApprovals(@Query('projectId') projectId?: string) {
    return { approvals: this.approvals.pending(projectId) };
  }

  /** 批准或拒绝 */
  @Post('approvals/:id')
  decideApproval(@Param('id') id: string, @Body() body: { approved: boolean }) {
    return { approval: this.approvals.decide(id, body.approved === true) };
  }
}
