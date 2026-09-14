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

  it('persists request and response evidence before sending data to Python', async () => {
    const events: string[] = [];
    loadReport.mockImplementation(async () => {
      events.push('load');
      return { report: { value: 42 } };
    });
    const session = {
      send: vi.fn(async () => {
        events.push('send');
      }),
    };
    await dispatchResearchRequest(
      'document',
      session,
      {
        type: 'request',
        id: 1,
        method: 'research_factor_report',
        arguments: { report_id: 'report' },
      },
      {
        async beforeRequest() {
          events.push('request');
        },
        async captureResponse(_frame, response) {
          events.push('capture');
          expect(response).toEqual({ result: { report: { value: 42 } } });
        },
      },
    );
    expect(events).toEqual(['request', 'load', 'capture', 'send']);
  });

  it('does not expose persistence or budget failures as catchable Python response errors', async () => {
    loadReport.mockResolvedValue({ report: { value: 42 } });
    const session = { send: vi.fn() };
    await expect(
      dispatchResearchRequest(
        'document',
        session,
        {
          type: 'request',
          id: 1,
          method: 'research_factor_report',
          arguments: { report_id: 'report' },
        },
        {
          beforeRequest: async () => {},
          captureResponse: async () => {
            throw new Error('Evidence storage failed');
          },
        },
      ),
    ).rejects.toThrow('Evidence storage failed');
    expect(session.send).not.toHaveBeenCalled();
  });
});
