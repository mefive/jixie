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
    guidedTitle: 'Practice along two learning paths',
    guidedDescription:
      'Build trustworthy evidence first, then turn a hypothesis into an executable strategy that can withstand scrutiny.',
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
    },
    manualSectionTitle: 'Page manual',
    manualSectionDescription:
      'Enter the complete article directory by product area; every article remains bilingual.',
    articleCount: '{{count}} articles',
    manualGroups: {
      gettingStarted: 'Sign-in, navigation, and your first study.',
      basics: 'Market objects, return, risk, and research limits.',
      research: 'Documents, data, runs, Agent collaboration, and snapshots.',
      publicLibrary: 'Share and copy public research assets.',
      stockDetail: 'Prices, adjustments, valuation, and trading data.',
      backtesting: 'Strategies, runs, results, costs, and portfolio risk.',
      factorResearch: 'Factor definitions, reports, robust inference, and publication.',
      factorWeather: 'Monitor recent conditions for published Factors.',
      marketValuation: 'Market weather, valuation, and historical playback.',
      signals: 'Deployments, signals, conditional orders, and execution records.',
    },
  },
  groups: {
    learningPaths: 'Learning paths',
    gettingStarted: 'Getting started',
    basics: 'Quantitative trading basics',
    research: 'Natural-language research',
    publicLibrary: 'Public Library',
    stockDetail: 'Object detail',
    backtesting: 'Backtest workspace',
    factorResearch: 'Factor research',
    factorWeather: 'Factor weather',
    marketValuation: 'Market and valuation',
    signals: 'Today signals',
  },
};
