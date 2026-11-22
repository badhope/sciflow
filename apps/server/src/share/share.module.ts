import { Module } from '@nestjs/common';
import { ShareController, PublicShareController } from './share.controller';
import { ShareService } from './share.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [ShareController, PublicShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
