import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionAsset, ExtensionKindsResponse } from '../../types';

/**
 * 扩展中心面板行为锁（v1.4）：
 * - 内置资产默认全启用、按 kind 过滤、私有工具可隐藏
 * - 四种添加入口（手填/粘贴/上传/一键生成）都走真实 API
 * - 停用/恢复内置/导出 都调后端（不是本地假状态）
 */

const { ext } = vi.hoisted(() => ({
  ext: {
    list: vi.fn(),
    create: vi.fn(),
    toggle: vi.fn(),
    apply: vi.fn(),
    remove: vi.fn(),
    resetBuiltin: vi.fn(),
    importRaw: vi.fn(),
    upload: vi.fn(),
    generate: vi.fn(),
    exportBundle: vi.fn(),
  },
}));
vi.mock('../../api/client', () => ({ api: { extensions: ext } }));

import { AddAssetPanel, ExtensionCenter } from './ExtensionCenter';

const asset = (over: Record<string, unknown> = {}): ExtensionAsset => ({
  id: 'a1', key: 'skill-demo', kind: 'skill', name: '示例技能', description: '说明',
  source: 'builtin-public', repo: 'x/y', license: 'MIT', install: '', tags: '[]', manifest: '{}',
  enabled: 1, visibility: 'public', createdAt: 0, updatedAt: 0, ...over,
}) as ExtensionAsset;

const payload: ExtensionKindsResponse = {
  kinds: [
    { value: 'skill', label: '技能 Skills', description: '说明', total: 3, enabled: 3 },
    { value: 'mcp', label: 'MCP 服务器', description: '说明', total: 2, enabled: 2 },
    { value: 'role', label: '角色 Roles', description: '', total: 1, enabled: 1 },
    { value: 'constraint', label: '约束 Constraints', description: '', total: 1, enabled: 1 },
    { value: 'hook', label: '钩子 Hooks', description: '', total: 1, enabled: 1 },
    { value: 'prompt', label: '提示词模板 Prompts', description: '', total: 1, enabled: 1 },
  ],
  assets: [
    asset({ id: 'a1', key: 'skill-demo', name: '示例技能' }),
    asset({ id: 'a2', key: 'sci-private-audit', kind: 'skill', name: 'SciFlow 引用体检', source: 'builtin-private', visibility: 'private' }),
    asset({ id: 'a3', key: 'mcp-context7', kind: 'mcp', name: 'Context7（库文档检索）' }),
  ],
  templates: [
    { kind: 'skill', fields: [], jsonExample: { kind: 'skill', name: '示例技能', manifest: { mode: 'prompt', instructions: '正文' } } },
    { kind: 'mcp', fields: [], jsonExample: { kind: 'mcp', name: '示例 MCP', manifest: { transport: 'http', url: 'https://x.example/mcp' } } },
  ],
};

describe('ExtensionCenter', () => {
  beforeEach(() => {
    for (const fn of Object.values(ext)) fn.mockReset();
    ext.list.mockResolvedValue(payload);
    ext.toggle.mockResolvedValue({ ...asset(), enabled: 0 });
    ext.resetBuiltin.mockResolvedValue({ restored: 3 });
    ext.importRaw.mockResolvedValue({ added: 1, updated: 0, assets: [], errors: [] });
  });

  it('渲染内置数量、分类计数与私有标记；默认只显示当前 kind', async () => {
    render(<ExtensionCenter />);
    expect(await screen.findByText(/扩展中心（内置 3 项/)).toBeTruthy();
    expect(screen.getByText('示例技能')).toBeTruthy();
    expect(screen.getByText('内置·开源')).toBeTruthy();
    expect(screen.getByText('SciFlow 引用体检')).toBeTruthy(); // 默认显示私有
    expect(screen.queryByText('Context7（库文档检索）')).toBeNull(); // 非当前分类
  });

  it('取消勾选「显示私有优势工具」后隐藏 private', async () => {
    render(<ExtensionCenter />);
    await screen.findByText(/扩展中心（内置/);
    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.queryByText('SciFlow 引用体检')).toBeNull());
    expect(screen.getByText('示例技能')).toBeTruthy();
  });

  it('切换分类只显示该 kind 资产', async () => {
    render(<ExtensionCenter />);
    await screen.findByText(/扩展中心（内置/);
    await userEvent.click(screen.getByRole('button', { name: /MCP 服务器/ }));
    expect(await screen.findByText('Context7（库文档检索）')).toBeTruthy();
    expect(screen.queryByText('示例技能')).toBeNull();
  });

  it('停用与恢复内置都调用后端', async () => {
    render(<ExtensionCenter />);
    await screen.findByText(/扩展中心（内置/);
    const btns = screen.getAllByRole('button', { name: '停用' });
    await userEvent.click(btns[0]);
    await waitFor(() => expect(ext.toggle).toHaveBeenCalledWith('a1', false));
    await userEvent.click(screen.getByRole('button', { name: /恢复内置/ }));
    await waitFor(() => expect(ext.resetBuiltin).toHaveBeenCalled());
  });

  it('导出调用 exportBundle', async () => {
    ext.exportBundle.mockResolvedValue({ version: 1, assets: [] });
    render(<ExtensionCenter />);
    await screen.findByText(/扩展中心（内置/);
    await userEvent.click(screen.getByRole('button', { name: /导出/ }));
    await waitFor(() => expect(ext.exportBundle).toHaveBeenCalled());
  });

  it('添加资产面板：四个模式按钮齐全', async () => {
    render(<ExtensionCenter />);
    await screen.findByText(/扩展中心（内置/);
    await userEvent.click(screen.getByRole('button', { name: /添加资产/ }));
    for (const label of ['① 手填', '② 粘贴 JSON/MD', '③ 上传文件/压缩包', '④ 一键 AI 生成']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });
});

