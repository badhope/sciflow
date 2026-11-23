/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App';

/** 构建 ID 暴露给运行环境与支持排障；构建时由 vite define 注入。 */
declare const __SCIFLOW_BUILD__: string;
const buildId = typeof __SCIFLOW_BUILD__ === 'string' ? __SCIFLOW_BUILD__ : 'dev';
if (typeof document !== 'undefined') {
  let meta = document.querySelector('meta[name="sciflow-build"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'sciflow-build');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', buildId);
}
(window as unknown as { __SCIFLOW_BUILD__?: string }).__SCIFLOW_BUILD__ = buildId;

/** 全局数据获取层（@tanstack/react-query）：服务端状态缓存/失效/轮询统一由它承担 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

// PWA 由 vite-plugin-pwa 在构建时注入注册（generateSW + autoUpdate）；手写 sw.js 已删除。

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
