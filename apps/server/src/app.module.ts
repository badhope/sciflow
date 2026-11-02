import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { AiModule } from './ai/ai.module';
import { AgentTraceModule } from './agent/agent-trace.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { DocumentsModule } from './documents/documents.module';
import { ReferencesModule } from './references/references.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { ChatModule } from './chat/chat.module';
import { SettingsModule } from './settings/settings.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { McpModule } from './mcp/mcp.module';
import { MemoryModule } from './memory/memory.module';
import { ResearchModule } from './research/research.module';
import { JudgmentModule } from './judgment/judgment.module';
import { CustomizationModule } from './settings/customization.module';
import { ConfigModule } from './config/config.module';
import { ExtensionsModule } from './extensions/extensions.module';
import { ExperimentsModule } from './experiments/experiments.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WebSearchModule } from './websearch/websearch.module';
import { HealthController } from './health.controller';
import { HttpExceptionFilter } from './common/http-exception.filter';

@Module({
  imports: [
    // 结构化日志（pino）：LOG_LEVEL 可配；LOG_PRETTY=1 时本地人类可读
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        autoLogging: { ignore: (req: any) => ['/api/health', '/api/usage/summary'].some((p) => String(req.url || '').startsWith(p)) },
        ...(process.env.LOG_PRETTY === '1'
          ? { transport: { target: 'pino/file', options: { destination: 1 } } }
          : {}),
      },
    }),
    // 全局频率限制：每分钟 60 次（AI 调用 + API），防止 token 成本爆炸 / DoS
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    CommonModule,
    AiModule,
    AgentTraceModule,
    AuthModule,
    WebSearchModule,
    ProjectsModule,
    DocumentsModule,
    ReferencesModule,
    PipelineModule,
    ChatModule,
    SettingsModule,
    KnowledgeModule,
    McpModule,
    MemoryModule,
    ResearchModule,
    JudgmentModule,
    CustomizationModule,
    ConfigModule,
    ExtensionsModule,
    ExperimentsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
