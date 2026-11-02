import { Module } from '@nestjs/common';
import { AgentTraceService } from './agent-trace.service';
import { AgentTraceController } from './agent-trace.controller';
import { AgentToolBridge } from './agent-tool-bridge';
import { TaskListService } from './task-list.service';
import { ApprovalService } from './approval.service';
import { AgentHarnessController } from './agent-harness.controller';
import { McpModule } from '../mcp/mcp.module';

@Module({
  imports: [McpModule],
  providers: [AgentTraceService, AgentToolBridge, TaskListService, ApprovalService],
  controllers: [AgentTraceController, AgentHarnessController],
  exports: [AgentTraceService, AgentToolBridge, TaskListService, ApprovalService],
})
export class AgentTraceModule {}

