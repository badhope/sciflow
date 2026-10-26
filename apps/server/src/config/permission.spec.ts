import { describe, expect, it } from 'vitest';
import { CORE_PROTECTED, decidePermission, isCoreProtected, normalizePermissionMode } from './permission';

/**
 * 权限矩阵行为锁：全面放开 = 除核心保护项外全可改；档位越高放行越多；
 * 未知档位回落 unrestricted（本地单用户默认），核心项判定与档位无关。
 */
describe('权限矩阵', () => {
  it('strict 全部只读', () => {
    for (const c of ['role', 'constraint', 'hook', 'prompt', 'provider', 'websearch', 'permission'] as const) {
      expect(decidePermission('strict', c).allowed, c).toBe(false);
    }
  });

  it('balanced 只放行角色/约束/钩子/提示词/技能', () => {
    for (const c of ['role', 'constraint', 'hook', 'prompt', 'skill'] as const) {
      expect(decidePermission('balanced', c).allowed, c).toBe(true);
    }
    for (const c of ['intent', 'pipeline', 'quality', 'judgment', 'provider', 'websearch', 'permission'] as const) {
      expect(decidePermission('balanced', c).allowed, c).toBe(false);
    }
  });

  it('open 放行除核心外的全部受管类别', () => {
    for (const c of ['role', 'provider', 'websearch', 'permission'] as const) {
      expect(decidePermission('open', c).allowed, c).toBe(true);
    }
  });

  it('unrestricted（全面放开）全部受管类别可写', () => {
    for (const c of ['role', 'constraint', 'hook', 'prompt', 'skill', 'intent', 'pipeline', 'quality', 'judgment', 'provider', 'websearch', 'permission'] as const) {
      expect(decidePermission('unrestricted', c).allowed, c).toBe(true);
    }
  });

  it('拒绝原因可读（用于 UI/CLI 原样展示）', () => {
    const d = decidePermission('balanced', 'provider');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('均衡');
  });

  it('未知档位回落 unrestricted；核心保护项清单覆盖鉴权/密钥/SSRF/审计/数据库/端口/不可逆', () => {
    expect(normalizePermissionMode(undefined)).toBe('unrestricted');
    expect(normalizePermissionMode('whatever')).toBe('unrestricted');
    expect(normalizePermissionMode('strict')).toBe('strict');
    for (const k of ['auth', 'secrets', 'ssrf', 'audit', 'database', 'network', 'irreversible']) {
      expect(isCoreProtected(k), k).toBe(true);
    }
    expect(CORE_PROTECTED.length).toBeGreaterThanOrEqual(7);
    expect(isCoreProtected('role')).toBe(false);
  });
});
