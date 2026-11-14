import { expect, test } from '@playwright/test';

/**
 * 长篇写作页真实交互：建书 → 生成章节计划 → 写一章 → 看到章节落库。
 *
 * 用 mock 模型（AI_MOCK=1）跑，只验证「页面按钮真的接通后端」，
 * 不验证正文质量（质量由真实模型的长任务验收单独覆盖）。
 */
test('长篇写作：建书 → 生成计划 → 写一章 → 章节出现', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#/longform');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

  const bookName = `E2E 长篇 ${Date.now()}`;
  await page.getByLabel('书名').fill(bookName);
  await page.getByLabel('核心设定').fill('一名档案员追查失踪船只的记录');
  await page.getByRole('button', { name: '新建书籍' }).click();

  // 书籍创建后出现卷表单
  await expect(page.getByLabel('卷标题')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('卷标题').fill('第一卷 抵达');
  await page.getByLabel('章数').fill('2');
  await page.getByRole('button', { name: '生成章节计划' }).click();

  // 章节计划落库：出现「第 1 章」
  await expect(page.getByText(/第 1 章/).first()).toBeVisible({ timeout: 60_000 });

  // 写一章
  await page.getByRole('button', { name: '写下一章' }).click();
  await expect(page.getByText(/已写/).first()).toBeVisible({ timeout: 90_000 });

  // 一致性检查：按钮真实接通后端并给出评分
  await page.getByRole('button', { name: '一致性检查' }).click();
  await expect(page.getByText(/评分 \d+/).first()).toBeVisible({ timeout: 30_000 });
});
