import { Module } from '@nestjs/common';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { ResearchRecordsController } from './research-records.controller';
import { ResearchRecordsService } from './research-records.service';

/** 自主科研对象模型（阶段 2）：Program → Cycle → Question → Hypothesis → Protocol → Run → Claim → Evidence */
@Module({
  controllers: [ProgramsController, ResearchRecordsController],
  providers: [ProgramsService, ResearchRecordsService],
  exports: [ProgramsService, ResearchRecordsService],
})
export class ProgramsModule {}
