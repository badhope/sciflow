import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 与 vite.config.ts 保持同一别名：测试里 import '@sciflow/core/*' 才不会解析失败
    alias: { '@sciflow/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /**
     * 显式超时（v2.0 修复）：默认 5000ms 在 19 个测试文件并行 + happy-dom 反复重建环境时不够用。
     * 实测 ProviderManager 两个用例单独跑 2.3-3.0s（绿），全量并行时 5.01-5.07s（红）
     * —— 负载相关的假红，不是行为回归。放宽到 15s，真正的行为失败仍会报错。
     */
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
