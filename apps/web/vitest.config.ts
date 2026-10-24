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
  },
});
