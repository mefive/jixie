import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app-routes';
import { authStore } from '@src/store';
import './styles/index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// 启动先 await /me 拿登录态，再渲染路由 —— RequireAuth 第一帧就有正确判断，不闪登录页
await authStore.load();

createRoot(el).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
);
