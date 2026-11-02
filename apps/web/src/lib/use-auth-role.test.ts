import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * 角色解析契约（v1.8）。
 *
 * 为什么必须测：后端把实例级配置收紧为 admin 专属后，前端若把 member 误判成 admin，
 * 用户会吃一墙 403；若把 admin 误判成 member，管理员反而看不到配置页。
 * 这个模块还带模块级缓存（cached/inflight），缓存语义错了会导致登出后仍显示 admin。
 */

const health = vi.fn();
const me = vi.fn();
let token: string | null = null;

vi.mock('../api/client', () => ({
  api: {
    health: () => health(),
    auth: { me: () => me() },
  },
  getToken: () => token,
}));

const load = () => import('./use-auth-role');

describe('resolveAuthRole：会话角色判定', () => {
  beforeEach(async () => {
    health.mockReset(); me.mockReset(); token = null;
    const m = await load();
    m.resetAuthRoleCache();
  });

  it('本地模式（authMode != jwt）→ none，且不请求 /auth/me', async () => {
    health.mockResolvedValue({ authMode: 'none' });
    const { resolveAuthRole } = await load();
    await expect(resolveAuthRole()).resolves.toBe('none');
    expect(me).not.toHaveBeenCalled();
  });

  it('企业模式且有 token、role=admin → admin', async () => {
    health.mockResolvedValue({ authMode: 'jwt' });
    me.mockResolvedValue({ id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', createdAt: 0 });
    token = 'tk';
    const { resolveAuthRole } = await load();
    await expect(resolveAuthRole()).resolves.toBe('admin');
  });

  it('企业模式但 role=member → member', async () => {
    health.mockResolvedValue({ authMode: 'jwt' });
    me.mockResolvedValue({ id: 'u2', email: 'm@b.c', name: 'M', role: 'member', createdAt: 0 });
    token = 'tk';
    const { resolveAuthRole } = await load();
    await expect(resolveAuthRole()).resolves.toBe('member');
  });

  it('企业模式但无 token → member（不白屏、不发 me 请求）', async () => {
    health.mockResolvedValue({ authMode: 'jwt' });
    token = null;
    const { resolveAuthRole } = await load();
    await expect(resolveAuthRole()).resolves.toBe('member');
    expect(me).not.toHaveBeenCalled();
  });

  it('接口异常 → member（fail-closed：宁可按普通成员处理，不误升权）', async () => {
    health.mockRejectedValue(new Error('network down'));
    const { resolveAuthRole } = await load();
    await expect(resolveAuthRole()).resolves.toBe('member');
  });

  it('并发调用只打一次接口（inflight 去重）', async () => {
    health.mockResolvedValue({ authMode: 'jwt' });
    me.mockResolvedValue({ id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', createdAt: 0 });
    token = 'tk';
    const { resolveAuthRole } = await load();
    const [a, b] = await Promise.all([resolveAuthRole(), resolveAuthRole()]);
    expect(a).toBe('admin'); expect(b).toBe('admin');
    expect(health).toHaveBeenCalledTimes(1);
  });

  it('结果缓存；resetAuthRoleCache 后重新解析（登出/换号不残留）', async () => {
    health.mockResolvedValue({ authMode: 'jwt' });
    me.mockResolvedValue({ id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', createdAt: 0 });
    token = 'tk';
    const m = await load();
    await expect(m.resolveAuthRole()).resolves.toBe('admin');
    await expect(m.resolveAuthRole()).resolves.toBe('admin');
    expect(health).toHaveBeenCalledTimes(1);
    m.resetAuthRoleCache();
    me.mockResolvedValue({ id: 'u2', email: 'm@b.c', name: 'M', role: 'member', createdAt: 0 });
    await expect(m.resolveAuthRole()).resolves.toBe('member');
    expect(health).toHaveBeenCalledTimes(2);
  });

  it('useAuthRole：初始 loading，解析后返回实际角色', async () => {
    health.mockResolvedValue({ authMode: 'jwt' });
    me.mockResolvedValue({ id: 'u1', email: 'a@b.c', name: 'A', role: 'admin', createdAt: 0 });
    token = 'tk';
    const { useAuthRole } = await load();
    const { result } = renderHook(() => useAuthRole());
    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).toBe('admin'));
  });
});