describe('AddAssetPanel', () => {
  beforeEach(() => {
    for (const fn of Object.values(ext)) fn.mockReset();
    ext.importRaw.mockResolvedValue({ added: 1, updated: 0, assets: [], errors: [] });
    ext.create.mockResolvedValue(asset());
    ext.generate.mockResolvedValue({ draft: { kind: 'skill', name: 'AI 技能', manifest: { mode: 'prompt', instructions: 'x' } }, raw: '{}' });
  });

  it('手填：create 收到 kind/name/manifest', async () => {
    const onDone = vi.fn();
    render(<AddAssetPanel kind="skill" templates={payload.templates} onDone={onDone} />);
    await userEvent.type(screen.getByPlaceholderText('名称（必填）'), '手填技能');
    await userEvent.type(screen.getByPlaceholderText('一句话描述'), '说明文案');
    await userEvent.click(screen.getByRole('button', { name: /保存并启用/ }));
    await waitFor(() => expect(ext.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'skill', name: '手填技能' })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('粘贴：importRaw 收到文本内容', async () => {
    render(<AddAssetPanel kind="skill" templates={payload.templates} onDone={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: '② 粘贴 JSON/MD' }));
    const ta = screen.getByRole('textbox');
    // userEvent.type 会把 {} 当按键语法；fireEvent.change 直接赋值（等价用户粘贴结果）
    fireEvent.change(ta, { target: { value: '{"kind":"skill","name":"粘贴技能","manifest":{}}' } });
    await userEvent.click(screen.getByRole('button', { name: /导入/ }));
    await waitFor(() => expect(ext.importRaw).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('粘贴技能') })));
  });

  it('一键生成：generate 收到 kind 与需求，草稿可保存', async () => {
    render(<AddAssetPanel kind="skill" templates={payload.templates} onDone={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: '④ 一键 AI 生成' }));
    await userEvent.type(screen.getByPlaceholderText(/用一两句话描述你想要的工具/), '做一个审稿回复技能');
    await userEvent.click(screen.getByRole('button', { name: /一键生成/ }));
    await waitFor(() => expect(ext.generate).toHaveBeenCalledWith('skill', '做一个审稿回复技能'));
    expect(await screen.findByRole('button', { name: '保存草稿' })).toBeTruthy();
  });

  it('上传：选择文件后调用 upload', async () => {
    const onDone = vi.fn();
    render(<AddAssetPanel kind="skill" templates={payload.templates} onDone={onDone} />);
    await userEvent.click(screen.getByRole('button', { name: '③ 上传文件/压缩包' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['---\nname: x\n---\nbody'], 'SKILL.md', { type: 'text/markdown' });
    ext.upload.mockResolvedValue({ added: 1, updated: 0, assets: [], errors: [] });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(ext.upload).toHaveBeenCalledWith(file));
  });

  it('导入错误原样展示（字段级定位）', async () => {
    ext.importRaw.mockRejectedValue(new Error('未知 kind「bad」，可选：skill / mcp'));
    render(<AddAssetPanel kind="skill" templates={payload.templates} onDone={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: '② 粘贴 JSON/MD' }));
    const ta2 = screen.getByRole('textbox');
    fireEvent.change(ta2, { target: { value: '{"kind":"bad"}' } });
    await userEvent.click(screen.getByRole('button', { name: /导入/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
