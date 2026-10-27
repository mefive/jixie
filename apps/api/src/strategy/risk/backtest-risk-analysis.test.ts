import { beforeEach, expect, it, vi } from 'vitest';
import type { BacktestResult } from '../backtests/result.js';
import { attachBacktestRiskAnalysis, buildBacktestRiskAnalysis } from './backtest-risk-analysis.js';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  estimate: vi.fn(),
  load: vi.fn(),
}));
vi.mock('./macro-risk-model.js', () => ({
  aggregatePortfolioMonthlyReturns: mocks.aggregate,
  estimatePortfolioMacroRisk: mocks.estimate,
}));
vi.mock('#market/macro/risk-axes.js', () => ({ loadMacroRiskAxisHistory: mocks.load }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aggregate.mockReturnValue([{ date: '20240131', return: 0.1 }]);
  mocks.estimate.mockReturnValue({ version: 1, frequency: 'monthly' });
  mocks.load.mockResolvedValue({ observations: [] });
});

function result(): BacktestResult {
  return {
    start: '20240101',
    end: '20240131',
    nav: [
      { date: '20240101', value: 200 },
      { date: '20240131', value: 500 },
    ],
    allocationAnalysis: {
      scope: 'cash_account',
      nav: [
        { date: '20240101', value: 100 },
        { date: '20240131', value: 110 },
      ],
    },
  } as BacktestResult;
}

it('preserves cash-account return selection and adds only the independent macro estimate', () => {
  const history = { observations: [] } as never;
  expect(buildBacktestRiskAnalysis(result(), { macroHistory: history })).toEqual({
    version: 1,
    separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity',
    macro: { version: 1, frequency: 'monthly' },
  });
  expect(mocks.aggregate.mock.calls[0][0][0].return).toBeCloseTo(0.1);
  expect(mocks.estimate).toHaveBeenCalledWith(mocks.aggregate.mock.results[0].value, history, {
    asOfDate: '20240131',
  });
});

it.each([
  undefined,
  [],
  [
    { date: '20240101', value: 0 },
    { date: '20240131', value: 0 },
  ],
])('never substitutes the portfolio path for unavailable cash NAV (%j)', (nav) => {
  const report = result();
  report.allocationAnalysis!.nav = nav;
  expect(
    buildBacktestRiskAnalysis(report, { macroHistory: { observations: [] } as never }),
  ).toBeUndefined();
  expect(mocks.estimate).not.toHaveBeenCalled();
});

it('does not create daily risk vectors or scenarios when macro history is unavailable', () => {
  expect(buildBacktestRiskAnalysis(result(), {})).toBeUndefined();
  expect(mocks.estimate).not.toHaveBeenCalled();
});

it('loads only the retained macro interval for a completed cash backtest', async () => {
  const report = result();
  const database = {} as never;
  await attachBacktestRiskAnalysis(report, database);
  expect(mocks.load).toHaveBeenCalledWith(
    { startDate: report.start, endDate: report.end, revisionPolicy: 'latest_vintage' },
    database,
  );
  expect(report.allocationAnalysis!.risk).toHaveProperty('macro');
  expect(report.allocationAnalysis!.risk).not.toHaveProperty('market');
});
