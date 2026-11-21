import { expect, test } from '@playwright/test';

/**
 * 真实 Ollama 的「本地模型下载中心」端到端：
 * 只验证已下载模型的一键导入 / provider 登记但不自动激活 / 上下文口径，不重复下载 600MB。
 * 前置同 real-chat.spec.ts：真实后端 + 真实 Ollama + 已下载 MiniCPM5-1B。
 */
const REAL = process.env.E2E_REAL === '1';
test.skip(!REAL, 'E2E_REAL!=1：真实 Ollama 规格跳过');

test('设置页 → 本地模型 → 导入 Ollama 但不自动切换', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/#/settings');
  await expect(page.locator('#root')).toBeVisible({ timeout: 30_000 });

  const entry = page.getByRole('button', { name: /本地模型/ }).first();
  if (await entry.isVisible().catch(() => false)) await entry.click();

  const card = page.locator('div').filter({ hasText: /^MiniCPM5-1B/ }).first();
  await expect(page.getByText('MiniCPM5-1B', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('原生上下文 128K')).toBeVisible();
  await expect(page.getByText('本地运行 16K').first()).toBeVisible();

  const install = page.getByRole('button', { name: /导入 Ollama（不切换）/ }).first();
  await expect(install).toBeEnabled({ timeout: 30_000 });
  await install.click();
  await expect(page.getByText(/Ollama 模型：sciflow-minicpm5-1b · 已导入，未自动切换/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('已建厂商：本地 · MiniCPM5-1B')).toBeVisible({ timeout: 10_000 });
  void card;
});
