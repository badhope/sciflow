import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/release/**', '**/resources/**', '**/node_modules/**', '**/*.config.cjs', '.zwork/**', 'apps/server/data/**', '**/coverage/**', '.tmp/**'] },
  {
    // M3-3 依赖红线（模块边界固化）：packages=核心能力层，apps/server=接口层
    files: ['packages/**/*.ts'],
    rules: {
      // 能力层禁止依赖接口层（防止反向依赖：接口层的 controller/service/module 概念不进包）
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/apps/server/src/**'],
          message: 'packages 是核心能力层，禁止反向依赖 apps/server（接口层）。需要的能力应下沉为包内模块或经参数注入。',
        }],
      }],
    },
  },
  {
    // 接口层之间禁止横穿：必须经对方公开出口（桶），且禁止 controller 互调。
    //
    // 历史缺陷（2026-10 修复）：原 pattern `**/packages/*/src/*!(index)*` 在 eslint 的
    // minimatch 实现下**从未命中**（`!(index)` 扩展语法不被支持），规则形同虚设——
    // 实测把 `packages/core/src/quality-audit` 深路径导入塞进 apps/server 仍然 0 报错。
    // 改为显式列目录的两条 pattern（core/db/ai/retrieval 的 src 下任意文件），并放行桶文件：
    // 桶 = apps/server/src/common/*.ts（唯一 `export * from '../../../../packages/...'` 出口）
    //    + apps/server/src/ai/*.ts（AI 模块的历史入口，均为 2 行纯转发，不承载逻辑）。
    files: ['apps/server/src/**/*.ts'],
    ignores: ['apps/server/src/common/*.ts', 'apps/server/src/ai/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/packages/core/src/**',
            '**/packages/db/src/**',
            '**/packages/ai/src/**',
            '**/packages/retrieval/src/**',
            '**/packages/core/src',
            '**/packages/db/src',
            '**/packages/ai/src',
            '**/packages/retrieval/src',
          ],
          message: '接口层只能经 apps/server/src/common/* 桶使用 packages 能力（或 @sciflow/core 包名），禁止深路径绕过包边界。',
        }],
      }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      // 技术债清零（2026-10-14）：存量豁免全部删除，以下规则全仓强制
      '@typescript-eslint/no-this-alias': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // 对话控制器（ChatPage）：持有流中止句柄 ref、在 effect 里把会话快照写入 localStorage。
    // React Compiler 的三条实验性规则针对「可安全记忆化」的纯组件；该文件是显式的
    // 有状态控制器（abort handle / draft 持久化），属已知安全模式，其余规则仍然强制。
    files: ['apps/web/src/pages/ChatPage.tsx'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  },
);
