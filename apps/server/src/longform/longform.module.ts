import { Module } from '@nestjs/common';
import { LongformController } from './longform.controller';
import { LongformService } from './longform.service';
import { AiModule } from '../ai/ai.module';

/**
 * 长篇写作（百万字级）：分卷 → 分章 → 逐章生成 → 摘要续写。
 * 与稿件流水线（pipeline）并列：pipeline 产出一篇论文，longform 产出一本书。
 */
@Module({
  imports: [AiModule],
  controllers: [LongformController],
  providers: [LongformService],
  exports: [LongformService],
})
export class LongformModule {}