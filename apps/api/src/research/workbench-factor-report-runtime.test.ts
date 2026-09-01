import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadFactorReport: vi.fn(),
}));

vi.mock('./factor-report-result.js', () => ({
  loadResearchFactorReportResult: mocks.loadFactorReport,
}));

import { researchRuntimeManager } from './workbench-runtime.js';

const DOCUMENT_ID = 'research-factor-report-runtime-test';
let previousLocal: string | undefined;

describe('Research FactorReport Python runtime bridge', () => {
  beforeEach(() => {
    previousLocal = process.env.JIXIE_PYTHON_LOCAL;
    process.env.JIXIE_PYTHON_LOCAL = '1';
    mocks.loadFactorReport.mockReset().mockResolvedValue({
      version: 1,
      report_id: 'report-a',
      report: { ic_mean: 0.05 },
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

  it('loads a report through results.factor_report without exposing write operations', async () => {
    const execution = await researchRuntimeManager.execute(DOCUMENT_ID, {
      id: 'factor-report',
      source:
        'factor_report = results.factor_report("report-a")\nfactor_report["report"]["ic_mean"]',
    });

    expect(mocks.loadFactorReport).toHaveBeenCalledWith(DOCUMENT_ID, 'report-a');
    expect(execution.outputs).toEqual([{ type: 'value', value: 0.05 }]);
  });
});
