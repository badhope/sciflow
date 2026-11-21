import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 注册（首位注册用户自动 admin） */
  @Public()
  @Post('register')
  register(@Body() body: { email: string; password: string; name?: string }) {
    return this.auth.register(body?.email, body?.password, body?.name);
  }

  /** 登录（返回 JWT + 用户信息，有效期 JWT_EXPIRES 默认 7d） */
  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body?.email, body?.password);
  }

  /** 当前用户（req.user 由全局 JwtAuthGuard 注入） */
  @Get('me')
  me(@Req() req: { user?: import('./auth.service').AuthPayload }) {
    return this.auth.me(req.user);
  }
}
