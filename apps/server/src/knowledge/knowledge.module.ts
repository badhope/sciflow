import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiService } from '../ai/ai.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { EmbeddingService } from './embedding.service';
import { REMOTE_EMBEDDER } from '../common/embedding';

@Module({
  imports: [AiModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    EmbeddingService,
    // 远程嵌入后端：把既有模型厂商的 /embeddings 能力注入 EmbeddingService。
    // 用显式令牌绑定接口（TS 接口运行期被擦除，不能直接当 DI token）。
    { provide: REMOTE_EMBEDDER, useExisting: AiService },
  ],
  exports: [KnowledgeService, EmbeddingService],
})
export class KnowledgeModule {}
