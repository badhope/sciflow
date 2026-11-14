import { Module } from '@nestjs/common';
import { WebSandboxController } from './web-sandbox.controller';
import { WebSandboxService } from './web-sandbox.service';

/**
 * Web 项目沙箱：独立目录 + npm install/build + 静态预览。
 * 与 ExperimentsModule（一次性脚本沙箱）并列，互不共享目录与端口。
 */
@Module({
  controllers: [WebSandboxController],
  providers: [WebSandboxService],
  exports: [WebSandboxService],
})
export class WebSandboxModule {}
