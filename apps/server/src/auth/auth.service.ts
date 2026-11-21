import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db } from '../db/database';
import { users, type User } from '../db/schema';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthPayload {
  sub: string;
  email: string;
  role: string;
}

export function publicUser(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

/** 企业认证服务：注册 / 登录 / 签发与校验 JWT（bcryptjs 哈希，无原生编译依赖） */
@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  private sign(u: User): string {
    const payload: AuthPayload = { sub: u.id, email: u.email, role: u.role || 'member' };
    return this.jwt.sign(payload);
  }

  async register(email: string, password: string, name?: string) {
    const mail = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) throw new BadRequestException('邮箱格式不正确');
    if (typeof password !== 'string' || password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }
    const existing = db.select().from(users).where(eq(users.email, mail)).limit(1).all()[0];
    if (existing) throw new BadRequestException('该邮箱已注册，请直接登录');

    const count = db.select({ id: users.id }).from(users).all().length;

    // 开放注册闸门（安全审计 2026-10）：
    // /api/auth/register 是 @Public()。若对外暴露且允许任意注册，任何人都能自助开账号；
    // 更严重的是「首位注册者自动 admin」——空库时第一个匿名请求就拿到管理员。
    // 策略：
    //  - 空库首次注册 = 初始化管理员，始终允许（否则无法完成首次部署）
    //  - 已有用户后默认关闭注册；确需开放协作时显式 ALLOW_REGISTRATION=1
    const allowOpen = process.env.ALLOW_REGISTRATION === '1';
    if (count > 0 && !allowOpen) {
      throw new ForbiddenException(
        '注册已关闭（已存在用户）。如需开放注册，请设置 ALLOW_REGISTRATION=1 后重启；' +
          '或由管理员在服务端直接创建账号。',
      );
    }
    const role = count === 0 ? 'admin' : 'member'; // 首位用户自动成为管理员
    const row: typeof users.$inferInsert = {
      id: randomUUID(),
      email: mail,
      passwordHash: await bcrypt.hash(password, 10),
      name: String(name || mail.split('@')[0]).slice(0, 60),
      role,
      createdAt: Date.now(),
    };
    const [created] = db.insert(users).values(row).returning().all();
    return { token: this.sign(created), user: publicUser(created) };
  }

  async login(email: string, password: string) {
    const mail = String(email || '').trim().toLowerCase();
    const u = db.select().from(users).where(eq(users.email, mail)).limit(1).all()[0];
    if (!u) throw new UnauthorizedException('邮箱或密码不正确');
    const ok = await bcrypt.compare(String(password || ''), u.passwordHash);
    if (!ok) throw new UnauthorizedException('邮箱或密码不正确');
    return { token: this.sign(u), user: publicUser(u) };
  }

  me(payload?: AuthPayload) {
    // AUTH_MODE=none 时全局守卫直接放行、不会注入 req.user；此时 /auth/me 应明确 401，
    // 而不是读 undefined.sub 抛 500（本地模式没有登录态是正常状态，不是服务器故障）。
    if (!payload?.sub) throw new UnauthorizedException('未登录：当前实例未启用账号体系');
    const u = db.select().from(users).where(eq(users.id, payload.sub)).limit(1).all()[0];
    if (!u) throw new UnauthorizedException('用户不存在或已被移除');
    return publicUser(u);
  }
}
