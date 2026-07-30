import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@jixie/shared';
import { enHelp } from './locales/en/help';
import { zhHelp } from './locales/zh/help';

export const LOCALE_STORAGE_KEY = 'jx-locale';

export function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable; the documentation still works with the default locale.
  }
  return DEFAULT_LOCALE;
}

const initialLocale = readStoredLocale();

void i18n.use(initReactI18next).init({
  resources: {
    zh: { help: zhHelp },
    en: { help: enHelp },
  },
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'help',
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = initialLocale;

export default i18n;
