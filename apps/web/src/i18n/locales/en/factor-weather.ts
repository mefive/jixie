import type { zhFactorWeather } from '../zh/factor-weather';

export const enFactorWeather: typeof zhFactorWeather = {
  eyebrow: 'FACTOR OBSERVATORY',
  title: 'Factor Weather',
  subtitle:
    'Monitor preset and published custom Factors under one monthly methodology. Colors show net long-short returns aligned to the expected direction.',
  methodology: {
    monthly: 'Month-end rebalance',
    neutral: 'Industry + size neutral',
    weighting: 'Equal-weight deciles',
    completedMonths: 'Completed months only',
  },
  actions: {
    pin: 'Pin factor',
    unpin: 'Unpin',
    retry: 'Recompute',
    cancel: 'Cancel',
  },
  groups: {
    preset: 'Preset factors',
    custom: 'My factors',
    count: '{{count}} cards',
  },
  tags: {
    preset: 'Preset',
    custom: 'Custom',
  },
  direction: {
    positive: 'High values lead',
    negative: 'Low values lead',
  },
  metrics: {
    selectedMonth: '{{month}}',
    trailingThree: 'Trailing 3m',
    trailingTwelve: 'Trailing 12m',
    rollingIc: '12m mean IC',
    rawIc: 'Raw Rank IC {{value}}',
    coverage: 'Coverage {{value}}',
    turnover: 'Top-decile turnover {{value}}',
    sample: 'Sample {{count}}',
    unavailable: 'N/A',
  },
  status: {
    computing: 'Building monthly history',
    computingHint:
      'This runs offline without blocking page requests. The first backfill may take several minutes for long-window factors.',
    error: 'Computation failed',
    errorHint: 'Retry the computation later.',
    noPeriods: 'No completed monthly observations yet',
  },
  picker: {
    title: 'Pin a published Factor',
    factor: 'Factor',
    factorPlaceholder: 'Choose a preset or published Factor',
    direction: 'Expected direction',
    directionHint:
      'Direction only aligns colors and return signs; it never changes the raw Rank IC or factor code.',
    draftHint: 'Publish the Factor with an approved report in Factor Research first.',
    confirm: 'Pin and backfill',
  },
  unpin: {
    title: 'Unpin “{{name}}”?',
    description:
      'This removes the card and its offline monthly observations, without deleting the factor or research reports.',
    confirm: 'Unpin',
  },
  empty: {
    description:
      'No factors are pinned yet. Choose one and the system will backfill monthly performance offline.',
    action: 'Choose first factor',
  },
  messages: {
    loading: 'Loading factor weather…',
    loadFailed: 'Could not load factor weather',
    pinStarted: 'Factor pinned; monthly history is being generated offline',
    operationFailed: 'Operation failed. Please try again.',
  },
  monthTooltip: '{{month}} · Direction-aligned net return {{net}} · Raw IC {{ic}}',
};
