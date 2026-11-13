import '@testing-library/jest-dom/vitest';

/**
 * 兜底：确保 React 加载在开发构建下（生产构建不导出 act，会让全部组件用例报
 * `React.act is not a function`）。主开关在 vitest.config.mts，这里覆盖
 * 「换用其它 config 单独跑某个用例」的场景。
 */
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';

if (typeof document !== 'undefined') {
  Object.defineProperty(document, 'compatMode', {
    configurable: true,
    get: () => 'CSS1Compat',
  });
}
