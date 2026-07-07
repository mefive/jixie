import i18n from './index';

// Market-cap values arrive in 万元 (10k CNY). Render them per locale: 亿 (1e8 CNY) for zh, billions
// (B) for en. The scale differs — 1 亿 = 0.1 B — so the number itself must be rescaled per locale, not
// just the unit suffix. Called at render time so a language switch re-formats.
export function formatMarketCapWan(wan: number | null): string {
  if (wan == null) {
    return '—';
  }
  const yi = wan / 1e4; // 万元 → 亿
  return i18n.language === 'en' ? `${(yi / 10).toFixed(1)}B` : `${yi.toFixed(1)}亿`;
}
