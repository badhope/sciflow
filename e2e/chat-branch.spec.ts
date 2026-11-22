import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * A2 分支对话真实 UI：回答版本切换 + 编辑提问保留旧分支。
 * 前置：VITE_API_TARGET 指向隔离库服务，AI_MOCK=1。
 */
const API = process.env.E2E_API || 'http://127.0.0.1:4404';

async function openProject(page: Page, name: string) {
  await page.goto('/#/workspace');
  await page.waitForLoadState('networkidle');
  await page.locator('aside').getByText(name, { exact: true }).first().click();
  await expect(page.getByRole('button', { name: /运行流水线/ })).toBeVisible({ timeout: 20_000 });
}

async function createProjectWithSession(request: APIRequestContext, title: string, messages: unknown[], leafId: string) {
  const projectName = `a2-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const p = await request.post(`${API}/api/projects`, { data: { name: projectName } });
  expect(p.status()).toBe(201);
  const project = (await p.json()) as { id: string };
  const s = await request.post(`${API}/api/chat/sessions`, {
    data: { projectId: project.id, title, messages, branch: { activeLeafId: leafId } },
  });
  expect(s.status()).toBe(201);
  return { project, session: (await s.json()) as { id: string }, projectName };
}

test('三个回答版本可来回切换，刷新后保留 activeLeaf', async ({ page, request }) => {
  const now = Date.now();
  const { project, session, projectName } = await createProjectWithSession(request, `A2 版本 ${now}`, [
    { id: 'q', parentId: null, role: 'user', content: '同一个问题', createdAt: now - 10_000 },
    { id: 'a1', parentId: 'q', role: 'assistant', content: '版本一', createdAt: now - 9_000 },
    { id: 'a2', parentId: 'q', role: 'assistant', content: '版本二', createdAt: now - 8_000 },
    { id: 'a3', parentId: 'q', role: 'assistant', content: '版本三', createdAt: now - 7_000 },
  ], 'a3');

  await openProject(page, projectName);
  await expect(page.getByText('版本三', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '上一版本 3/3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一版本 3/3', exact: true }).click();
  await expect(page.getByText('版本二', { exact: true })).toBeVisible();
  await expect(page.getByText('版本三', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一版本 2/3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^会话/ }).first().click();
  await expect(page.getByRole('region', { name: '会话' }).getByText('2/3', { exact: true })).toBeVisible();
  // 切换分支也要落到服务端，而不是只活在 localStorage。
  await expect.poll(async () => {
    const r = await request.get(`${API}/api/chat/sessions/${session.id}?projectId=${project.id}`);
    const d = (await r.json()) as { branch?: { activeLeafId?: string } };
    return d.branch?.activeLeafId;
  }, { timeout: 10_000 }).toBe('a2');

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('aside').getByText(projectName, { exact: true }).first().click();
  await expect(page.getByText('版本二', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '下一版本 2/3', exact: true })).toBeVisible();

  await request.delete(`${API}/api/chat/sessions/${session.id}?projectId=${project.id}`);
});

test('编辑提问会新建用户分支，旧问题与旧回答仍可切回', async ({ page, request }) => {
  const now = Date.now();
  const { project, session, projectName } = await createProjectWithSession(request, `A2 编辑 ${now}`, [
    { id: 'q1', parentId: null, role: 'user', content: '原问题', createdAt: now - 10_000 },
    { id: 'a1', parentId: 'q1', role: 'assistant', content: '原回答', createdAt: now - 9_000 },
  ], 'a1');

  await openProject(page, projectName);
  await expect(page.getByText('原回答', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '编辑并分支', exact: true }).first().click();
  await page.getByLabel('编辑用户消息').fill('改后问题');
  await page.getByRole('button', { name: '保存并重新生成', exact: true }).click();

  await expect(page.getByText('改后问题', { exact: true })).toBeVisible();
  const assistant = page.locator('[data-testid="assistant-message"]').last();
  await expect.poll(async () => (await assistant.innerText()).trim().length, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '上一版本 2/2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一版本 2/2', exact: true }).click();
  await expect(page.getByText('原问题', { exact: true })).toBeVisible();
  await expect(page.getByText('原回答', { exact: true })).toBeVisible();
  await expect(page.getByText('改后问题', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '下一版本 1/2', exact: true })).toBeVisible();

  await request.delete(`${API}/api/chat/sessions/${session.id}?projectId=${project.id}`);
});
