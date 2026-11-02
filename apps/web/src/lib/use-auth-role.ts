import { useEffect, useState } from 'react';
import { api, getToken } from '../api/client';

export type AuthRole = 'loading' | 'none' | 'admin' | 'member';

let cached: AuthRole | null = null;
let inflight: Promise<AuthRole> | null = null;

/**
 * 当前会话的角色（企业模式 UI 用）。
 *
 * 后端 v1.8 起把「实例级配置」收紧为管理员专属（settings / config / extensions /
 * customization / usage / websearch provider / 期刊库写操作）。前端必须知道角色，
 * 否则 member 打开设置页会收到一墙 403 —— 那不是安全，是坏体验。
 *
 * 返回：
 *  - 'none'   ：本地/桌面模式（AUTH_MODE!=jwt），全部功能可用
 *  - 'admin'  ：企业模式管理员
 *  - 'member' ：企业模式普通成员（设置页只读提示）
 */
export async function resolveAuthRole(): Promise<AuthRole> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async (): Promise<AuthRole> => {
    try {
      const h = await api.health();
      if (h.authMode !== 'jwt') return 'none';
      if (!getToken()) return 'member';
      const me = await api.auth.me();
      return me.role === 'admin' ? 'admin' : 'member';
    } catch {
      return 'member';
    } finally {
      inflight = null;
    }
  })();
  cached = await inflight;
  return cached;
}

/** 测试/登出时清缓存 */
export function resetAuthRoleCache() {
  cached = null;
  inflight = null;
}

export function useAuthRole(): AuthRole {
  const [role, setRole] = useState<AuthRole>(cached ?? 'loading');
  useEffect(() => {
    let alive = true;
    void resolveAuthRole().then((r) => { if (alive) setRole(r); });
    return () => { alive = false; };
  }, []);
  return role;
}
