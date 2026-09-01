import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadBacktestReport: vi.fn(),
}));

vi.mock('./backtest-report-result.js', () => ({
  loadResearchBacktestReportResult: mocks.loadBacktestReport,
}));

import { researchRuntimeManager } from './workbench-runtime.js';

const DOCUMENT_ID = 'research-backtest-report-runtime-test';
let previousLocal: string | undefined;

describe('Research BacktestReport Python runtime bridge', () => {
  beforeEach(() => {
    previousLocal = process.env.JIXIE_PYTHON_LOCAL;
    process.env.JIXIE_PYTHON_LOCAL = '1';
    mocks.loadBacktestReport.mockReset().mockResolvedValue({
      version: 1,
      report_id: 'backtest-report-a',
      report: { sharpe: 1.25 },
    });
  });

  afterEach(() => {
    researchRuntimeManager.close(DOCUMENT_ID);
    if (previousLocal === undefined) {
      delete process.env.JIXIE_PYTHON_LOCAL;
    } else {
      process.env.JIXIE_PYTHON_LOCAL = previousLocal;
    }
  });

  it('loads a report through results.backtest_report without exposing write operations', async () => {
    const execution = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'backtest-report',
      source:
        'backtest_report = results.backtest_report("backtest-report-a")\nbacktest_report["report"]["sharpe"]',
    });

    expect(mocks.loadBacktestReport).toHaveBeenCalledWith(DOCUMENT_ID, 'backtest-report-a');
    expect(execution.outputs).toEqual([{ type: 'value', value: 1.25 }]);
  });
});
