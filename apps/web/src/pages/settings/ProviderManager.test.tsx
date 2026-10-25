import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, ModelProvider } from '../../types';

/**
 * 厂商设置界面行为锁（设置页自定义连接）：
 * - 填写地址 + Key 后自动检测模型（不用再手填模型名）
 * - 检测结果展开为可选列表，选中即回填上下文/输出上限/工具调用
 * - 「测试连接」用表单当前值调用，不保存
 * - 常见厂商预置只给地址与协议，不预置模型名
 */

const discoverModels = vi.fn();
const testProvider = vi.fn();
const saveProvider = vi.fn();

vi.mock('../../api/client', () => ({
  api: {
    settings: {
      discoverModels: (...args: unknown[]) => discoverModels(...args),
      testProvider: (...args: unknown[]) => testProvider(...args),
      saveProvider: (...args: unknown[]) => saveProvider(...args),
    },
  },
}));

const settingsState = {
  providers: [] as ModelProvider[],
  saveProvider,
  activateProvider: vi.fn(),
  removeProvider: vi.fn(),
};

vi.mock('./settings-context', () => ({
  useSettings: () => ({
    state: { providers: settingsState.providers },
    saveProvider: settingsState.saveProvider,
    activateProvider: settingsState.activateProvider,
    removeProvider: settingsState.removeProvider,
  }),
}));

import { ProviderManager, canAutoDetect, fmtTokens, pickDefaultModel } from './ProviderManager';

const settings: AppSettings = {
  ai: {
    baseUrl: 'https://env.invalid/v1', model: 'env-model', fastModel: 'env-model', strongModel: 'env-model',
    configured: true, models: [], protocol: 'openai-compatible', contextWindow: 0, maxOutput: 0, toolCalling: true,
  },
  env: { node: 'v20', database: '/tmp/x.db', port: 3000 },
  sources: { literature: [] },
};

const modelsPayload = {
  ok: true,
  models: [
    { id: 'glm-5.3', contextWindow: 202_000, maxOutput: 131_072, toolCalling: true },
    { id: 'u2-flash', contextWindow: 1_048_576, maxOutput: 131_072, toolCalling: true },
    { id: 'deepseek-v4.1-flash', contextWindow: 1_048_576, maxOutput: 393_216, toolCalling: true },
  ],
};

describe('ProviderManager 纯函数', () => {
  it('canAutoDetect：地址非法或缺 Key（且未保存）时为 false', () => {
    expect(canAutoDetect({ baseUrl: 'not-a-url', apiKey: 'k' })).toBe(false);
    expect(canAutoDetect({ baseUrl: 'https://x/v1', apiKey: '' })).toBe(false);
    expect(canAutoDetect({ baseUrl: 'https://x/v1', apiKey: 'k' })).toBe(true);
    expect(canAutoDetect({ baseUrl: 'https://x/v1', apiKey: '', id: 'p1' })).toBe(true);
  });

  it('pickDefaultModel 优先轻量档，否则第一个', () => {
    expect(pickDefaultModel([{ id: 'big-model' }, { id: 'u2-flash' }])?.id).toBe('u2-flash');
    expect(pickDefaultModel([{ id: 'big-model' }])?.id).toBe('big-model');
    expect(pickDefaultModel([])).toBeUndefined();
  });

  it('fmtTokens 人类可读且未知为「未知」', () => {
    expect(fmtTokens(0)).toBe('未知');
    expect(fmtTokens(1_048_576)).toBe('1M');
    expect(fmtTokens(202_000)).toBe('202K');
    expect(fmtTokens(512)).toBe('512');
  });
});

describe('ProviderManager 界面流程', () => {
  beforeEach(() => {
    discoverModels.mockReset();
    testProvider.mockReset();
    saveProvider.mockReset();
    discoverModels.mockResolvedValue(modelsPayload);
    testProvider.mockResolvedValue({ ok: true, reply: '正常', model: 'u2-flash', latencyMs: 345 });
  });

  it('填入地址与 Key 后自动检测模型并展开可选列表，选中回填能力', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));

    await userEvent.type(screen.getByPlaceholderText('https://api.example.com/v1'), 'https://maas-api.example.com/v1');
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'form-secret-key');

    await waitFor(() => expect(discoverModels).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(discoverModels.mock.calls[0][0]).toMatchObject({
      baseUrl: 'https://maas-api.example.com/v1',
      apiKey: 'form-secret-key',
      protocol: 'openai-compatible',
    });

    const list = await screen.findByText('u2-flash');
    expect(list).toBeTruthy();
    expect(screen.getByText('glm-5.3')).toBeTruthy();
    expect(screen.queryByText('deepseek-v4.1-flash')).toBeTruthy();

    await userEvent.click(screen.getByText('glm-5.3'));
    const cw = screen.getAllByPlaceholderText('0 = 未知')[0];
    expect((cw as HTMLInputElement).value).toBe('202000');
    const modelInput = screen.getByPlaceholderText('从上方列表选择，或手动输入模型名') as HTMLInputElement;
    expect(modelInput.value).toBe('glm-5.3');
  });

  it('测试连接使用表单值（不保存），成功结果可见', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.type(screen.getByPlaceholderText('https://api.example.com/v1'), 'https://maas-api.example.com/v1');
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'form-secret-key');
    await screen.findByText('u2-flash');

    await userEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(testProvider).toHaveBeenCalledTimes(1));
    expect(testProvider.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://maas-api.example.com/v1', apiKey: 'form-secret-key', model: 'u2-flash' });
    expect(await screen.findByText(/连接成功|345ms|正常/)).toBeTruthy();
    expect(saveProvider).not.toHaveBeenCalled();
  });

  it('检测失败展示可读错误且不伪造模型', async () => {
    discoverModels.mockResolvedValue({ ok: false, models: [], error: '模型列表请求失败（HTTP 401）：denied' });
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.type(screen.getByPlaceholderText('https://api.example.com/v1'), 'https://maas-api.example.com/v1');
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'bad-key');
    expect(await screen.findByText(/HTTP 401/)).toBeTruthy();
    expect(screen.queryByText('u2-flash')).toBeNull();
  });

  it('常见厂商快捷填充只写地址与协议，不预置模型名', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.click(screen.getByRole('button', { name: 'UniSound MaaS' }));
    expect((screen.getByPlaceholderText('https://api.example.com/v1') as HTMLInputElement).value).toBe('https://maas-api.unisound.com/v1');
    expect((screen.getByPlaceholderText('从上方列表选择，或手动输入模型名') as HTMLInputElement).value).toBe('');
  });

  it('已保存厂商列表展示协议与能力摘要', async () => {
    const providers: ModelProvider[] = [{
      id: 'p1', name: 'UniSound', baseUrl: 'https://maas-api.unisound.com/v1', apiKey: '****abcd', model: 'u2-flash',
      protocol: 'openai-compatible', contextWindow: 1_048_576, maxOutput: 131_072, toolCalling: 1,
      models: [{ id: 'u2-flash' }], isActive: 1, createdAt: 0,
    }];
    settingsState.providers = providers;
    try {
      render(<ProviderManager settings={settings} />);
      const row = screen.getByText('UniSound').closest('div')!.parentElement!;
      expect(within(row).getByText('激活中')).toBeTruthy();
      expect(within(row).getByText('OpenAI 兼容')).toBeTruthy();
      expect(within(row).getByText('上下文 1M')).toBeTruthy();
    } finally {
      settingsState.providers = [];
    }
  });
});
