import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 固定测试进程的 NODE_ENV，不继承外部环境变量。
 *
 * 事故复现：在导出 `NODE_ENV=production` 的机器/镜像里跑 `pnpm --filter @sciflow/web test`，
 * 全部 89 个组件用例齐刷刷报 `TypeError: React.act is not a function`。
 * 根因是 React 的**生产构建不导出 `act`**（act 是 dev-only API），而 react 是被 externalize 后
 * 原生 require 的，读的就是真实的 process.env.NODE_ENV；@testing-library/react 拿不到 React.act
 * 便回落到已废弃的 ReactDOMTestUtils.act，最终抛出这个与真因毫无关系的错误。
 *
 * 之所以长期隐形：CI 的 GitHub Actions runner 不预设 NODE_ENV，所以流水线一直是绿的；
 * 只有 Docker 镜像、`NODE_ENV=production pnpm test`、或本地 shell 导出过该变量时才会触发。
 * 报错信息又完全不指向环境变量，排查成本极高。这里显式钉死为 `test`（与 vitest 自身默认一致），
 * 让结果不再依赖调用方环境。
 */
process.env.NODE_ENV = 'test';

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
