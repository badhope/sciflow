import { Module } from '@nestjs/common';
import { ExtensionsController } from './extensions.controller';
import { ExtensionsService } from './extensions.service';
import { AiModule } from '../ai/ai.module';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [AiModule, ConfigModule],
  controllers: [ExtensionsController],
  providers: [ExtensionsService],
  exports: [ExtensionsService],
})
export class ExtensionsModule {}
