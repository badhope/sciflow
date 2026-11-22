import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScheduleService, type ScheduleCadence } from './schedule.service';
import { ProjectAccessService } from '../common/project-access.service';
import type { AuthPayload } from '../auth/auth.service';

export class CreateScheduleRequest {
  @ApiProperty() projectId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['once', 'hourly', 'daily', 'weekly'] }) cadence!: ScheduleCadence;
  @ApiProperty({ description: '任务发给 Agent 的消息' }) message!: string;
  @ApiPropertyOptional() minuteOfHour?: number;
  @ApiPropertyOptional() hourOfDay?: number;
  @ApiPropertyOptional({ description: '0=周日 … 6=周六' }) weekday?: number;
  @ApiPropertyOptional() sessionKey?: string;
  @ApiPropertyOptional() model?: string;
  @ApiPropertyOptional({ description: '仅 once：多少分钟后触发' }) delayMinutes?: number;
}

export class UpdateScheduleRequest {
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ enum: ['once', 'hourly', 'daily', 'weekly'] }) cadence?: ScheduleCadence;
  @ApiPropertyOptional() message?: string;
  @ApiPropertyOptional() minuteOfHour?: number;
  @ApiPropertyOptional() hourOfDay?: number;
  @ApiPropertyOptional() weekday?: number;
  @ApiPropertyOptional() model?: string;
  @ApiPropertyOptional() enabled?: boolean;
}

@Controller('schedules')
export class ScheduleController {
  constructor(private readonly schedules: ScheduleService, private readonly access: ProjectAccessService) {}

  @Post()
  create(@Body() body: CreateScheduleRequest, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(body.projectId, req.user);
    return this.schedules.create(body);
  }

  @Get()
  list(@Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return { schedules: this.schedules.list(projectId) };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Query('projectId') projectId: string, @Body() body: UpdateScheduleRequest, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.schedules.update(id, projectId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.schedules.remove(id, projectId);
  }

  @Post(':id/run')
  runNow(@Param('id') id: string, @Query('projectId') projectId: string, @Req() req: { user?: AuthPayload }) {
    this.access.assertProject(projectId, req.user);
    return this.schedules.runNow(id, projectId);
  }
}
