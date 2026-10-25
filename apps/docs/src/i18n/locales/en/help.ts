import type { zhHelp } from '../zh/help';

export const enHelp: typeof zhHelp = {
  title: 'Help',
  allArticles: 'All articles',
  onThisPage: 'On this page',
  articlePager: 'Article navigation',
  previous: 'Previous',
  next: 'Next',
  home: {
    eyebrow: 'Jixie Learning Center',
    title: 'Follow a learning path or look up a product page',
    intro:
      'Learning paths connect concepts, real examples, reproducible exercises, and completion checks. The page manual still documents every product workflow.',
    guidedTitle: 'Practice along seven learning paths',
    guidedDescription:
      'Study research, strategies, factor analysis, multi-asset attribution and historical commodity evidence while retaining unfavorable results.',
    guidedAction: 'Start with descriptive research',
    manualTitle: 'Look up a product page',
    manualDescription:
      'When you already know which feature you need, go directly to its current controls, semantics, and limits.',
    manualAction: 'Open product and page navigation',
    paths: {
      research: {
        eyebrow: 'Path one · Descriptive research',
        title: 'Trustworthy cross-market research',
        description:
          'Use monthly CSI 300, Hang Seng, and S&P 500 price indices to learn currency semantics, date alignment, rolling correlation, block bootstrap, and disciplined conclusions.',
        start: 'Start descriptive research',
        stepsTitle: 'How the path progresses',
        steps: {
          question: {
            title: 'Freeze the question',
            description:
              'Write the sample, prior, and falsification condition before seeing results.',
          },
          semantics: {
            title: 'Verify semantics',
            description: 'Separate price indices, ETFs, local returns, and CNY returns.',
          },
          compute: {
            title: 'Compute reproducibly',
            description: 'Build a common complete-month sample from stable IDs.',
          },
          uncertainty: {
            title: 'Express uncertainty',
            description:
              'Inspect full-sample, rolling-window, and block-bootstrap evidence together.',
          },
          conclusion: {
            title: 'Limit the conclusion',
            description:
              'Keep conflicting evidence and avoid turning history into allocation advice.',
          },
        },
      },
      strategy: {
        eyebrow: 'Path two · Strategy research',
        title: 'CSI 300 trend strategy',
        description:
          'Express a moving-average trend as an executable ETF rule, then test it against buy-and-hold, nearby parameters, trading costs, and out-of-sample evidence.',
        start: 'Start strategy research',
        stepsTitle: 'How the path progresses',
        steps: {
          rules: {
            title: 'Freeze the rules',
            description: 'Fix the ETF, signal, position, sample, and falsification conditions.',
          },
          baseline: {
            title: 'Build a baseline',
            description: 'Run buy-and-hold on the same ETF before judging the strategy curve.',
          },
          scan: {
            title: 'Audit parameters',
            description:
              'Precommit a primary value, then compare 20-, 60-, and 120-day sensitivity.',
          },
          costs: {
            title: 'Audit costs',
            description: 'Inspect fills, turnover, fees, slippage, and a stressed-cost run.',
          },
          verdict: {
            title: 'Read out of sample',
            description: 'Keep failures and do not rebrand one backtest as a deployable strategy.',
          },
        },
      },
      factor: {
        eyebrow: 'Path three · Factor research',
        title: 'CSI 300 value factor',
        description:
          'Read the historical CSI 300 earnings-yield case to understand Rank IC, deciles, neutralization and dated samples.',
        start: 'Start Factor research',
        stepsTitle: 'How the path progresses',
        steps: {
          hypothesis: {
            title: 'Define the question',
            description: 'State the expected direction and metrics to inspect.',
          },
          scope: {
            title: 'Freeze the scope',
            description: 'Use point-in-time CSI 300 members and monthly global ranking.',
          },
          rank: {
            title: 'Read ranking evidence',
            description: 'Separate Rank IC, decile returns, and the long-short construction.',
          },
          samples: {
            title: 'Compare dated samples',
            description: 'Check historical report dates and methods before comparing samples.',
          },
          verdict: {
            title: 'Adjudicate evidence',
            description: 'Keep conflicts and failures without automatic publication or conversion.',
          },
        },
      },
      allocation: {
        eyebrow: 'Path four · Allocation attribution',
        title: 'Stock-bond allocation and risk attribution',
        description:
          'Run a monthly stock-bond rotation with a Panel Factor that excludes gold and commodities, then separate allocation, timing, and costs with four actual equity, static, zero-cost, and realistic-cost controls.',
        start: 'Start allocation attribution',
        stepsTitle: 'How the path progresses',
        steps: {
          universe: {
            title: 'Freeze the stock-bond scope',
            description:
              'Separate the Factor domain, Panel research universe, and strategy watchlist.',
          },
          baseline: {
            title: 'Build diagnostic controls',
            description:
              'Run equity, static stock-bond, zero-cost dynamic, and realistic-cost dynamic cases.',
          },
          attribution: {
            title: 'Reconcile return and risk',
            description:
              'Compare average weight, return contribution, risk contribution, and actual costs.',
          },
          correlation: {
            title: 'Read conditional relationships',
            description:
              'Audit rolling stock-bond correlation and historical performance across rate regimes.',
          },
          stress: {
            title: 'Stress and adjudicate',
            description:
              'Separate allocation, timing, and costs while retaining evidence that rejects production.',
          },
        },
      },
      commodity: {
        eyebrow: 'Path five · Commodity research',
        title: 'Historical commodity carry evidence',
        description:
          'Read historical gold, copper, crude-oil and soybean-meal reports to understand term structure, proxy error and unstable findings.',
        start: 'Start commodity research',
        stepsTitle: 'How the path progresses',
        steps: {
          semantics: {
            title: 'Define term structure',
            description: 'Separate carry, continuous return, roll gap, and realized P&L.',
          },
          proxies: {
            title: 'Audit proxy error',
            description: 'Verify differences between actual futures and four mapped ETFs.',
          },
          design: {
            title: 'Read two analyses',
            description: 'Compare cross-sectional and per-product time-series questions.',
          },
          samples: {
            title: 'Inspect dated samples',
            description: 'Compare dates and statistical definitions in historical reports.',
          },
          verdict: {
            title: 'Retain the failure',
            description: 'Do not select after the fact among Rank IC, return, and product t-stats.',
          },
        },
      },
      positiveFactor: {
        eyebrow: 'Path six · Positive admission',
        title: 'Sales yield and Factor admission',
        description:
          'Read the original historical sales-yield reports and inspect source, redundancy, costs and sample sensitivity.',
        start: 'Start positive Factor research',
        stepsTitle: 'How the path progresses',
        steps: {
          definition: {
            title: 'Freeze sales yield',
            description: 'Define 1/PS_TTM, direction, missing values, and the data boundary.',
          },
          gates: {
            title: 'Inspect three evidence groups',
            description: 'Interpret Rank IC, redundancy, costs and supporting evidence together.',
          },
          explore: {
            title: 'Read exploration and redundancy',
            description: 'Confirm direction, then reject an EP, BP, or size relabeling.',
          },
          samples: {
            title: 'Inspect another dated sample',
            description:
              'Read existing results without claiming that another inspection is a new sample.',
          },
          advance: {
            title: 'Advance without skipping stages',
            description:
              'Admit to research while retaining weighting and terminal-month sensitivity.',
          },
        },
      },
    },
    manualSectionTitle: 'Page manual',
    manualSectionDescription:
      'Enter the complete article directory by product area; every article remains bilingual.',
    articleCount: '{{count}} articles',
    manualGroups: {
      gettingStarted: 'Sign-in, navigation, and your first study.',
      basics: 'Market objects, return, risk, and research limits.',
      research: 'Documents, financial data, Agent, embedded analysis, and snapshots.',
      stockDetail: 'Prices, adjustments, valuation, and trading data.',
      backtesting: 'Strategy drafts, report history, comparisons, and portfolio risk.',
      factorResearch: 'Factor definitions, reports, robust inference, and publication.',
      factorWeather: 'Monitor preset and published custom single Factors.',
      marketValuation: 'Market weather, valuation, and historical playback.',
    },
  },
  groups: {
    learningPaths: 'Learning paths',
    gettingStarted: 'Getting started',
    basics: 'Quantitative trading basics',
    research: 'Research workbench',
    stockDetail: 'Object detail',
    backtesting: 'Strategy workbench',
    factorResearch: 'Factor research',
    factorWeather: 'Factor weather',
    marketValuation: 'Market and valuation',
  },
};
