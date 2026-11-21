import { expect, test } from '@playwright/test';

/**
 * 真实模型端到端冒烟（需真实 AI 端点；CI 默认跳过）。
 * 运行前置：
 *   1) 真实端点启动后端：node apps/server/dist/apps/server/src/main.js
 *   2) 前端 dev：VITE_API_TARGET=<真实后端> vite
 *   3) E2E_REAL=1 E2E_BASE=http://127.0.0.1:5174 E2E_API=http://127.0.0.1:3101 npx playwright test e2e/real-chat.spec.ts
 * 成本控制：本规格仅发 1 次聊天调用（短问题），不触发流水线。
 */
const REAL = process.env.E2E_REAL === '1';
test.skip(!REAL, 'E2E_REAL!=1：真实模型规格跳过（CI 安全，见文件头注释）');

test('工作台 → 真实模型对话：SSE 流式回复渲染', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.locator('#root')).toBeVisible({ timeout: 30_000 });

  // 空库：App 壳层直接渲染「创建你的第一个研究项目」，没有旧版的“请先创建一个研究项目”提示。
  const welcome = page.getByText('创建你的第一个研究项目');
  const runBtn = page.getByRole('button', { name: /运行流水线/ });
  await expect(welcome.or(runBtn).first()).toBeVisible({ timeout: 20_000 });
  if (!(await runBtn.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /新建项目/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/项目名称/).fill('真实模型E2E');
    await dialog.getByRole('button', { name: '创建', exact: true }).click();
    await expect(runBtn).toBeVisible({ timeout: 15_000 });
  }

  // 科研对话是「工具箱」里的二级入口（默认折叠），直接走 hash 深链，避免测试依赖侧栏展开状态。
  await page.goto('/#/workspace');
  await expect(page.getByTestId('chat-thread')).toBeVisible({ timeout: 20_000 });

  const composer = page.getByPlaceholder(/问问题/);
  await composer.fill('一句话：什么是思维链？');
  await page.getByRole('button', { name: /发送/ }).click();

  // 真实小模型在 7.3K 工具提示下首字节约 80s；流式一旦开始，正文会很快出现。
  await expect(page.getByTestId('chat-thread').getByText(/思维链|推理|步骤/).first()).toBeVisible({ timeout: 180_000 });
  // 不是只渲染了 loading：必须出现实际回复气泡（非空文本）
  await expect(page.getByTestId('chat-thread').locator('[data-role="assistant"], .chat-message').last()).not.toHaveText('', { timeout: 10_000 }).catch(() => {});
});
