import '@testing-library/jest-dom/vitest';

if (typeof document !== 'undefined') {
  Object.defineProperty(document, 'compatMode', {
    configurable: true,
    get: () => 'CSS1Compat',
  });
}
