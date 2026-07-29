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
import equityDrawdownEn from '@src/content/help/en/backtesting/equity-drawdown.md?raw';
import equityDrawdownZh from '@src/content/help/zh/backtesting/equity-drawdown.md?raw';
import resultsOverviewEn from '@src/content/help/en/backtesting/results-overview.md?raw';
import resultsOverviewZh from '@src/content/help/zh/backtesting/results-overview.md?raw';
import runAndLogsEn from '@src/content/help/en/backtesting/run-and-logs.md?raw';
import runAndLogsZh from '@src/content/help/zh/backtesting/run-and-logs.md?raw';
import runSettingsEn from '@src/content/help/en/backtesting/run-settings.md?raw';
import runSettingsZh from '@src/content/help/zh/backtesting/run-settings.md?raw';
import tradesCostsEn from '@src/content/help/en/backtesting/trades-costs.md?raw';
import tradesCostsZh from '@src/content/help/zh/backtesting/trades-costs.md?raw';
import workspaceEn from '@src/content/help/en/backtesting/workspace.md?raw';
import workspaceZh from '@src/content/help/zh/backtesting/workspace.md?raw';
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
import conversationsEn from '@src/content/help/en/screening/conversations.md?raw';
import conversationsZh from '@src/content/help/zh/screening/conversations.md?raw';
import directQueryEn from '@src/content/help/en/screening/direct-query.md?raw';
import directQueryZh from '@src/content/help/zh/screening/direct-query.md?raw';
import editSortEn from '@src/content/help/en/screening/edit-sort.md?raw';
import editSortZh from '@src/content/help/zh/screening/edit-sort.md?raw';
import filterResultsEn from '@src/content/help/en/screening/filter-results.md?raw';
import filterResultsZh from '@src/content/help/zh/screening/filter-results.md?raw';
import saveReuseEn from '@src/content/help/en/screening/save-reuse.md?raw';
import saveReuseZh from '@src/content/help/zh/screening/save-reuse.md?raw';
import adjustmentsScaleEn from '@src/content/help/en/stock-detail/adjustments-scale.md?raw';
import adjustmentsScaleZh from '@src/content/help/zh/stock-detail/adjustments-scale.md?raw';
import peVolumeDataEn from '@src/content/help/en/stock-detail/pe-volume-data.md?raw';
import peVolumeDataZh from '@src/content/help/zh/stock-detail/pe-volume-data.md?raw';
import readChartEn from '@src/content/help/en/stock-detail/read-chart.md?raw';
import readChartZh from '@src/content/help/zh/stock-detail/read-chart.md?raw';

