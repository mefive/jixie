import type { zhValuation } from '../zh/valuation';

export const enValuation: typeof zhValuation = {
  marketState: {
    coverage: 'Through {{date}} · {{count}} stocks',
    loadFailed: 'Failed to load market state',
    summaryLabel: 'Current market-state summary',
    threeYearPercentile: '3-year percentile',
    scopeLabel: 'Market-pulse universe',
    readout:
      '{{leader}} leads direction heat, {{active}} is the most actively traded, and {{undervalued}} has the lowest industry valuation position. Current market breadth is {{breadth}}.',
    weather: {
      eyebrow: 'MARKET WEATHER',
      title: 'Shenwan industry weather map',
      subtitle:
        'Scrub the timeline to watch 31 Shenwan level-1 industries warm, broaden, crowd, and cool. Card positions stay fixed; color only represents trading heat.',
      dimensions: {
        industry: {
          label: 'SW industries',
          title: 'Shenwan industry weather',
          subtitle:
            'Track heat, valuation, trading activity, and history across 31 Shenwan level-1 industries.',
        },
        scale: {
          label: 'Market cap',
          title: 'Market-cap weather',
          subtitle:
            'Compare the whole market, large caps, and small caps to see where capital is concentrating.',
        },
        board: {
          label: 'Market boards',
          title: 'Market-board weather',
          subtitle:
            'Compare official exchange, ChiNext, STAR Market, and Beijing Stock Exchange indices.',
        },
        style: {
          label: 'Styles',
          title: 'Style and strategy weather',
          subtitle:
            'Use official growth, value, and dividend indices to read preferences without subjective relabeling.',
        },
      },
      snapshotDate: 'Snapshot {{date}}',
      readout: 'Worth watching: {{attention}}. Overheating or crowding alerts: {{warning}}.',
      frequencies: {
        week: 'Week',
        month: 'Month',
        quarter: 'Quarter',
        year: 'Year',
      },
      groups: {
        financial: 'Financials & property',
        technology: 'Technology & growth',
        resources: 'Cyclicals & resources',
        manufacturing: 'Midstream manufacturing',
        consumer: 'Consumer & services',
        defensive: 'Defensive & public services',
      },
      groupLabels: {
        industry: {
          financial: 'Financials & property',
          technology: 'Technology & growth',
          resources: 'Cyclicals & resources',
          manufacturing: 'Midstream manufacturing',
          consumer: 'Consumer & services',
          defensive: 'Defensive & public services',
        },
        scale: {
          wholeMarket: 'Whole market',
          largeCore: 'Large-cap core',
          largeMid: 'Large and mid cap',
          sizeLadder: 'Size ladder',
        },
        board: {
          exchange: 'Exchange composites',
          innovation: 'Innovation boards',
          beijing: 'Beijing exchange',
        },
        style: {
          csi300: 'CSI 300 styles',
          csi500: 'CSI 500 styles',
          csi800: 'CSI 800 styles',
          csi1000: 'CSI 1000 styles',
          broadStyle: 'SZSE styles',
          income: 'Income strategies',
          coreFactors: 'Core factors',
        },
      },
      states: {
        undervalued: 'Undervalued base',
        warming: 'Warming',
        expanding: 'Broad strength',
        overheated: 'Overheated',
        crowded: 'Crowded high',
        cooling: 'Cooling',
        balanced: 'Watch',
      },
      metrics: {
        heat: 'Heat',
        activity: 'Activity',
        breadth: 'Breadth',
        valuation: 'Valuation',
        relativeReturn: 'Excess',
      },
      valuation: {
        low: 'Low P{{value}}',
        neutral: 'Value P{{value}}',
        high: 'High P{{value}}',
        unknown: 'No valuation',
        official: 'Official valuation',
        constituents: 'Constituent valuation',
      },
      relativeTo: 'vs {{name}}',
      periodLabels: {
        week: 'W{{value}} {{year}}',
        month: '{{value}}/{{year}}',
        quarter: 'Q{{value}} {{year}}',
        year: '{{year}}',
      },
      previous: 'Previous period',
      next: 'Next period',
      play: 'Play market weather',
      pause: 'Pause playback',
      historyTitle: 'Latest {{count}} periods',
      legend: {
        cold: 'Cold',
        hot: 'Overheated',
        note: 'Fill = heat · valuation stays separate · red up, green down',
      },
    },
    index: {
      title: 'Market indices',
      subtitle:
        'Indices are organized by official category across scale, boards, and strategies; they are not relabeled as factor returns.',
    },
    regimes: {
      hotBroad: 'Hot and broad',
      hotNarrow: 'Hot but narrow',
      coldBroad: 'Quiet but broad',
      coldWeak: 'Cold and weak',
      balanced: 'Balanced',
    },
    scopeGroups: {
      broad: 'Broad market',
      boards: 'Board indices',
      styles: 'Strategy indices',
    },
    scopeMetrics: {
      trend: '20D',
      breadth: 'Breadth',
    },
    scopes: {
      all: 'All A-shares',
      '000016_SH': 'SSE 50',
      '000300_SH': 'CSI 300',
      '000905_SH': 'CSI 500',
      '000852_SH': 'CSI 1000',
      '932000_CSI': 'CSI 2000',
      '000510_SH': 'CSI A500',
      '399006_SZ': 'ChiNext',
      '000688_SH': 'STAR 50',
      '000922_CSI': 'CSI Dividend',
    },
    metrics: {
      activity: {
        label: 'Trading activity',
        description: '20-day average of float-cap-weighted turnover within {{scope}}.',
      },
      breadth: {
        label: 'Market breadth',
        description:
          'Equal blend of {{scope}} constituents above their 20-day and 60-day moving averages.',
      },
      trend: {
        label: 'Trend strength',
        description:
          '20-day {{scope}} return; All A-shares uses equal-weight adjusted stock returns.',
      },
      crowding: {
        label: 'Trading crowding',
        description: 'Share of {{scope}} turnover captured by its top 5% most-traded stocks.',
      },
    },
    details: {
      aboveMa20: 'Above MA20',
      aboveMa60: 'Above MA60',
      advance: 'Advanced today',
      limit: 'Closed at limit',
      limitValue: '{{up}} limit-up / {{down}} limit-down',
      amount: '{{scope}} turnover',
      amountValue: 'CNY {{value}} 100m',
    },
    style: {
      title: 'Official style indices',
      subtitle:
        'Only same-family growth/value indices officially classified as style indices are used. Returns are shown growth first, value second.',
      pairs: {
        csi300: 'CSI 300 styles',
        csi500: 'CSI 500 styles',
        csi800: 'CSI 800 styles',
      },
      leadValue: '{{value}} ahead',
      periods: {
        fiveDay: '5D',
        twentyDay: '20D',
        sixtyDay: '60D',
      },
      officialSource: 'Index compiler',
    },
    industryMap: {
      title: 'Industry state map',
      subtitle:
        'The x-axis shows the official SW industry index’s 20-day return and the y-axis shows own-history activity. Bubble size is turnover share; redder color means broader participation.',
      officialReturnAxis: '20D SW industry-index return',
      activityAxis: '3-year activity percentile',
      breadthHigh: 'Broad',
      breadthLow: 'Narrow',
    },
    industry: {
      title: 'Shenwan Level-1 rotation',
      subtitle:
        'Ranked by trend, breadth, and own-history activity. Weekly and monthly moves compare with 5 and 20 trading days ago.',
      asOf: 'As of {{date}}',
      rank: 'Rank',
      name: 'Industry',
      state: 'State',
      valuation: 'Valuation',
      heat: 'Heat',
      breadthScore: 'Breadth',
      activityScore: 'Activity',
      officialReturn20: 'Official 20D',
      pePosition: 'P/E / 10Y pct.',
      pbPosition: 'P/B / 10Y pct.',
      amountShare: 'Turnover share',
      rankChange5Day: 'Weekly move',
      rankChange20Day: 'Monthly move',
      concentration: 'Top-5 share',
      states: {
        overheated: 'Overheated',
        leading: 'Broad leader',
        activeLagging: 'Active laggard',
        cooling: 'Cool',
        balanced: 'Balanced',
      },
      valuationStates: {
        low: 'Low',
        neutral: 'Neutral',
        high: 'High',
        unknown: 'No data',
      },
    },
    history: {
      title: '{{scope}} pulse · 3 years',
      subtitle:
        'Each dimension states a different fact. Switch between them instead of collapsing them into one opaque temperature score.',
      percentAxis: 'Percent',
    },
    methodLabel: 'Method',
    methodAllText:
      'Price windows use adjusted closes. The market universe contains stocks traded that day. Activity, breadth, trend, and crowding remain separate. Percentiles describe how common the state has been over three years and do not forecast returns.',
    methodIndexText:
      'Each index universe uses the latest monthly constituent snapshot available on or before the observation date and carries it forward, avoiding today’s members in historical periods. Trend uses the official index close’s 20-day return; other metrics aggregate point-in-time constituents. Percentiles compare only with that index’s own available three-year history.',
  },
  selectIndex: 'Index',
  updated: 'Data through {{date}}',
  loading: 'Loading latest data',
  loadFailed: 'Failed to load index valuation',
  summaryLabel: 'Current valuation summary',
  tenYearPercentile: '10-year percentile',
  allHistoryPercentile: 'All history',
  low: 'Low',
  high: 'High',
  chartTitle: '{{index}} valuation history',
  chartSubtitle:
    'The dark line is the valuation metric and the light line is the index close. Drag the slider to zoom.',
  indexClose: 'Index close',
  closeAxis: '{{index}} level',
  methodLabel: 'Method',
  methodText:
    'Percentiles are weighted by trading day: valid historical days at or below the current value divided by all valid days. A level that persists longer carries more weight. The 10-year view uses a calendar-date cutoff; all history begins with the first available valuation observation.',
  metrics: {
    peTtm: 'P/E (TTM)',
    pb: 'P/B',
    pe: 'Static P/E',
    turnoverRate: 'Turnover',
  },
  range: {
    fiveYear: '5 years',
    tenYear: '10 years',
    all: 'All',
  },
  indices: {
    sseComposite: 'SSE Composite',
    sse50: 'SSE 50',
    csi300: 'CSI 300',
    csi500: 'CSI 500',
    szComponent: 'SZSE Component',
    sme: 'SME Board',
    chiNext: 'ChiNext',
    unknown: 'Index',
  },
};
