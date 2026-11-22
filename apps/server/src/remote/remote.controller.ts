import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Headers,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RemoteAccessService } from './remote-access.service';
import { RemoteAccessStatusDto } from './remote.dto';

/**
 * 远程控制控制面。
 *
 * 只允许桌面端通过回环地址调用；网关转发来的请求带 x-sciflow-remote-gateway 头，一律拒绝。
 * 这样手机即使拿到配对 Cookie，也不能自己停掉/刷新/重开网关。
 */
@ApiTags('remote')
@Controller('remote')
export class RemoteController {
  constructor(private readonly remote: RemoteAccessService) {}

  @Get('status')
  @ApiOperation({ summary: '读取远程控制网关状态' })
  @ApiOkResponse({ type: RemoteAccessStatusDto })
  status(@Req() req: Request, @Headers('x-sciflow-remote-gateway') gateway?: string) {
    this.assertDesktopCaller(req, gateway);
    return this.remote.status();
  }

  @Post('start')
  @ApiOperation({ summary: '启动远程控制网关（幂等）' })
  @ApiOkResponse({ type: RemoteAccessStatusDto })
  start(@Req() req: Request, @Headers('x-sciflow-remote-gateway') gateway?: string) {
    this.assertDesktopCaller(req, gateway);
    return this.remote.start();
  }

  @Post('refresh')
  @ApiOperation({ summary: '刷新一次性二维码，旧链接与旧手机会话立即失效' })
  @ApiOkResponse({ type: RemoteAccessStatusDto })
  refresh(@Req() req: Request, @Headers('x-sciflow-remote-gateway') gateway?: string) {
    this.assertDesktopCaller(req, gateway);
    return this.remote.refresh();
  }

  @Post('stop')
  @ApiOperation({ summary: '停止远程控制网关并吊销当前手机会话' })
  @ApiOkResponse({ type: RemoteAccessStatusDto })
  stop(@Req() req: Request, @Headers('x-sciflow-remote-gateway') gateway?: string) {
    this.assertDesktopCaller(req, gateway);
    return this.remote.stop();
  }

  private assertDesktopCaller(req: Request, gateway?: string): void {
    if (gateway) throw new ForbiddenException('远程端不能操作远控网关本身');
    const address = req.socket.remoteAddress || '';
    const loopback =
      address === '127.0.0.1' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1' ||
      address === 'localhost';
    if (!loopback) {
      throw new ForbiddenException('远程控制只能从桌面端本机开启或停止');
    }
  }
}
