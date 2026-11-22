import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { ChatModule } from '../chat/chat.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [ChatModule, CommonModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
