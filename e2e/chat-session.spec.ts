import { expect, test } from '@playwright/test';

/**
 * A1 会话服务端化真实 UI：抽屉里搜索、置顶、归档/恢复，刷新后状态仍来自服务端。
 * 前置：VITE_API_TARGET 指向隔离库服务，且 AI_MOCK=1（不需要真实模型）。
 */
const API = process.env.E2E_API || 'http://127.0.0.1:4404';

test('会话抽屉：全文搜索、置顶、归档/恢复、刷新后保留', async ({ page, request }) => {
  const health = await request.get(`${API}/api/health`);
  expect(health.ok(), '隔离服务未启动').toBeTruthy();

  const projectName = `a1-ui-${Date.now()}`;
  const projectRes = await request.post(`${API}/api/projects`, { data: { name: projectName } });
  expect(projectRes.status()).toBe(201);
  const project = (await projectRes.json()) as { id: string };

  const token = `A1UI-${Date.now()}`;
  const sessionTitle = `A1 UI 验收 ${token}`;
  const sessionRes = await request.post(`${API}/api/chat/sessions`, {
    data: {
      projectId: project.id,
      title: sessionTitle,
      messages: [
        { id: 'u1', role: 'user', content: `请记住检索词 ${token}`, createdAt: Date.now() - 10_000 },
        { id: 'a1', role: 'assistant', content: `已记住 ${token}`, createdAt: Date.now() - 9_000 },
      ],
    },
  });
  expect(sessionRes.status()).toBe(201);
  const session = (await sessionRes.json()) as { id: string };

  await page.goto('/#/workspace');
  await page.waitForLoadState('networkidle');
  await page.locator('aside').getByText(projectName, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: /运行流水线/ })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^会话/ }).first().click();
  await expect(page.getByText('会话（云端同步）')).toHaveCount(0); // 旧标题已移除
  const search = page.getByLabel('搜索会话');
  await expect(search).toBeVisible();
  await search.fill(token);
  await expect(page.getByText(sessionTitle, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: `置顶 ${sessionTitle}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `取消置顶 ${sessionTitle}`, exact: true })).toBeVisible();
  await expect(page.getByText(/会话同步失败/)).toHaveCount(0);

  await page.getByRole('button', { name: `归档会话 ${sessionTitle}`, exact: true }).click();
  await expect(page.getByText(sessionTitle, { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '显示归档' }).click();
  await expect(page.getByText(sessionTitle, { exact: true }).first()).toBeVisible();

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('aside').getByText(projectName, { exact: true }).first().click();
  await page.getByRole('button', { name: /^会话/ }).first().click();
  await page.getByRole('button', { name: '显示归档' }).click();
  await page.getByLabel('搜索会话').fill(token);
  await expect(page.getByText(sessionTitle, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: `取消置顶 ${sessionTitle}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `恢复会话 ${sessionTitle}`, exact: true })).toBeVisible();

  // 清理本次生成的数据，避免隔离库堆积。
  await request.delete(`${API}/api/chat/sessions/${session.id}?projectId=${project.id}`);
});
