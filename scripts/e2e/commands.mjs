export const e2eCommands = [
  {
    name: 'job-system',
    file: 'apps/web/e2e/job-system.mjs',
    group: 'isolated',
    notes:
      'Build shared and Web. Real scheduler and Workers against synthetic market data, a local model and a disposable database. Run embedded-analysis separately for the seventh lifecycle.',
  },
  {
    name: 'research-curator',
    file: 'apps/web/e2e/research-curator.mjs',
    group: 'research',
  },
  {
    name: 'research-affected',
    file: 'apps/web/e2e/research-affected-run.mjs',
    group: 'research',
  },
  {
    name: 'research-interrupt',
    file: 'apps/web/e2e/research-interrupt.mjs',
    group: 'research',
  },
  {
    name: 'research-charts',
    file: 'apps/web/e2e/research-chart-gallery.mjs',
    group: 'research',
  },
  {
    name: 'research-matplotlib',
    file: 'apps/web/e2e/research-matplotlib.mjs',
    group: 'research',
  },
  {
    name: 'research-table',
    file: 'apps/web/e2e/research-table-preview.mjs',
    group: 'research',
  },
  {
    name: 'research-equity-panel',
    file: 'apps/web/e2e/research-equity-panel.mjs',
    group: 'research',
  },
  {
    name: 'research-cell-changes',
    file: 'apps/web/e2e/research-cell-change-proposal.mjs',
    group: 'research',
  },
  {
    name: 'research-cell-change-review',
    file: 'apps/web/e2e/research-cell-change-review.mjs',
    group: 'research',
  },
  {
    name: 'research-clarification',
    file: 'apps/web/e2e/research-clarification.mjs',
    group: 'research',
  },
  {
    name: 'research-yield-runtime',
    file: 'apps/web/e2e/research-yield-runtime.mjs',
    group: 'research',
  },
  {
    name: 'research-autosave',
    file: 'apps/web/e2e/research-autosave.mjs',
    group: 'research',
  },
  {
    name: 'research-executions',
    file: 'apps/web/e2e/research-execution.mjs',
    group: 'research',
  },
  {
    name: 'research-mobile',
    file: 'apps/web/e2e/research-mobile.mjs',
    group: 'research',
  },
  {
    name: 'research-agent-cell-context',
    file: 'apps/web/e2e/research-agent-cell-context.mjs',
    group: 'research',
  },
  {
    name: 'research-cell-deletion',
    file: 'apps/web/e2e/research-cell-deletion.mjs',
    group: 'research',
  },
  {
    name: 'research-data-catalog',
    file: 'apps/web/e2e/research-data-catalog.mjs',
    group: 'research',
  },
  {
    name: 'research-financial-data',
    file: 'apps/web/e2e/research-financial-data.mjs',
    group: 'research',
  },
  {
    name: 'research-fcff-valuation',
    file: 'apps/web/e2e/research-fcff-valuation.mjs',
    group: 'research',
  },
  {
    name: 'research-fcff-reuse',
    file: 'apps/web/e2e/research-fcff-reuse.mjs',
    group: 'research',
    nodeArgs: ['--import', 'tsx'],
  },
  {
    name: 'research-documents',
    file: 'apps/web/e2e/research-document-management.mjs',
    group: 'research',
  },
  {
    name: 'research-factor-report',
    file: 'apps/web/e2e/research-factor-report-sdk.mjs',
    group: 'research',
  },
  {
    name: 'research-factor-report-catalog',
    file: 'apps/web/e2e/research-factor-report-catalog.mjs',
    group: 'research',
  },
  {
    name: 'research-backtest-report-catalog',
    file: 'apps/web/e2e/research-backtest-report-catalog.mjs',
    group: 'research',
  },
  {
    name: 'learning-cross-market',
    file: 'apps/web/e2e/learning-cross-market-case.mjs',
    group: 'learning',
  },
  {
    name: 'learning-trend-strategy',
    file: 'apps/web/e2e/learning-trend-strategy-case.mjs',
    group: 'learning',
  },
  {
    name: 'learning-value-factor',
    file: 'apps/web/e2e/learning-value-factor-case.mjs',
    group: 'learning',
  },
  {
    name: 'learning-cgb-signal',
    file: 'apps/web/e2e/learning-cgb-signal-case.mjs',
    group: 'learning',
  },
  {
    name: 'learning-stock-bond-allocation',
    file: 'apps/web/e2e/learning-stock-bond-allocation-case.mjs',
    group: 'learning',
  },
  {
    name: 'learning-commodity-carry',
    file: 'apps/web/e2e/learning-commodity-carry-case.mjs',
    group: 'learning',
  },
  {
    name: 'learning-sales-yield-positive',
    file: 'apps/web/e2e/learning-sales-yield-positive-case.mjs',
    group: 'learning',
  },
  {
    name: 'factor-history',
    file: 'apps/web/e2e/factor-report-history.mjs',
    group: 'factor',
  },
  {
    name: 'factor-correlation',
    file: 'apps/web/e2e/factor-correlation.mjs',
    group: 'factor',
  },
  {
    name: 'factor-composite',
    file: 'apps/web/e2e/factor-composite.mjs',
    group: 'factor',
  },
  {
    name: 'factor-scope',
    file: 'apps/web/e2e/factor-evaluation-scope.mjs',
    group: 'factor',
  },
  {
    name: 'factor-robust',
    file: 'apps/web/e2e/factor-robust-inference.mjs',
    group: 'factor',
  },
  {
    name: 'factor-publication',
    file: 'apps/web/e2e/factor-publication.mjs',
    group: 'factor',
  },
  {
    name: 'factor-python',
    file: 'apps/web/e2e/python-factor.mjs',
    group: 'factor',
  },
  {
    name: 'factor-sdk',
    file: 'apps/web/e2e/factor-sdk.mjs',
    group: 'factor',
    notes:
      'Development Web/API; verifies TS Factor SDK hovers, types and autosave in both locales.',
  },
  {
    name: 'historical-investability',
    file: 'apps/web/e2e/historical-investability.mjs',
    group: 'market',
  },
  {
    name: 'chart',
    file: 'apps/web/e2e/computed-chart.mjs',
    group: 'platform',
  },
  {
    name: 'sdk-hover',
    file: 'apps/web/e2e/sdk-hover.mjs',
    group: 'platform',
  },
  {
    name: 'factor-strategy-history',
    file: 'apps/web/e2e/factor-strategy-history.mjs',
    group: 'factor',
  },
  {
    name: 'strategy-factor-dependency',
    file: 'apps/web/e2e/strategy-factor-dependency.mjs',
    group: 'strategy',
  },
  {
    name: 'custom-time-series-factor',
    file: 'apps/web/e2e/custom-time-series-factor.mjs',
    group: 'factor',
  },
  {
    name: 'bond-curve-factor',
    file: 'apps/web/e2e/bond-curve-factor.mjs',
    group: 'factor',
  },
  {
    name: 'bond-curve-signal',
    file: 'apps/web/e2e/bond-curve-signal.mjs',
    group: 'signals',
  },
  {
    name: 'factor-panel',
    file: 'apps/web/e2e/factor-panel.mjs',
    group: 'factor',
  },
  {
    name: 'commodity-carry-panel',
    file: 'apps/web/e2e/commodity-carry-panel.mjs',
    group: 'factor',
  },
  {
    name: 'commodity-carry-time-series',
    file: 'apps/web/e2e/commodity-carry-time-series.mjs',
    group: 'factor',
  },
  {
    name: 'commodity-warehouse-receipt',
    file: 'apps/web/e2e/commodity-warehouse-receipt-time-series.mjs',
    group: 'factor',
  },
  {
    name: 'factor-panel-composite',
    file: 'apps/web/e2e/factor-panel-composite.mjs',
    group: 'factor',
  },
  {
    name: 'strategy',
    file: 'apps/web/e2e/strategy-orchestration.mjs',
    group: 'strategy',
  },
  {
    name: 'backtest-report-history',
    file: 'apps/web/e2e/backtest-report-history.mjs',
    group: 'strategy',
  },
  {
    name: 'strategy-indicators',
    file: 'apps/web/e2e/technical-indicators.mjs',
    group: 'strategy',
  },
  {
    name: 'public-library',
    file: 'apps/web/e2e/public-library.mjs',
    group: 'platform',
  },
  {
    name: 'strategy-python',
    file: 'apps/web/e2e/python-strategy.mjs',
    group: 'strategy',
  },
  {
    name: 'strategy-scan',
    file: 'apps/web/e2e/strategy-parameter-scan.mjs',
    group: 'strategy',
  },
  {
    name: 'signals',
    file: 'apps/web/e2e/daily-signals.mjs',
    group: 'signals',
  },
  {
    name: 'etf',
    file: 'apps/web/e2e/etf-trading.mjs',
    group: 'market',
  },
  {
    name: 'market-state',
    file: 'apps/web/e2e/market-state.mjs',
    group: 'market',
  },
  {
    name: 'factor-weather',
    file: 'apps/web/e2e/factor-weather.mjs',
    group: 'factor',
  },
  {
    name: 'login-error',
    file: 'apps/web/e2e/login-error.mjs',
    group: 'platform',
  },
  {
    name: 'maintenance-fallback',
    file: 'apps/web/e2e/maintenance-fallback.mjs',
    group: 'platform',
  },
  {
    name: 'docs-help',
    file: 'apps/docs/e2e/help.mjs',
    group: 'docs',
  },
  {
    name: 'embedded-analysis',
    file: 'apps/web/e2e/embedded-analysis.mjs',
    group: 'isolated',
    notes:
      'Build shared and Web; requires the Research Python runtime. Starts an isolated API/model fixture.',
  },
  {
    name: 'factor-questions',
    file: 'apps/web/e2e/factor-questions.mjs',
    group: 'isolated',
    notes: 'Build shared and Web. Starts an isolated API/model fixture.',
  },
  {
    name: 'factor-question-recovery',
    file: 'apps/web/e2e/factor-question-recovery.mjs',
    group: 'browser',
    notes:
      'Web service only; HTTP/SSE fixtures. Frontend recovery regression, not full-stack acceptance.',
  },
  {
    name: 'strategy-navigation',
    file: 'apps/web/e2e/strategy-navigation.mjs',
    group: 'browser',
    notes: 'Web service only; API fixtures. Frontend navigation regression.',
  },
  {
    name: 'research-financial-help',
    file: 'apps/web/e2e/research-financial-help.mjs',
    group: 'docs',
    notes: 'Docs service at E2E_DOCS_BASE (default http://localhost:5174).',
  },
  {
    name: 'mixed-futures',
    file: 'apps/web/e2e/mixed-futures.mjs',
    group: 'market',
    notes: 'Running Web/API and futures data; executes real backtests.',
  },
  {
    name: 'report-deployments',
    file: 'apps/web/e2e/report-deployments.mjs',
    group: 'signals',
    notes: 'Disposable API database required; set E2E_ISOLATED_DB=1. Retains deployment history.',
  },
];

