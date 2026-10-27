import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ResearchModule } from '../research/research.module';
import { ReferencesService } from './references.service';
import { ReferencesController } from './references.controller';

@Module({
  // ResearchModule 导出 ScholarSearchService：文献页的「学术发现检索」直接复用流水线同一实现
  imports: [AiModule, ResearchModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
  exports: [ReferencesService],
})
export class ReferencesModule {}
