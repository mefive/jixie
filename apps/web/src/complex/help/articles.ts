import type { Locale } from '@jixie/shared';
import backtestLimitationsEn from '@src/content/help/en/basics/backtest-limitations.md?raw';
import backtestLimitationsZh from '@src/content/help/zh/basics/backtest-limitations.md?raw';
import backtestSettingsEn from '@src/content/help/en/basics/backtest-settings.md?raw';
import backtestSettingsZh from '@src/content/help/zh/basics/backtest-settings.md?raw';
import performanceRiskEn from '@src/content/help/en/basics/performance-risk.md?raw';
import performanceRiskZh from '@src/content/help/zh/basics/performance-risk.md?raw';
import stocksEtfsIndicesEn from '@src/content/help/en/basics/stocks-etfs-indices.md?raw';
import stocksEtfsIndicesZh from '@src/content/help/zh/basics/stocks-etfs-indices.md?raw';
import strategyBacktestEn from '@src/content/help/en/basics/strategy-backtest.md?raw';
import strategyBacktestZh from '@src/content/help/zh/basics/strategy-backtest.md?raw';
import firstBacktestEn from '@src/content/help/en/getting-started/first-backtest.md?raw';
import firstBacktestZh from '@src/content/help/zh/getting-started/first-backtest.md?raw';
import firstScreenEn from '@src/content/help/en/getting-started/first-screen.md?raw';
import firstScreenZh from '@src/content/help/zh/getting-started/first-screen.md?raw';
import loginEn from '@src/content/help/en/getting-started/login.md?raw';
import loginZh from '@src/content/help/zh/getting-started/login.md?raw';
import navigationEn from '@src/content/help/en/getting-started/navigation.md?raw';
import navigationZh from '@src/content/help/zh/getting-started/navigation.md?raw';
import overviewEn from '@src/content/help/en/getting-started/overview.md?raw';
import overviewZh from '@src/content/help/zh/getting-started/overview.md?raw';

export const HELP_GROUPS = ['gettingStarted', 'basics'] as const;
export type HelpGroup = (typeof HELP_GROUPS)[number];

export type HelpArticle = {
  slug: string;
  group: HelpGroup;
  title: Record<Locale, string>;
  summary: Record<Locale, string>;
  content: Record<Locale, string>;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started/overview',
    group: 'gettingStarted',
    title: {
      zh: '产品可以做什么',
      en: 'What the product does',
    },
    summary: {
      zh: '了解各项功能的用途，以及使用历史数据时需要注意的限制。',
      en: 'Understand what each area is for and the limits of working with historical data.',
    },
    content: {
      zh: overviewZh,
      en: overviewEn,
    },
  },
  {
    slug: 'getting-started/login',
    group: 'gettingStarted',
    title: {
      zh: '登录',
      en: 'Sign in',
    },
    summary: {
      zh: '使用邮箱验证码登录，并了解新邮箱何时需要邀请码。',
      en: 'Sign in with an email verification code and learn when an invitation code is required.',
    },
    content: {
      zh: loginZh,
      en: loginEn,
    },
  },
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
  {
    slug: 'getting-started/first-screen',
    group: 'gettingStarted',
    title: {
      zh: '第一次完成选股',
      en: 'Run your first screen',
    },
    summary: {
      zh: '用一句筛选条件得到股票列表，并确认筛选结果来自哪些条件。',
      en: 'Turn a plain-language condition into a stock list and verify the conditions used.',
    },
    content: {
      zh: firstScreenZh,
      en: firstScreenEn,
    },
  },
  {
    slug: 'getting-started/first-backtest',
    group: 'gettingStarted',
    title: {
      zh: '第一次运行回测',
      en: 'Run your first backtest',
    },
    summary: {
      zh: '从策略描述开始，设置日期和资金，运行回测并查看主要结果。',
      en: 'Start with a strategy description, set dates and capital, run a backtest, and read the main result.',
    },
    content: {
      zh: firstBacktestZh,
      en: firstBacktestEn,
    },
  },
  {
    slug: 'basics/stocks-etfs-indices',
    group: 'basics',
    title: {
      zh: '股票、ETF 和指数',
      en: 'Stocks, ETFs, and indices',
    },
    summary: {
      zh: '区分三类常见标的，知道它们会在产品的哪些页面出现。',
      en: 'Distinguish three common market instruments and where they appear in the product.',
    },
    content: {
      zh: stocksEtfsIndicesZh,
      en: stocksEtfsIndicesEn,
    },
  },
  {
    slug: 'basics/strategy-backtest',
    group: 'basics',
    title: {
      zh: '策略和回测',
      en: 'Strategies and backtests',
    },
    summary: {
      zh: '理解策略规则、回测过程和基准之间的关系。',
      en: 'Understand the relationship between strategy rules, a backtest, and a benchmark.',
    },
    content: {
      zh: strategyBacktestZh,
      en: strategyBacktestEn,
    },
  },
  {
    slug: 'basics/backtest-settings',
    group: 'basics',
    title: {
      zh: '回测区间、资金和交易成本',
      en: 'Dates, capital, and trading costs',
    },
    summary: {
      zh: '了解起始日期、结束日期、资金、滑点和冲击系数如何影响结果。',
      en: 'Learn how dates, capital, slippage, and market impact affect a result.',
    },
    content: {
      zh: backtestSettingsZh,
      en: backtestSettingsEn,
    },
  },
  {
    slug: 'basics/performance-risk',
    group: 'basics',
    title: {
      zh: '收益和风险指标',
      en: 'Return and risk metrics',
    },
    summary: {
      zh: '看懂累计收益、年化收益、超额收益、最大回撤和常用辅助指标。',
      en: 'Read total return, annualized return, excess return, maximum drawdown, and supporting metrics.',
    },
    content: {
      zh: performanceRiskZh,
      en: performanceRiskEn,
    },
  },
  {
    slug: 'basics/backtest-limitations',
    group: 'basics',
    title: {
      zh: '为什么回测不等于未来收益',
      en: 'Why a backtest is not a forecast',
    },
    summary: {
      zh: '认识未来数据、幸存者偏差、过度拟合和真实成交差异。',
      en: 'Recognize look-ahead bias, survivorship bias, overfitting, and differences from live execution.',
    },
    content: {
      zh: backtestLimitationsZh,
      en: backtestLimitationsEn,
    },
  },
];

export const DEFAULT_HELP_SLUG = HELP_ARTICLES[0].slug;

export function findHelpArticle(slug: string | undefined): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
