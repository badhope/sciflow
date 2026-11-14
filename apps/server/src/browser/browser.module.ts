import { Module } from '@nestjs/common';
import { BrowserController } from './browser.controller';
import { BrowserService } from './browser.service';

/**
 * 内置浏览器（Playwright/Chromium）。
 * 未使用时不会拉起浏览器进程；会话闲置自动回收，服务关闭时全部清理。
 */
@Module({
  controllers: [BrowserController],
  providers: [BrowserService],
  exports: [BrowserService],
})
export class BrowserModule {}
