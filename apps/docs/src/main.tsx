import { App, ConfigProvider } from 'antd';
import { createRoot } from 'react-dom/client';
import { observer } from 'mobx-react';
import { RouterProvider } from 'react-router-dom';
import { antdLocale } from '@src/i18n/antd-locale';
import { localeStore } from '@src/i18n/locale-store';
import { router } from './router';
import './i18n';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root not found');
}

const DocsRoot = observer(function DocsRoot() {
  return (
    <ConfigProvider theme={theme} locale={antdLocale(localeStore.locale)}>
      <App className="jx-appRoot">
        <RouterProvider router={router} />
      </App>
    </ConfigProvider>
  );
});

const theme = {
  token: {
    colorPrimary: '#111827',
    colorLink: '#111827',
    colorLinkHover: '#374151',
    borderRadius: 8,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
};

createRoot(rootElement).render(<DocsRoot />);
