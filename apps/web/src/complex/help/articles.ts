import type { Locale } from '@jixie/shared';
import navigationEn from '@src/content/help/en/getting-started/navigation.md?raw';
import navigationZh from '@src/content/help/zh/getting-started/navigation.md?raw';

export type HelpArticle = {
  slug: string;
  group: 'gettingStarted';
  title: Record<Locale, string>;
  summary: Record<Locale, string>;
  content: Record<Locale, string>;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started/navigation',
    group: 'gettingStarted',
    title: {
      zh: '页面导航',
      en: 'Page navigation',
    },
    summary: {
      zh: '了解主要页面、语言切换、当前账号和帮助中心。',
      en: 'Learn the main pages, language switch, current account, and Help Center.',
    },
    content: {
      zh: navigationZh,
      en: navigationEn,
    },
  },
];

export const DEFAULT_HELP_SLUG = HELP_ARTICLES[0].slug;

export function findHelpArticle(slug: string | undefined): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
