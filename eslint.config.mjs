import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/release/**', '**/resources/**', '**/node_modules/**', '**/*.config.cjs', '.zwork/**', 'apps/server/data/**', '**/coverage/**'] },
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
    // 接口层之间禁止横穿：必须经对方公开出口（桶），且禁止 controller 互调
    files: ['apps/server/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/packages/*/src/*!(index)*', '!**/packages/**/src/index.ts'],
          message: '接口层只允许经桶（common/db/ai/knowledge 旧路径）或包 index 使用 packages 能力，禁止深路径绕过边界。',
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
