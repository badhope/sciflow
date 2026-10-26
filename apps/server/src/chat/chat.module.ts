import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { WebSearchModule } from '../websearch/websearch.module';
import { AgentTraceModule } from '../agent/agent-trace.module';
import { AiModule } from '../ai/ai.module';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { ChatSessionService } from './chat-session.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [AiModule, MemoryModule, KnowledgeModule, WebSearchModule, AgentTraceModule, ConfigModule],
  controllers: [ChatController],
  providers: [ChatService, ChatSessionService],
  exports: [ChatService, ChatSessionService], // RAG 注入逻辑（contextFor）可被 McpModule 等复用
})
export class ChatModule {}