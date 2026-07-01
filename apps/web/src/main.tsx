import { App, ConfigProvider } from 'antd';
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
    // Hover highlight = light gray. The selected option is pinned to a light fill in index.css
    // (antd 6 derives a dark muddy gray from the ink primary otherwise).
    Select: {
      optionActiveBg: '#f0f1f3',
    },
  },
};

createRoot(el).render(
  <StrictMode>
    <ConfigProvider theme={theme}>
      {/* antd 6 App: gives message/modal/notification a context instance (App.useApp) so LoaderButton's
          toasts + confirm dialog inherit the ink theme instead of the default antd blue. Keep the default
          div wrapper (antd 6 cssVar needs a real component), but jx-appRoot is display:contents so it
          generates no box and doesn't break the html/body/#root height:100% chain. */}
      <App className="jx-appRoot">
        <AppRoutes />
      </App>
    </ConfigProvider>
  </StrictMode>,
);
