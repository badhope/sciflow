import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/** 与后端共用的能力层（packages/core）—— 用别名而非深相对路径，与 server 侧约定一致 */
const coreSrc = fileURLToPath(new URL('../../packages/core/src', import.meta.url));

export default defineConfig({
  /** 每次构建唯一 ID：用于 PWA 新旧缓存/热更新验收与线上问题定位。 */
  define: { __SCIFLOW_BUILD__: JSON.stringify(new Date().toISOString()) },
  /**
   * 资源基础路径。
   *  - Web 部署（nginx / 根路径）：'/'，与历史行为一致
   *  - 桌面端（Electron 用 file:// 加载 index.html）：必须是相对路径 './'
   *    否则 index.html 里的 /assets/*.js 会被解析成 file:///C:/assets/... → 全部 404 → 白屏
   *    构建时用 VITE_BASE=./ pnpm --filter @sciflow/web build
   */
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // 现有 manifest.webmanifest/图标继续由 public 提供，避免重复生成
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
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
          // 其余重依赖交给路由级 lazy + Rollup 自然分块：
          // 手动把 mermaid/recharts/markdown 合成 vendor chunk 会把共享模块拖进首屏，
          // 也会把 mermaid 12 种图表合成 ~5MB 的单文件。
          if (id.includes('node_modules/diff/')) return 'diff';
          if (id.includes('node_modules/docx')) return 'docx';
          return undefined;
        },
      },
    },
    // elkjs 的 elk.bundled.js 是单文件 1.5MB（gzip ~450KB），只在 flowchart-elk 图表里懒加载；
    // 首屏体积由 check:chunk-budget 的 450KB raw / 250KB gzip 预算单独守。
    chunkSizeWarningLimit: 1600,
  },
});
