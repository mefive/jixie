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
    guidedTitle: 'Practice along a learning path',
    guidedDescription:
      'Build research skill systematically, from a precise question to an auditable conclusion.',
    guidedAction: 'View trustworthy research foundations',
    manualTitle: 'Look up a product page',
    manualDescription:
      'When you already know which feature you need, go directly to its current controls, semantics, and limits.',
    manualAction: 'Open product and page navigation',
    pathEyebrow: 'First learning path',
    pathTitle: 'Trustworthy cross-market research',
    pathDescription:
      'Use monthly CSI 300, Hang Seng, and S&P 500 price indices to learn currency semantics, date alignment, rolling correlation, block bootstrap, and disciplined conclusions.',
    pathStart: 'Start this learning path',
    pathStepsTitle: 'How the path progresses',
    pathSteps: {
      question: {
        title: 'Freeze the question',
        description: 'Write the sample, prior, and falsification condition before seeing results.',
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
        description: 'Inspect full-sample, rolling-window, and block-bootstrap evidence together.',
      },
      conclusion: {
        title: 'Limit the conclusion',
        description: 'Keep conflicting evidence and avoid turning history into allocation advice.',
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
