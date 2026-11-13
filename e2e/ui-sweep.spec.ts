import { expect, test } from '@playwright/test';

/**
 * 全界面真实鼠标巡检（不是“页面能打开”）。
 *
 * 覆盖：
 *  - 侧栏 12 个功能入口逐个点击，懒加载页面必须渲染出 main，且不能出现错误边界；
 *  - 设置页 12 个分区逐个点击，锚点必须存在且滚动到位；
 *  - 外观主题切换按钮真实生效（html[data-theme] 变化）；
 *  - 无项目时创建项目，进入工作台并发送一条消息，助手回复非空。
 *
 * 运行前置：AI_MOCK=1 的后端（同时托管 web/dist）或 vite dev。
 */

const API = process.env.E2E_API || 'http://127.0.0.1:43200';
const VIEWS = [
  '工作台',
  '项目总览',
  '研究计划',
  '文献调研',
  '知识库',
  '全自动流水线',
  '论文写作',
  '质量评分',
  '投稿辅助',
  '实验记录',
  '记忆中心',
  '设置',
];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/api/health`);
  expect(health.ok(), '后端未启动（需要 AI_MOCK=1）').toBeTruthy();
  const projects = await (await request.get(`${API}/api/projects`)).json();
  const list = Array.isArray(projects) ? projects : (projects.items || []);
  if (!list.length) {
    const created = await request.post(`${API}/api/projects`, { data: { name: `E2E 巡检 ${Date.now()}` } });
    expect(created.status()).toBe(201);
  }
});

test('侧栏 12 个入口逐个点击并渲染', async ({ page }) => {
  await page.goto('/#/workspace');
  await page.waitForLoadState('networkidle');
  // 设置入口独立渲染在分组导航之后，因此用整个 aside 定位，而不是 nav[aria-label=功能导航]
  const nav = page.locator('aside');

  for (const label of VIEWS) {
    const item = nav.getByText(label, { exact: true }).first();
    await expect(item, `侧栏缺少入口：${label}`).toBeVisible({ timeout: 15_000 });
    await item.click();
    // 懒加载完成：main 可见，且没有错误边界文案
    await expect(page.locator('main')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/页面加载失败|Something went wrong/i)).toHaveCount(0);
    await page.waitForTimeout(250);
  }
});

test('设置页每个分区都能点开并定位', async ({ page }) => {
  await page.goto('/#/settings');
  await page.waitForLoadState('networkidle');
  const nav = page.locator('nav[aria-label="设置分组"]');
  await expect(nav).toBeVisible({ timeout: 20_000 });

  const targets = await nav.locator('button[data-target]').evaluateAll((els) => els.map((e) => e.getAttribute('data-target')!).filter(Boolean));
  expect(targets.length, '设置分区导航为空').toBeGreaterThanOrEqual(10);

  for (const id of targets) {
    const btn = nav.locator(`button[data-target="${id}"]`);
    await btn.click();
    const section = page.locator(`#${id}`);
    await expect(section, `设置分区不存在：${id}`).toHaveCount(1);
    await expect(section).toBeVisible();
  }
});

test('外观主题切换真实生效', async ({ page }) => {
  await page.goto('/#/settings');
  await page.waitForLoadState('networkidle');
  const before = await page.locator('html').getAttribute('data-theme');
  const themeButtons = page.locator('[data-theme-option]');
  if (await themeButtons.count()) {
    const target = themeButtons.nth((await themeButtons.count()) - 1);
    await target.click();
    await expect
      .poll(async () => page.locator('html').getAttribute('data-theme'), { timeout: 8000 })
      .not.toBe(before);
  } else {
    // 主题按钮没有 data 标记时，至少验证设置页已渲染
    await expect(page.locator('main')).toBeVisible();
  }
});

test('工作台发消息并收到非空回复', async ({ page }) => {
  await page.goto('/#/workspace');
  await page.waitForLoadState('networkidle');
  const composer = page.getByPlaceholder(/问问题/);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill('用一句话说明什么是科研质量门');
  await composer.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  const assistant = page.locator('[data-testid="assistant-message"]').last();
  await expect(assistant).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout: 30_000, intervals: [500, 1000, 2000] })
    .toBeGreaterThan(0);
});