export const imageCommands = [
  {
    name: 'refresh',
    file: 'apps/web/e2e/help-content-refresh.mjs',
    group: 'capture',
    notes:
      'Disposable local API; HELP_CAPTURE_DISPOSABLE=1 and HELP_CAPTURE_CONFIG required. See help-content-refresh.md.',
  },
  {
    name: 'getting-started',
    file: 'apps/web/e2e/help-content.mjs',
    group: 'capture',
  },
  {
    name: 'backtest',
    file: 'apps/web/e2e/help-content-backtest.mjs',
    group: 'capture',
  },
  {
    name: 'backtest-states',
    file: 'apps/web/e2e/help-content-backtest-states.mjs',
    group: 'capture',
  },
  {
    name: 'parameter-scan',
    file: 'apps/web/e2e/help-content-parameter-scan.mjs',
    group: 'capture',
  },
  {
    name: 'etf-futures',
    file: 'apps/web/e2e/help-content-etf-futures.mjs',
    group: 'capture',
  },
  {
    name: 'strategy-agent',
    file: 'apps/web/e2e/help-content-strategy-agent.mjs',
    group: 'capture',
  },
  {
    name: 'factor-basics',
    file: 'apps/web/e2e/help-content-factor-basics.mjs',
    group: 'capture',
  },
  {
    name: 'factor-metrics',
    file: 'apps/web/e2e/help-content-factor-metrics.mjs',
    group: 'capture',
  },
  {
    name: 'factor-discipline',
    file: 'apps/web/e2e/help-content-factor-discipline.mjs',
    group: 'capture',
  },
  {
    name: 'factor-custom',
    file: 'apps/web/e2e/help-content-factor-custom.mjs',
    group: 'capture',
  },
  {
    name: 'factor-composite',
    file: 'apps/web/e2e/help-content-factor-composite.mjs',
    group: 'capture',
  },
  {
    name: 'factor-weather',
    file: 'apps/web/e2e/help-content-factor-weather.mjs',
    group: 'capture',
  },
  {
    name: 'latest',
    file: 'apps/web/e2e/help-content-latest.mjs',
    group: 'annotate',
  },
  {
    name: 'stage-l',
    file: 'apps/web/e2e/help-content-stage-l.mjs',
    group: 'annotate',
  },
  {
    name: 'stage-m',
    file: 'apps/web/e2e/help-content-stage-m.mjs',
    group: 'annotate',
  },
  {
    name: 'market-valuation',
    file: 'apps/web/e2e/help-content-market-valuation.mjs',
    group: 'capture',
  },
  {
    name: 'signals',
    file: 'apps/web/e2e/help-content-signals.mjs',
    group: 'capture',
  },
];
