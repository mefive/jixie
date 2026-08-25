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
    guidedTitle: 'Practice along five learning paths',
    guidedDescription:
      'Move from trustworthy research, strategy, and Factor evidence into auditable backtests, signal governance, multi-asset attribution, and stress scenarios while retaining failures.',
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
          'Freeze a CSI 300 stock-cross-section question with the earnings-yield preset, then adjudicate Rank IC, deciles, neutralization, and one formal holdout reveal.',
        start: 'Start Factor research',
        stepsTitle: 'How the path progresses',
        steps: {
          hypothesis: {
            title: 'Preregister the hypothesis',
            description: 'Freeze the positive prior, primary criterion, and sole diagnostic.',
          },
          scope: {
            title: 'Freeze the scope',
            description: 'Use point-in-time CSI 300 members and monthly global ranking.',
          },
          rank: {
            title: 'Read ranking evidence',
            description: 'Separate Rank IC, decile returns, and the long-short construction.',
          },
          holdout: {
            title: 'Reveal the holdout',
            description: 'Verify the frozen protocol and make one irreversible reveal.',
          },
          verdict: {
            title: 'Adjudicate evidence',
            description: 'Keep conflicts and failures without automatic publication or conversion.',
          },
        },
      },
      signal: {
        eyebrow: 'Path four · Signal governance',
        title: 'From the CGB curve to a daily signal',
        description:
          'Connect a government-yield Factor to a formal holdout, costed backtest, deployment, and specified-date signal while separating correct execution from admissible evidence.',
        start: 'Start signal governance',
        stepsTitle: 'How the path progresses',
        steps: {
          evidence: {
            title: 'Set an evidence gate',
            description: 'Freeze the curve hypothesis and robust-t criterion first.',
          },
          lineage: {
            title: 'Retain failed evidence',
            description: 'Reveal one formal holdout and accept its sign reversal.',
          },
          backtest: {
            title: 'Audit the costed backtest',
            description: 'Trace Factor key, code hash, costs, and actual simulated fills.',
          },
          deploy: {
            title: 'Freeze the deployment',
            description: 'Verify that strategy and curve input enter an immutable run version.',
          },
          audit: {
            title: 'Audit the daily signal',
            description:
              'Separate instructions, model fills, and actual execution, then pause a failed candidate.',
          },
        },
      },
      allocation: {
        eyebrow: 'Path five · Allocation attribution',
        title: 'Stock-bond allocation and risk attribution',
        description:
          'Run a monthly stock-bond rotation with a Panel Factor that excludes gold and commodities, compare it with an equity baseline, and audit return, concentrated risk, correlation, rate regimes, and stress scenarios.',
        start: 'Start allocation attribution',
        stepsTitle: 'How the path progresses',
        steps: {
          universe: {
            title: 'Freeze the stock-bond scope',
            description:
              'Separate the Factor domain, Panel research universe, and strategy watchlist.',
          },
          baseline: {
            title: 'Build the equity baseline',
            description: 'Run CSI 300 buy-and-hold with identical dates, capital, and costs.',
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
              'Separate linear scenarios, historical replays, and forecasts while retaining inferior returns.',
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
