import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadReport = vi.hoisted(() => vi.fn());
vi.mock('../datasets/results/factor-report.js', () => ({
  loadResearchFactorReportResult: loadReport,
}));
import { dispatchResearchRequest } from './dispatch.js';

describe('Research SDK request dispatch boundary', () => {
  beforeEach(() => {
    loadReport.mockReset();
  });

  it('preserves document ownership context and response correlation', async () => {
    const result = { version: 1, report_id: 'report', report: { ic_mean: 0.05 } };
    loadReport.mockResolvedValue(result);
    const session = { send: vi.fn().mockResolvedValue(undefined) };

    await dispatchResearchRequest('document', session, {
      type: 'request',
      id: 17,
      method: 'research_factor_report',
      arguments: { report_id: 'report' },
    });

    expect(loadReport).toHaveBeenCalledWith('document', 'report');
    expect(session.send).toHaveBeenCalledExactlyOnceWith({
      type: 'response',
      id: 17,
      result,
    });
  });

  it('responds to a data failure without converting it into a session failure', async () => {
    loadReport.mockRejectedValue(new Error('Report not found for this document owner'));
    const session = { send: vi.fn().mockResolvedValue(undefined) };

    await dispatchResearchRequest('document', session, {
      type: 'request',
      id: 17,
      method: 'research_factor_report',
      arguments: { report_id: 'report' },
    });

    expect(session.send).toHaveBeenCalledExactlyOnceWith({
      type: 'response',
      id: 17,
      error: 'Report not found for this document owner',
    });
  });

  it('rejects malformed arguments before the data-error response boundary', async () => {
    const session = { send: vi.fn().mockResolvedValue(undefined) };

    await expect(
      dispatchResearchRequest('document', session, {
        type: 'request',
        id: 17,
        method: 'research_factor_report',
        arguments: { report_id: 42 },
      }),
    ).rejects.toThrow();

    expect(loadReport).not.toHaveBeenCalled();
    expect(session.send).not.toHaveBeenCalled();
  });
});
