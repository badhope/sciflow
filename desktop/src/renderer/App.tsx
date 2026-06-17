import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';

import Home from './pages/Home';
import Settings from './pages/Settings';
import Plugins from './pages/Plugins';

const App: React.FC = () => {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/plugins" element={<Plugins />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
