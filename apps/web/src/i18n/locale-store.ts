import { makeAutoObservable } from 'mobx';
import type { Locale } from '@jixie/shared';
import i18n, { LOCALE_STORAGE_KEY, readStoredLocale } from './index';

// Single source of truth for the active UI locale. Drives i18next (text), the antd ConfigProvider
// (component chrome), and the Accept-Language header the api client sends. Persisted to localStorage.
class LocaleStore {
  public locale: Locale = readStoredLocale();

  public constructor() {
    makeAutoObservable(this);
  }

  public setLocale(next: Locale): void {
    if (next === this.locale) {
      return;
    }
    this.locale = next;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore persistence failure — the in-memory switch still applies for this session
    }
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
  }
}

export const localeStore = new LocaleStore();