export const HELP_GROUPS = [
  'gettingStarted',
  'basics',
  'screening',
  'stockDetail',
  'backtesting',
] as const;
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
  {
    slug: 'screening/direct-query',
    group: 'screening',
    title: {
      zh: '直接查询股票或 ETF',
      en: 'Query a stock or ETF directly',
    },
    summary: {
      zh: '按名称或代码查询标的，并核对名称、时间范围和数据日期。',
      en: 'Query by name or code and verify the instrument, period, and data date.',
    },
    content: {
      zh: directQueryZh,
      en: directQueryEn,
    },
  },
  {
    slug: 'screening/filter-results',
    group: 'screening',
    title: {
      zh: '按条件筛选并查看结果',
      en: 'Screen by criteria and inspect results',
    },
    summary: {
      zh: '输入筛选条件，检查页面实际执行的规则、快照日期和结果表。',
      en: 'Enter criteria and inspect the executed rules, snapshot date, and result table.',
    },
    content: {
      zh: filterResultsZh,
      en: filterResultsEn,
    },
  },
  {
    slug: 'screening/edit-sort',
    group: 'screening',
    title: {
      zh: '修改条件和排序',
      en: 'Edit conditions and sorting',
    },
    summary: {
      zh: '修改字段、比较符号和数值，增加或删除条件，并调整结果顺序。',
      en: 'Edit fields, operators, and values; add or remove conditions; and change row order.',
    },
    content: {
      zh: editSortZh,
      en: editSortEn,
    },
  },
  {
    slug: 'screening/save-reuse',
    group: 'screening',
    title: {
      zh: '保存并再次运行筛选',
      en: 'Save and rerun a screen',
    },
    summary: {
      zh: '保存筛选规则，并了解重新打开时为什么会使用最新数据。',
      en: 'Save screening rules and understand why reopening uses current data.',
    },
    content: {
      zh: saveReuseZh,
      en: saveReuseEn,
    },
  },
  {
    slug: 'screening/conversations',
    group: 'screening',
    title: {
      zh: '使用历史对话',
      en: 'Use conversations',
    },
    summary: {
      zh: '新建、继续和删除对话，并区分历史对话与已保存筛选。',
      en: 'Start, continue, and delete chats, and distinguish them from saved screens.',
    },
    content: {
      zh: conversationsZh,
      en: conversationsEn,
    },
  },
  {
    slug: 'stock-detail/read-chart',
    group: 'stockDetail',
    title: {
      zh: '查看股票详情和 K 线',
      en: 'Read Stock detail and candlesticks',
    },
    summary: {
      zh: '从筛选结果打开股票详情，认识 K 线、时间范围和最新数据日期。',
      en: 'Open Stock detail from a screen and read candlesticks, time range, and the latest date.',
    },
    content: {
      zh: readChartZh,
      en: readChartEn,
    },
  },
  {
    slug: 'stock-detail/adjustments-scale',
    group: 'stockDetail',
    title: {
      zh: '切换复权和价格坐标',
      en: 'Switch adjustment and price scale',
    },
    summary: {
      zh: '区分前复权、后复权和不复权，并选择线性或对数坐标。',
      en: 'Distinguish adjustment modes and choose a linear or logarithmic price scale.',
    },
    content: {
      zh: adjustmentsScaleZh,
      en: adjustmentsScaleEn,
    },
  },
  {
    slug: 'stock-detail/pe-volume-data',
    group: 'stockDetail',
    title: {
      zh: '查看 PE、成交量和数据日期',
      en: 'Read PE, volume, and data dates',
    },
    summary: {
      zh: '正确使用价格和 PE 的不同纵轴，查看成交量并核对数据截止日期。',
      en: 'Use the separate price and PE axes, inspect volume, and verify the data end date.',
    },
    content: {
      zh: peVolumeDataZh,
      en: peVolumeDataEn,
    },
  },
  {
    slug: 'backtesting/workspace',
    group: 'backtesting',
    title: {
      zh: '认识回测工作台',
      en: 'Understand the Backtest workspace',
    },
    summary: {
      zh: '认识策略、代码、结果和日志区域，并正确打开、新建和切换策略。',
      en: 'Learn the strategy, code, results, and logs areas, and open or create a strategy.',
    },
    content: {
      zh: workspaceZh,
      en: workspaceEn,
    },
  },
  {
    slug: 'backtesting/run-settings',
    group: 'backtesting',
    title: {
      zh: '设置回测参数',
      en: 'Set backtest parameters',
    },
    summary: {
      zh: '设置日期、资金、基础滑点和冲击系数，并检查策略自身参数。',
      en: 'Set dates, capital, base slippage, and impact, and check strategy parameters.',
    },
    content: {
      zh: runSettingsZh,
      en: runSettingsEn,
    },
  },
  {
    slug: 'backtesting/run-and-logs',
    group: 'backtesting',
    title: {
      zh: '运行回测和查看日志',
      en: 'Run a backtest and inspect logs',
    },
    summary: {
      zh: '正确提交回测，查看运行状态、实时日志、完成结果和失败信息。',
      en: 'Submit a run correctly and inspect progress, logs, completion, and failures.',
    },
    content: {
      zh: runAndLogsZh,
      en: runAndLogsEn,
    },
  },
  {
    slug: 'backtesting/results-overview',
    group: 'backtesting',
    title: {
      zh: '查看回测结果',
      en: 'Inspect backtest results',
    },
    summary: {
      zh: '按顺序检查成交、收益、风险、成本、净值和日志。',
      en: 'Review trades, return, risk, costs, equity, and logs in a reliable order.',
    },
    content: {
      zh: resultsOverviewZh,
      en: resultsOverviewEn,
    },
  },
  {
    slug: 'backtesting/equity-drawdown',
    group: 'backtesting',
    title: {
      zh: '查看净值、回撤和月度收益',
      en: 'Read equity, drawdown, and monthly returns',
    },
    summary: {
      zh: '切换净值和回撤图，比较基准，并阅读月度收益表。',
      en: 'Switch equity and drawdown views, compare a benchmark, and read monthly returns.',
    },
    content: {
      zh: equityDrawdownZh,
      en: equityDrawdownEn,
    },
  },
  {
    slug: 'backtesting/trades-costs',
    group: 'backtesting',
    title: {
      zh: '查看交易明细和成本',
      en: 'Inspect trades and costs',
    },
    summary: {
      zh: '核对成交日期、方向、数量、价格、手续费和滑点。',
      en: 'Verify fill dates, directions, quantities, prices, fees, and slippage.',
    },
    content: {
      zh: tradesCostsZh,
      en: tradesCostsEn,
    },
  },
];

export const DEFAULT_HELP_SLUG = HELP_ARTICLES[0].slug;

export function findHelpArticle(slug: string | undefined): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
