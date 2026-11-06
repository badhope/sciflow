import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/** 与后端共用的能力层（packages/core）—— 用别名而非深相对路径，与 server 侧约定一致 */
const coreSrc = fileURLToPath(new URL('../../packages/core/src', import.meta.url));

export default defineConfig({
  /**
   * 资源基础路径。
   *  - Web 部署（nginx / 根路径）：'/'，与历史行为一致
   *  - 桌面端（Electron 用 file:// 加载 index.html）：必须是相对路径 './'
   *    否则 index.html 里的 /assets/*.js 会被解析成 file:///C:/assets/... → 全部 404 → 白屏
   *    构建时用 VITE_BASE=./ pnpm --filter @sciflow/web build
   */
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@sciflow/core': coreSrc },
  },
  server: {
    port: 5173,
    // 允许读取仓库根下的 packages/（dev server 默认只允许项目根）
    fs: { allow: ['../..'] },
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 代码分割：React 框架与图标库拆为独立 vendor chunk，优化首屏与缓存
    rollupOptions: {
      output: {
        // vite 8（rolldown 内核）：manualChunks 只接受函数，不再支持对象形式
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('node_modules/lucide-react')) return 'ui';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
