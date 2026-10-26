import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { AiModule } from '../ai/ai.module';
import { ReferencesModule } from '../references/references.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [AiModule, ReferencesModule, KnowledgeModule, ConfigModule],
  controllers: [McpController],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
