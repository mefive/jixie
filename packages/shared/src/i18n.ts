// Supported UI + reply locales. The web client sends the active locale as the Accept-Language header;
// the API renders user-facing messages in this locale and instructs the agent to reply in the user's
// language. Prompt scaffolding itself stays Chinese by design (see docs/design/i18n.md).
export type Locale = 'zh' | 'en';

export const LOCALES: Locale[] = ['zh', 'en'];

export const DEFAULT_LOCALE: Locale = 'zh';

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en';
}
