import { Module } from '@nestjs/common';
import { ConfigCenterService } from './config-center.service';
import { ConfigController } from './config.controller';

@Module({
  controllers: [ConfigController],
  providers: [ConfigCenterService],
  exports: [ConfigCenterService],
})
export class ConfigModule {}
