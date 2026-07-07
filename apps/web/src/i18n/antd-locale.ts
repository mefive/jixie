import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import type { Locale } from '@jixie/shared';

// Map our app locale to antd's ConfigProvider locale so built-in component chrome (pagination,
// empty states, date pickers, table filters) follows the language switch.
export function antdLocale(locale: Locale) {
  return locale === 'en' ? enUS : zhCN;
}
