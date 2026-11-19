import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { AiModule } from '../ai/ai.module';
import { ReferencesModule } from '../references/references.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ConfigModule } from '../config/config.module';
import { ExtensionsModule } from '../extensions/extensions.module';
import { ProjectsModule } from '../projects/projects.module';
import { DocumentsModule } from '../documents/documents.module';
import { ResearchModule } from '../research/research.module';
import { ExperimentsModule } from '../experiments/experiments.module';
import { BrowserModule } from '../browser/browser.module';
import { MemoryModule } from '../memory/memory.module';
import { ResearchBriefModule } from '../research-brief/research-brief.module';

@Module({
  imports: [AiModule, ReferencesModule, KnowledgeModule, ConfigModule, ExtensionsModule, ProjectsModule, DocumentsModule, ResearchModule, ExperimentsModule, BrowserModule, MemoryModule, ResearchBriefModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
