import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * 鉴权面护栏（静态契约测试）
 *
 * 背景（2026-10-20 审计）：agent-trace / websearch 两个 controller 同时写了
 * 类级 `@UseGuards(JwtAuthGuard)` 与方法级 `@Public()`。`@Public()` 会被全局
 * JwtAuthGuard 读取并直接放行 —— 等于在 AUTH_MODE=jwt 下把执行轨迹、prompt、
 * token 用量、搜索配置完全对外开放，而类级守卫看起来"已经保护"了它，极易漏审。
 *
 * 因此把「哪些 controller 允许出现 @Public()」固化为契约：
 * 只允许 auth（登录/注册）与 health（探活）。
 */

const SRC = path.resolve(__dirname, '..');

function collectControllers(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectControllers(full, acc);
    } else if (entry.name.endsWith('.controller.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const ALLOWED = new Set(['auth.controller.ts', 'health.controller.ts']);

describe('鉴权面契约：@Public() 白名单', () => {
  const controllers = collectControllers(SRC);

  it('至少扫描到全部 controller（防止 glob 失效导致空跑通过）', () => {
    expect(controllers.length).toBeGreaterThanOrEqual(18);
  });

  it('除 auth / health 外，任何 controller 都不得标注 @Public()', () => {
    const violations: string[] = [];
    for (const file of controllers) {
      const name = path.basename(file);
      if (ALLOWED.has(name)) continue;
      const text = readFileSync(file, 'utf-8');
      if (text.includes('@Public()')) violations.push(path.relative(SRC, file));
    }
    expect(violations, `以下 controller 在鉴权模式下会被 @Public() 绕过：${violations.join(', ')}`).toEqual([]);
  });

  it('agent-trace 与 websearch 的每个端点都受类级守卫保护（不再有 Public 标注）', () => {
    for (const name of ['agent/agent-trace.controller.ts', 'websearch/websearch.controller.ts']) {
      const text = readFileSync(path.join(SRC, name), 'utf-8');
      expect(text).toMatch(/@UseGuards\(JwtAuthGuard/);
      expect(text).not.toContain('@Public()');
    }
  });

  /**
   * v1.8 契约：实例级配置控制器必须挂 AdminGuard。
   *
   * 这些端点改的是「整台实例」的东西（模型 Key / baseURL / 权限档 / 注入钩子 /
   * 扩展资产 / 用量 / 联网 provider Key / 全局期刊库）。企业模式下若只要求登录，
   * 任一 member 改 baseURL 即可把全实例请求（含他人稿件）引到自己的服务器。
   * 本地模式 AdminGuard 直接放行，零登录体验不变。
   */
  it('实例级配置控制器必须挂 AdminGuard（企业模式仅管理员）', () => {
    const must: { file: string; why: string }[] = [
      { file: 'settings/settings.controller.ts', why: '模型厂商/Key/baseURL/连接测试' },
      { file: 'config/config.controller.ts', why: '权限档/角色/约束/钩子/预设/审计' },
      { file: 'extensions/extensions.controller.ts', why: '内置资产启停（影响注入面）' },
      { file: 'settings/customization.controller.ts', why: '意图/步骤开关/质量权重/提示词' },
      { file: 'settings/usage.controller.ts', why: '全实例成本聚合（含他人消耗）' },
      { file: 'websearch/websearch.controller.ts', why: '联网 provider Key' },
    ];
    const violations: string[] = [];
    for (const { file, why } of must) {
      const text = readFileSync(path.join(SRC, file), 'utf-8');
      if (!text.includes('AdminGuard')) violations.push(`${file}（${why}）`);
    }
    expect(violations, `以下实例级配置控制器未挂 AdminGuard：${violations.join('; ')}`).toEqual([]);
  });

  it('AdminGuard 在本地模式放行、企业模式仅 admin（语义锁定）', async () => {
    const { AdminGuard } = await import('./admin.guard');
    const guard = new AdminGuard();
    const ctx = (user?: { role?: string }) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as never;
    const old = process.env.AUTH_MODE;
    try {
      process.env.AUTH_MODE = 'none';
      expect(guard.canActivate(ctx(undefined))).toBe(true);
      process.env.AUTH_MODE = 'jwt';
      expect(guard.canActivate(ctx({ role: 'admin' }))).toBe(true);
      expect(() => guard.canActivate(ctx({ role: 'member' }))).toThrow(/仅管理员/);
      expect(() => guard.canActivate(ctx(undefined))).toThrow(/仅管理员/);
    } finally {
      if (old === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = old;
    }
  });
});
