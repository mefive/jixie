import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadReport = vi.hoisted(() => vi.fn());
const replayInput = vi.hoisted(() => vi.fn());
vi.mock('./input-replay.js', () => ({ replayResearchInput: replayInput }));
vi.mock('../../datasets/results/factor-report.js', () => ({
  loadResearchFactorReportResult: loadReport,
}));
import { dispatchResearchRequest } from './dispatch.js';
import { exchangeSandboxCommand } from '#infra/runtime/exchange.js';
import { researchExecutionFrameSchema } from './protocol.js';

const executed = { type: 'research_executed', outputs: [], definitions: [], references: [] };

describe('Research SDK request dispatch boundary', () => {
  beforeEach(() => {
    loadReport.mockReset();
    replayInput.mockReset().mockResolvedValue(undefined);
  });

  it('preserves document ownership context and response correlation', async () => {
    const result = { version: 1, report_id: 'report', report: { ic_mean: 0.05 } };
    loadReport.mockResolvedValue(result);

    const response = await dispatchResearchRequest('document', {
      type: 'request',
      id: 17,
      method: 'research_factor_report',
      arguments: { report_id: 'report' },
    });

    expect(loadReport).toHaveBeenCalledWith('document', 'report');
    expect(response).toEqual({
      type: 'response',
      id: 17,
      result,
    });
  });

  it('responds to a data failure without converting it into a session failure', async () => {
    loadReport.mockRejectedValue(new Error('Report not found for this document owner'));

    const response = await dispatchResearchRequest('document', {
      type: 'request',
      id: 17,
      method: 'research_factor_report',
      arguments: { report_id: 'report' },
    });

    expect(response).toEqual({
      type: 'response',
      id: 17,
      error: 'Report not found for this document owner',
    });
  });

  it('uses a retained response without querying current data', async () => {
    replayInput.mockResolvedValue({ result: { report: { value: 12 } } });
    const frame = {
      type: 'request',
      id: 17,
      method: 'research_factor_report',
      arguments: { report_id: 'report' },
    } as const;
    const response = await dispatchResearchRequest('document', frame);
    expect(replayInput).toHaveBeenCalledWith('document', frame);
    expect(loadReport).not.toHaveBeenCalled();
    expect(response).toEqual({
      type: 'response',
      id: 17,
      result: { report: { value: 12 } },
    });
  });

  it('does not fall through to current data when retained evidence fails validation', async () => {
    replayInput.mockRejectedValue(new Error('Retained input checksum mismatch'));
    await expect(
      dispatchResearchRequest('document', {
        type: 'request',
        id: 17,
        method: 'research_factor_report',
        arguments: { report_id: 'report' },
      }),
    ).rejects.toThrow('Retained input checksum mismatch');
    expect(loadReport).not.toHaveBeenCalled();
  });

  it('rejects malformed arguments before the data-error response boundary', async () => {
    await expect(
      dispatchResearchRequest('document', {
        type: 'request',
        id: 17,
        method: 'research_factor_report',
        arguments: { report_id: 42 },
      }),
    ).rejects.toThrow();

    expect(loadReport).not.toHaveBeenCalled();
  });

  it('persists request and response evidence before the shared exchange sends data to Python', async () => {
    const events: string[] = [];
    loadReport.mockImplementation(async () => {
      events.push('load');
      return { report: { value: 42 } };
    });
    const frames = [
      {
        type: 'request',
        id: 1,
        method: 'research_factor_report',
        arguments: { report_id: 'report' },
      },
      executed,
    ];
    const transport = {
      send: vi.fn(async (frame: { type: string }) => {
        events.push(frame.type);
      }),
    };
    await exchangeSandboxCommand(
      {
        ...transport,
        readValidated: async (schema) => schema.parse(frames.shift()),
      },
      {
        command: { type: 'research_execute' },
        schema: researchExecutionFrameSchema,
        operation: 'testing Research evidence delivery',
        onRequest: (frame) =>
          dispatchResearchRequest('document', frame, {
            async beforeRequest() {
              events.push('request');
            },
            async captureResponse(_frame, response) {
              events.push('capture');
              expect(response).toEqual({ result: { report: { value: 42 } } });
            },
          }),
        result: () => undefined,
      },
    );
    expect(events).toEqual(['research_execute', 'request', 'load', 'capture', 'response']);
  });

  it('does not expose persistence or budget failures as catchable Python response errors', async () => {
    loadReport.mockResolvedValue({ report: { value: 42 } });
    const send = vi.fn(async () => {});
    const frames = [
      {
        type: 'request',
        id: 1,
        method: 'research_factor_report',
        arguments: { report_id: 'report' },
      },
      executed,
    ];
    await expect(
      exchangeSandboxCommand(
        { send, readValidated: async (schema) => schema.parse(frames.shift()) },
        {
          command: { type: 'research_execute' },
          schema: researchExecutionFrameSchema,
          operation: 'testing Research evidence failure',
          onRequest: (frame) =>
            dispatchResearchRequest('document', frame, {
              beforeRequest: async () => {},
              captureResponse: async () => {
                throw new Error('Evidence storage failed');
              },
            }),
          result: () => undefined,
        },
      ),
    ).rejects.toThrow('Evidence storage failed');
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'research_execute' });
  });
});
