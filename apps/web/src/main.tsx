import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app-routes';
import { authStore } from '@src/store';
import './styles/index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// On startup await /me to get auth state before rendering routes — RequireAuth has the right verdict on the first frame, no login-page flash
await authStore.load();

createRoot(el).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
);
