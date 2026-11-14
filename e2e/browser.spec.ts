import { expect, test } from '@playwright/test';

/**
 * 内置浏览器页真实交互：打开本地预览 → 截图出现 → 文本出现 → 点按钮。
 *
 * 依赖：后端能启动 Chromium（PLAYWRIGHT_BROWSERS_PATH 指向已安装缓存）。
 * 使用 Web 沙箱先造一个本地页面，避免依赖外网。
 */
test('内置浏览器：打开本地页面 → 截图 → 文本 → 点击', async ({ page, request }) => {
  test.setTimeout(180_000);
  const API = process.env.E2E_API || 'http://127.0.0.1:43200';

  // 造一个本地页面（Web 沙箱 static 模板 + 一键跑通）
  const projects = await (await request.get(`${API}/api/projects`)).json();
  const list = Array.isArray(projects) ? projects : (projects.items || []);
  let projectId = list[0]?.id;
  if (!projectId) {
    // 空库（干净 mock）时自建项目，测试不依赖外部种子数据
    const created = await request.post(`${API}/api/projects`, { data: { name: `browser-e2e-project-${Date.now()}` } });
    expect(created.status()).toBe(201);
    projectId = (await created.json()).id;
  }
  expect(projectId, '缺少项目').toBeTruthy();
  const wp = await request.post(`${API}/api/web-projects`, { data: { projectId, name: `browser-e2e-${Date.now()}`, template: 'static' } });
  expect(wp.status()).toBe(201);
  const wpId = (await wp.json()).id;
  const run = await request.post(`${API}/api/web-projects/${wpId}/run-all`);
  const runBody = await run.json();
  expect(runBody.ok, `一键跑通失败：${JSON.stringify(runBody)}`).toBe(true);
  const url = runBody.url as string;

  await page.goto('/#/browser');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });

  await page.getByLabel('网址').fill(url);
  await page.getByRole('button', { name: '打开' }).click();

  // 截图出现（img 标签，src 是 data:image/png）
  const shot = page.locator('img[alt="页面截图"]');
  await expect(shot).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await shot.getAttribute('src'))?.slice(0, 22), { timeout: 30_000 })
    .toBe('data:image/png;base64,');

  // 文本面板出现页面标题
  await expect(page.getByText(/browser-e2e-/, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  // 点击页面里的按钮，文本随之更新（证明是真实可交互页面）
  await page.getByLabel('选择器').fill('#btn');
  await page.getByRole('button', { name: '点击' }).click();
  await expect(page.getByText(/已点击/, { exact: false }).first()).toBeVisible({ timeout: 30_000 });

  // 网页验收：断言标题存在、按钮可见、文本匹配
  await page.getByLabel('验收断言').fill(`exists | h1
visible | #btn
text | | browser-e2e-`);
  await page.getByRole('button', { name: '运行验收' }).click();
  await expect(page.getByText('全部通过', { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/3\/3 通过/)).toBeVisible();

  // 负向：故意断言不存在的元素，必须报失败（证明验收真的在检查）
  await page.getByLabel('验收断言').fill('exists | #definitely-not-here');
  await page.getByRole('button', { name: '运行验收' }).click();
  await expect(page.getByText('存在失败', { exact: false })).toBeVisible({ timeout: 30_000 });

  await request.delete(`${API}/api/web-projects/${wpId}`);
});
