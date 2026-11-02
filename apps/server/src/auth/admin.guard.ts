import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * 实例级配置守卫（v1.8）。
 *
 * 与 JwtAuthGuard 的分工：
 *  - JwtAuthGuard：**是否登录**（企业模式全站生效，本地模式全放行）
 *  - AdminGuard  ：**是否是管理员**（只挂在实例级配置面上：模型 Key / 权限档 / 钩子 /
 *    扩展资产 / 用量 / 联网 provider / 期刊库写操作）
 *
 * 为什么不能用项目归属表达：这些配置不属于任何项目，改一次影响全实例所有账号
 * （例如改 baseURL 就能把他人稿件的请求引到自己的服务器）。因此必须按角色判定。
 *
 * 本地模式（AUTH_MODE!=jwt）直接放行：单用户桌面/本地部署没有角色概念，
 * 保持零登录体验不变（与 ProjectAccessService 同一策略）。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if ((process.env.AUTH_MODE || 'none') !== 'jwt') return true;
    const req = context.switchToHttp().getRequest();
    const role = String(req?.user?.role || '');
    if (role !== 'admin') {
      throw new ForbiddenException('该操作会修改实例级全局配置，仅管理员可执行');
    }
    return true;
  }
}
