import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ReferencesModule } from '../references/references.module';

import { KnowledgeModule } from '../knowledge/knowledge.module';
import { WebSearchModule } from '../websearch/websearch.module';
import { AgentTraceModule } from '../agent/agent-trace.module';
import { ConfigModule } from '../config/config.module';
import { ResearchModule } from '../research/research.module';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';

@Module({
  imports: [AiModule, ReferencesModule, KnowledgeModule, AgentTraceModule, WebSearchModule, ConfigModule, ResearchModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
