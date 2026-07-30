import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import type { Locale } from '@jixie/shared';

export function antdLocale(locale: Locale) {
  return locale === 'en' ? enUS : zhCN;
}
