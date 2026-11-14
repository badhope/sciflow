import { expect, test } from '@playwright/test';

/**
 * Web 沙箱页真实交互：建项目 → 一键跑通（安装/构建/预览） → iframe 里出现真实页面。
 *
 * 用 mock 模型后端即可（与 AI 无关），默认 static 模板零依赖，构建秒级完成。
 */
test('Web 沙箱：建项目 → 一键跑通 → 预览渲染', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#/websandbox');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

  const name = `e2e-web-${Date.now()}`;
  await page.getByLabel('项目名').fill(name);
  // 侧栏也有「新建项目」全局按钮：限定在 main 内，避免 strict mode 命中多个
  await page.locator('main').getByRole('button', { name: '新建项目' }).click();

  // 创建后出现操作按钮
  await expect(page.getByRole('button', { name: '一键跑通' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '一键跑通' }).click();

  // 预览 iframe 出现，并且里面真的渲染出了项目名
  const frame = page.frameLocator('iframe[title="Web 项目预览"]');
  await expect(frame.locator('h1')).toHaveText(name, { timeout: 120_000 });

  // 页面内的按钮可点（证明预览是真页面，不是静态图片）
  await frame.getByRole('button', { name: '点我' }).click();
  await expect(frame.locator('#out')).toContainText('已点击', { timeout: 10_000 });
});
