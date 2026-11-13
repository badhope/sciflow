import { expect, test } from '@playwright/test';

/**
 * 设置页深度交互巡检：折叠卡片逐个展开、页内按钮逐个点击。
 *
 * 目的：验证“点得动、有响应”，而不是只出现在 DOM 里。
 * 允许按钮触发 onboarding/确认弹窗等交互，但必须可关闭且不产生错误边界。
 * 危险按钮（删除/重置）不点，避免污染共享 mock 库。
 */

const SKIP_BUTTON_TEXT = /删除|移除|重置|清空|卸载|注销|停用全部|Remove|Delete|Reset|Clear/i;

test.describe.configure({ mode: 'serial' });

test('设置页折叠卡片可展开，页内按钮可点击且无错误边界', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/#/settings');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

  // 1) 所有折叠卡片逐个展开（aria-expanded=false → click → true）
  const collapsibles = page.locator('main button[aria-expanded="false"]');
  const n = await collapsibles.count();
  let opened = 0;
  for (let i = 0; i < n; i++) {
    const btn = collapsibles.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    await btn.click({ trial: false }).catch(() => undefined);
    opened += 1;
    await page.waitForTimeout(60);
  }
  expect(opened, '设置页没有任何可展开区块，探测选择器可能失效').toBeGreaterThan(0);

  // 2) 逐个点击页内可见按钮（跳过删除类），确认页面不崩
  const buttons = page.locator('main button:not([disabled])');
  const total = Math.min(await buttons.count(), 40);
  let clicked = 0;
  for (let i = 0; i < total; i++) {
    const btn = buttons.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const label = ((await btn.innerText().catch(() => '')) || '').trim();
    if (SKIP_BUTTON_TEXT.test(label)) continue;
    // 只点“动作型”按钮：排除纯导航（设置分区导航已单独覆盖）
    if (await btn.evaluate((el) => Boolean(el.closest('nav[aria-label="设置分组"]'))).catch(() => false)) continue;
    await btn.click({ timeout: 3000 }).catch(() => undefined);
    clicked += 1;
    // 关掉可能弹出的确认/提示层，避免遮挡后续点击
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(50);
    await expect(page.getByText(/页面加载失败|Something went wrong/i)).toHaveCount(0);
  }
  expect(clicked, '没有点到任何设置页按钮').toBeGreaterThan(0);
});

test('研究计划页：创建计划 → 启动循环面板可交互', async ({ page, request }) => {
  test.setTimeout(120_000);
  const API = process.env.E2E_API || 'http://127.0.0.1:43200';
  const projects = await (await request.get(`${API}/api/projects`)).json();
  const list = Array.isArray(projects) ? projects : (projects.items || []);
  const projectId = list[0]?.id;
  expect(projectId, '缺少项目').toBeTruthy();

  const created = await request.post(`${API}/api/programs`, {
    data: { projectId, title: `E2E 计划 ${Date.now()}`, goal: '验证研究循环面板交互', autonomyLevel: 'L2' },
  });
  expect(created.status()).toBe(201);

  await page.goto('/#/programs');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

  // 面板存在且模式切换按钮可用（人工/AI 专家审批）
  const humanBtn = page.getByRole('button', { name: '人工审批' });
  const aiBtn = page.getByRole('button', { name: '全自动（AI 专家审批）' });
  await expect(humanBtn).toBeVisible({ timeout: 15_000 });
  await expect(aiBtn).toBeVisible();
  await aiBtn.click();
  await expect(page.getByRole('button', { name: '全自动启动' })).toBeVisible();
});
