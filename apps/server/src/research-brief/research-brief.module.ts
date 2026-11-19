import { Module } from '@nestjs/common';
import { ResearchBriefController } from './research-brief.controller';
import { ResearchBriefService } from './research-brief.service';

/** 项目研究 Brief：独立模块，供 Chat / MCP / 前端共同读取，不反向依赖业务模块。 */
@Module({
  controllers: [ResearchBriefController],
  providers: [ResearchBriefService],
  exports: [ResearchBriefService],
})
export class ResearchBriefModule {}
