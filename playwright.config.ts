import { defineConfig } from '@playwright/test';

/**
 * Playwright E2E 冒烟配置（Web 端）。
 * 运行前置：`AI_MOCK=1 node apps/server/dist/apps/server/src/main.js`（:3000）+ `pnpm --filter @sciflow/web dev`（:5173）。
 * 本机首次运行需 `npx playwright install chromium` 下载浏览器（受网络限制时先在能联网的机器执行）。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE || 'http://localhost:5173',
    trace: 'retain-on-failure',
    // 云主机/CI 可复用系统 Chromium，避免每次下载 Playwright 自带浏览器
    launchOptions: process.env.CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  reporter: [['list']],
});
