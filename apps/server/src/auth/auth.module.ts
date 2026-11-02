import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminGuard } from './admin.guard';

/**
 * 企业认证模块（默认旁路，不破坏本地/桌面零登录体验）
 *
 * - AUTH_MODE=none（默认）：JwtAuthGuard 直接放行，全 API 行为与历史一致；
 * - AUTH_MODE=jwt：全局启用 Bearer Token 校验（@Public() 端点除外）。
 *
 * JWT 密钥（安全红线，2026-10 审计发现并修复）：
 *  - AUTH_MODE=jwt 时 JWT_SECRET 必须显式配置且长度 ≥ 32，否则**拒绝启动**。
 *    此前硬编码回退 `sciflow-local-secret-change-me`，任何人都能离线签发
 *    role=admin 的令牌直接通过鉴权（已实测 PoC：伪造 token 返回 200）。
 *  - AUTH_MODE=none（本地单用户）时允许回退到进程内随机密钥：该模式下守卫放行，
 *    密钥不参与任何信任决策，随机值也避免误导用户以为「有默认口令」。
 *
 * v0.3.0：设为 @Global()，并把 JwtModule 标记为 global——
 * agent-trace / web-search 等模块的 controller 直接 @UseGuards(JwtAuthGuard)，
 * 但此前未 import JwtModule，导致启动时 JwtService 依赖无法解析（UnknownDependenciesException）。
 */
/** AUTH_MODE=jwt 的密钥最低强度（32 字符 ≈ 256 bit 熵） */
const MIN_JWT_SECRET_LEN = 32;

/** 解析 JWT 密钥：企业模式强制显式配置；本地模式用进程内随机值 */
function resolveJwtSecret(): string {
  const configured = (process.env.JWT_SECRET || '').trim();
  const authMode = process.env.AUTH_MODE || 'none';
  if (authMode === 'jwt') {
    if (!configured) {
      throw new Error(
        'AUTH_MODE=jwt 必须显式设置 JWT_SECRET（至少 32 字符随机串）。生成方式见 docs/CONFIGURATION.md。',
      );
    }
    if (configured.length < MIN_JWT_SECRET_LEN) {
      throw new Error(
        `[SciFlow] 拒绝启动：JWT_SECRET 长度 ${configured.length} < ${MIN_JWT_SECRET_LEN}，强度不足。请用 32+ 字符随机串。`,
      );
    }
    return configured;
  }
  // 本地/桌面模式：随机密钥（进程重启即失效；守卫不校验任何请求，仅避免默认口令）
  return configured || randomBytes(32).toString('hex');
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      ['secret']: resolveJwtSecret(),
      // JWT_EXPIRES 形如 '7d' / '12h'（ms StringValue）；此处收窄类型，非法值由 jwt 运行时报错
      signOptions: { expiresIn: (process.env.JWT_EXPIRES || '7d') as JwtSignOptions['expiresIn'] },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: JwtAuthGuard }, AdminGuard],
  exports: [JwtModule, AdminGuard],
})
export class AuthModule {}