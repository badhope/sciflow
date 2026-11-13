import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AgentTraceModule } from '../agent/agent-trace.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [AiModule, KnowledgeModule, AgentTraceModule],
  controllers: [SettingsController, UsageController],
  providers: [SettingsService, UsageService],
  exports: [SettingsService],
})
export class SettingsModule {}
