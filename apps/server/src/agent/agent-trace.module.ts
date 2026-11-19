import { Module } from '@nestjs/common';
import { AgentTraceService } from './agent-trace.service';
import { OtelExportService } from './otel-export.service';
import { AgentTraceController } from './agent-trace.controller';
import { AgentToolBridge } from './agent-tool-bridge';
import { TaskListService } from './task-list.service';
import { ApprovalService } from './approval.service';
import { PlanAuthorizationService } from './plan-authorization.service';
import { AgentMetricsService } from './agent-metrics.service';
import { AgentHarnessController } from './agent-harness.controller';
import { AgentPolicyService } from './agent-policy.service';
import { McpModule } from '../mcp/mcp.module';

@Module({
  imports: [McpModule],
  providers: [AgentTraceService, AgentToolBridge, TaskListService, ApprovalService, PlanAuthorizationService, AgentMetricsService, AgentPolicyService, OtelExportService],
  controllers: [AgentTraceController, AgentHarnessController],
  exports: [AgentTraceService, AgentToolBridge, TaskListService, ApprovalService, PlanAuthorizationService, AgentMetricsService, AgentPolicyService],
})
export class AgentTraceModule {}

