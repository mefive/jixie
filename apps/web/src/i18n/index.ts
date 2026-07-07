import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@jixie/shared';
import { zhResources } from './locales/zh';
import { enResources } from './locales/en';

// localStorage key holding the user's chosen locale (default 'zh'; there is no browser auto-detect).
export const LOCALE_STORAGE_KEY = 'jx-locale';

export function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable (privacy mode) — fall back to the default locale
  }
  return DEFAULT_LOCALE;
}

const initialLocale = readStoredLocale();

// One i18next instance for the whole app. Namespaces are added per page under locales/<lng>/;
// 'common' holds shared chrome (nav, buttons). Prompt text is never routed through here — prompts
// live in the API and stay Chinese by design (see docs/design/i18n.md).
void i18n.use(initReactI18next).init({
  resources: { zh: zhResources, en: enResources },
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

document.documentElement.lang = initialLocale;

export default i18n;
