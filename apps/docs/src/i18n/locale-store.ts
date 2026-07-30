import { makeAutoObservable } from 'mobx';
import type { Locale } from '@jixie/shared';
import i18n, { LOCALE_STORAGE_KEY, readStoredLocale } from './index';

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
      // Persistence is optional; the in-memory language switch still succeeds.
    }
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
  }
}

export const localeStore = new LocaleStore();
