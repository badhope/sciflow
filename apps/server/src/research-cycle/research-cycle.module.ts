import { Module } from '@nestjs/common';
import { ResearchCycleController } from './research-cycle.controller';
import { ResearchCycleService } from './research-cycle.service';
import { ProgramsModule } from '../programs/programs.module';
import { ExperimentsModule } from '../experiments/experiments.module';
import { AgentTraceModule } from '../agent/agent-trace.module';
import { AiModule } from '../ai/ai.module';
import { ResearchModule } from '../research/research.module';

/**
 * 自主研究循环（阶段 3+）：LangGraph 编排的「问题→假设→协议→实验→评审→修订」多轮循环。
 * 依赖自主科研对象模型（写入 research_* 表）+ 实验沙箱（执行代码）+ AI 层（三个角色智能体）。
 */
@Module({
  imports: [ProgramsModule, ExperimentsModule, AgentTraceModule, AiModule, ResearchModule],
  controllers: [ResearchCycleController],
  providers: [ResearchCycleService],
  exports: [ResearchCycleService],
})
export class ResearchCycleModule {}
