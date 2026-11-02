import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigConstraint, ConfigHook, ConfigRole, ConfigSnapshot } from '../../types';

/**
 * 配置中心面板行为锁（v1.3）：
 * - 权限档与核心保护项必须可见（核心项任何档位不可改）
 * - 预设一键应用、约束新增强制走 API（不是前端本地假状态）
 * - 注入预览展示后端真实文本（与 AI 调用同一实现）
 * - 导出/粘贴导入入口存在
 * - 权限升档不可选档位置灰（逐级解锁）
 */

const { config } = vi.hoisted(() => ({
  config: {
  snapshot: vi.fn(),
  setPermission: vi.fn(),
  listRoles: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  listConstraints: vi.fn(),
  createConstraint: vi.fn(),
  updateConstraint: vi.fn(),
  deleteConstraint: vi.fn(),
  listHooks: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
  applyPreset: vi.fn(),
  preview: vi.fn(),
  exportBundle: vi.fn(),
  importBundle: vi.fn(),
  },
}));

vi.mock('../../api/client', () => ({ api: { config } }));

import { ConfigCenterSettings } from './ConfigCenterSettings';

const role: ConfigRole = { id: 'r1', name: '数据分析师', systemPrompt: '你是数据分析师', isDefault: 1, enabled: 1, createdAt: 0, updatedAt: 0 };
const constraint: ConfigConstraint = { id: 'c1', title: '引用可溯源', rule: '必须标注来源', level: 'must', scope: 'all', enabled: 1, sortOrder: 0, source: 'seed', createdAt: 0, updatedAt: 0 };
const hook: ConfigHook = { id: 'h1', name: '结尾自检', event: 'chat:before', type: 'prompt_inject', config: '{"text":"自检"}', enabled: 1, priority: 10, createdAt: 0, updatedAt: 0 };

const snapshot: ConfigSnapshot = {
  permission: {
    mode: 'unrestricted',
    modes: [
      { value: 'strict', label: '严格（只读）', description: '只读' },
      { value: 'balanced', label: '均衡', description: '部分' },
      { value: 'open', label: '开放', description: '除核心外' },
      { value: 'unrestricted', label: '全面放开', description: '默认' },
    ],
    coreProtected: [
      { key: 'auth', label: '鉴权与账号', reason: '决定谁能访问' },
      { key: 'secrets', label: '密钥与加密', reason: '不可导出' },
      { key: 'ssrf', label: '出站安全（SSRF）', reason: '保护内网' },
      { key: 'audit', label: '审计日志', reason: '只追加' },
      { key: 'database', label: '数据库路径', reason: '防丢数据' },
      { key: 'network', label: '监听地址与端口', reason: '影响可达性' },
      { key: 'irreversible', label: '不可逆数据操作', reason: '不经配置中心' },
    ],
  },
  roles: [role],
  constraints: [constraint],
  hooks: [hook],
  presets: [{ id: 'academic-rigor', name: '学术严谨型', description: '严谨', constraints: 4, hooks: 1 }],
  audit: [{ id: 'a1', actor: 'chat', category: 'role', action: 'create', target: 'x', detail: '', allowed: 1, reason: '', createdAt: 0 }],
  defaults: 4,
};

describe('配置中心面板', () => {
  beforeEach(() => {
    for (const fn of Object.values(config)) fn.mockReset();
    config.snapshot.mockResolvedValue(snapshot);
    config.applyPreset.mockResolvedValue(snapshot);
    config.createConstraint.mockResolvedValue([constraint]);
    config.preview.mockResolvedValue({ scope: 'chat', text: '【全局约束】引用可溯源', role });
  });

  it('加载快照后显示权限档、7 项核心保护项、角色/约束/钩子', async () => {
    render(<ConfigCenterSettings />);
    expect(await screen.findByText(/配置中心（角色 \/ 约束 \/ 钩子 \/ 权限）/)).toBeTruthy();
    expect(screen.getByText('全面放开')).toBeTruthy();
    for (const c of snapshot.permission.coreProtected) {
      expect(screen.getByText(new RegExp(c.label))).toBeTruthy();
    }
    expect(screen.getByText('数据分析师')).toBeTruthy();
    expect(screen.getByText('引用可溯源')).toBeTruthy();
    expect(screen.getByText(/钩子（生命周期真实执行）/)).toBeTruthy();
  });

  it('预设点击走 applyPreset API', async () => {
    render(<ConfigCenterSettings />);
    await screen.findByText(/配置中心（角色/);
    await userEvent.click(screen.getByRole('button', { name: /学术严谨型/ }));
    await waitFor(() => expect(config.applyPreset).toHaveBeenCalledWith('academic-rigor'));
  });

  it('新增约束调用 createConstraint（后端即刻生效，不是本地假状态）', async () => {
    render(<ConfigCenterSettings />);
    await screen.findByText(/配置中心（角色/);
    await userEvent.type(screen.getByPlaceholderText('约束标题，如：引用可溯源'), '前端测试约束');
    await userEvent.type(screen.getByPlaceholderText('规则内容（会原样注入 system 提示）'), '必须生效');
    await userEvent.click(screen.getByRole('button', { name: /保存约束/ }));
    await waitFor(() => expect(config.createConstraint).toHaveBeenCalledWith(expect.objectContaining({ title: '前端测试约束', rule: '必须生效', level: 'must', scope: 'all' })));
    expect(await screen.findByText(/约束已创建/)).toBeTruthy();
  });

  it('注入预览展示后端返回文本', async () => {
    render(<ConfigCenterSettings />);
    await screen.findByText(/配置中心（角色/);
    await userEvent.click(screen.getByRole('button', { name: /预览 chat 注入/ }));
    await waitFor(() => expect(config.preview).toHaveBeenCalledWith('chat'));
    expect(await screen.findByText(/【全局约束】引用可溯源/)).toBeTruthy();
  });

  it('导出与粘贴导入入口存在', async () => {
    render(<ConfigCenterSettings />);
    await screen.findByText(/配置中心（角色/);
    expect(screen.getByRole('button', { name: /导出 JSON/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /粘贴导入/ }));
    expect(screen.getByPlaceholderText(/粘贴配置包 JSON/)).toBeTruthy();
  });

  it('strict 档下 open/unrestricted 选项置灰（逐级解锁）', async () => {
    config.snapshot.mockResolvedValue({ ...snapshot, permission: { ...snapshot.permission, mode: 'strict' } });
    render(<ConfigCenterSettings />);
    await screen.findByText(/配置中心（角色/);
    const select = document.querySelector('select') as HTMLSelectElement;
    const byValue = (v: string) => Array.from(select.options).find((o) => o.value === v)!;
    expect(byValue('balanced').disabled).toBe(false);
    expect(byValue('open').disabled).toBe(true);
    expect(byValue('unrestricted').disabled).toBe(true);
  });
});
