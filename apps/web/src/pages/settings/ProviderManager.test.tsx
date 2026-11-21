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

import { ProviderManager, canAutoDetect, capabilityHintFor, fmtTokens } from './ProviderManager';

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
    { id: 'test-model', contextWindow: 1_048_576, maxOutput: 131_072, toolCalling: true },
    { id: 'deepseek-v4.1-flash', contextWindow: 1_048_576, maxOutput: 393_216, toolCalling: true },
    { id: 'sciflow-test-minicpm5-2b:latest' },
  ],
};

describe('ProviderManager 纯函数', () => {
  it('canAutoDetect：地址非法或缺 Key（且未保存）时为 false', () => {
    expect(canAutoDetect({ baseUrl: 'not-a-url', apiKey: 'k' })).toBe(false);
    expect(canAutoDetect({ baseUrl: 'https://x/v1', apiKey: '' })).toBe(false);
    expect(canAutoDetect({ baseUrl: 'https://x/v1', apiKey: 'k' })).toBe(true);
    expect(canAutoDetect({ baseUrl: 'https://x/v1', apiKey: '', id: 'p1' })).toBe(true);
    expect(canAutoDetect({ baseUrl: 'http://localhost:11434/v1', apiKey: '' })).toBe(true);
  });

  it('能力回填说明只按真实元数据生成，不夸大自动匹配', () => {
    expect(capabilityHintFor({ id: 'a', contextWindow: 202000, maxOutput: 16000 })).toContain('上下文与输出上限');
    expect(capabilityHintFor({ id: 'b', contextWindow: 16384 })).toContain('未提供最大输出');
    expect(capabilityHintFor({ id: 'c', maxOutput: 4096 })).toContain('未提供上下文');
    expect(capabilityHintFor({ id: 'd' })).toContain('需手动填写');
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
    testProvider.mockResolvedValue({ ok: true, reply: '正常', model: 'test-model', latencyMs: 345 });
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

    const list = await screen.findByText('test-model');
    expect(list).toBeTruthy();
    expect(screen.getByText('glm-5.3')).toBeTruthy();
    expect(screen.queryByText('deepseek-v4.1-flash')).toBeTruthy();
    const modelInput = screen.getByPlaceholderText('从上方列表选择，或手动输入模型名') as HTMLInputElement;
    expect(modelInput.value).toBe('');

    await userEvent.click(screen.getByText('glm-5.3'));
    const cw = screen.getAllByPlaceholderText('0 = 未知')[0];
    expect((cw as HTMLInputElement).value).toBe('202000');
    expect(modelInput.value).toBe('glm-5.3');
  });

  it('本地/内网端点不填 API Key 也能检测模型', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Ollama 本地' }));

    await waitFor(() => expect(discoverModels).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(discoverModels.mock.calls[0][0]).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      privateOk: true,
    });
    expect(await screen.findByText('sciflow-test-minicpm5-2b:latest')).toBeTruthy();
    expect(screen.queryByText(/请先填写 API Key/)).toBeNull();
  });

  it('切换模型时清空上一个模型的能力，不把旧上下文带到新模型', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.type(screen.getByPlaceholderText('https://api.example.com/v1'), 'https://maas-api.example.com/v1');
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'form-secret-key');
    await screen.findByText('glm-5.3');

    await userEvent.click(screen.getByText('glm-5.3'));
    const [cw, mo] = screen.getAllByPlaceholderText('0 = 未知') as HTMLInputElement[];
    expect(cw.value).toBe('202000');
    expect(mo.value).toBe('131072');

    await userEvent.click(screen.getByText('sciflow-test-minicpm5-2b:latest'));
    expect(cw.value).toBe('');
    expect(mo.value).toBe('');
    expect(screen.getByText(/端点未提供能力元数据/)).toBeTruthy();
  });

  it('测试连接使用表单值（不保存），成功结果可见', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.type(screen.getByPlaceholderText('https://api.example.com/v1'), 'https://maas-api.example.com/v1');
    await userEvent.type(screen.getByPlaceholderText('sk-...'), 'form-secret-key');
    await screen.findByText('test-model');
    await userEvent.click(screen.getByText('test-model'));

    await userEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    await waitFor(() => expect(testProvider).toHaveBeenCalledTimes(1));
    expect(testProvider.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://maas-api.example.com/v1', apiKey: 'form-secret-key', model: 'test-model' });
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
    expect(screen.queryByText('test-model')).toBeNull();
  });

  it('常见厂商快捷填充只写地址与协议，不预置模型名', async () => {
    render(<ProviderManager settings={settings} />);
    await userEvent.click(screen.getByRole('button', { name: /添加厂商/ }));
    await userEvent.click(screen.getByRole('button', { name: 'DeepSeek' }));
    expect((screen.getByPlaceholderText('https://api.example.com/v1') as HTMLInputElement).value).toBe('https://api.deepseek.com/v1');
    expect((screen.getByPlaceholderText('从上方列表选择，或手动输入模型名') as HTMLInputElement).value).toBe('');
  });

  it('已保存厂商列表展示协议与能力摘要', async () => {
    const providers: ModelProvider[] = [{
      id: 'p1', name: '自建兼容网关', baseUrl: 'https://gateway.example.com/v1', apiKey: '****abcd', model: 'test-model',
      protocol: 'openai-compatible', contextWindow: 1_048_576, maxOutput: 131_072, toolCalling: 1,
      models: [{ id: 'test-model' }], isActive: 1, createdAt: 0,
    }];
    settingsState.providers = providers;
    try {
      render(<ProviderManager settings={settings} />);
      const row = screen.getByText('自建兼容网关').closest('div')!.parentElement!;
      expect(within(row).getByText('激活中')).toBeTruthy();
      expect(within(row).getByText('OpenAI 兼容')).toBeTruthy();
      expect(within(row).getByText('上下文 1M')).toBeTruthy();
    } finally {
      settingsState.providers = [];
    }
  });
});
