import { Module } from '@nestjs/common';
import { RemoteAccessService } from './remote-access.service';
import { RemoteController } from './remote.controller';

/** 手机远程控制：一次性二维码 + 反向代理网关。 */
@Module({
  controllers: [RemoteController],
  providers: [RemoteAccessService],
  exports: [RemoteAccessService],
})
export class RemoteModule {}
