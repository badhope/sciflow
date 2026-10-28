import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsageService } from './usage.service';
import { AdminGuard } from '../auth/admin.guard';

/** 成本汇总 API：全实例聚合（含所有账号的 token 消耗），v1.8 起企业模式仅 admin 可读 */
@Controller('usage')
@UseGuards(AdminGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  /** LLM 调用成本汇总：总量 + 按调用方分组 + 按天分布（成本追踪仪表盘数据源） */
  @Get('summary')
  summary() {
    return this.usage.summary();
  }
}
