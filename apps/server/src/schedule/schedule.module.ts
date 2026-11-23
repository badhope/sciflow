import { Module } from '@nestjs/common';
import { ScheduleController } from './schedule.controller';
import { NotificationController } from './notification.controller';
import { ScheduleService } from './schedule.service';
import { NotificationService } from './notification.service';
import { AutomationService } from './automation.service';
import { ChatModule } from '../chat/chat.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [ChatModule, CommonModule],
  controllers: [ScheduleController, NotificationController],
  providers: [ScheduleService, NotificationService, AutomationService],
  exports: [ScheduleService, NotificationService],
})
export class ScheduleModule {}
