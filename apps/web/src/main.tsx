import { ConfigProvider } from 'antd';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './app-routes';
import { authStore } from '@src/store';
import './styles/index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// On startup await /me to get auth state before rendering routes — RequireAuth has the right verdict on the first frame, no login-page flash
await authStore.load();

// antd theme aligned to ink black (matches --color-primary; theme tokens borrowed from marginalia) —
// never let the default antd blue show. antd is cssinjs, no CSS import needed.
const theme = {
  token: {
    colorPrimary: '#111827',
    colorLink: '#111827',
    colorLinkHover: '#374151',
    borderRadius: 8,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  components: {
    // Ink-black primary makes antd's derived selected-option bg a muddy dark gray with dark text
    // (low contrast). Pin it: selected = ink bg + white text; hover = light gray.
    Select: {
      optionSelectedBg: '#111827',
      optionSelectedColor: '#ffffff',
      optionActiveBg: '#f0f1f3',
    },
  },
};

createRoot(el).render(
  <StrictMode>
    <ConfigProvider theme={theme}>
      <AppRoutes />
    </ConfigProvider>
  </StrictMode>,
);
