import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

const loadReport = vi.hoisted(() => vi.fn());
vi.mock('../../datasets/results/factor-report.js', () => ({
  loadResearchFactorReportResult: loadReport,
}));
import { dispatchResearchRequest } from './dispatch.js';
import { SandboxBridgeBase, type SandboxExchange } from '#infra/sandbox/sandbox-bridge-base.js';
import { researchCellRunFrameSchema } from './protocol.js';

class BridgeFixture extends SandboxBridgeBase<
  SandboxExchange<z.infer<typeof researchCellRunFrameSchema>, void>,
  void,
  void
> {
  initialize(): Promise<void> {
    return Promise.resolve();
  }

  execute(
    exchange: SandboxExchange<z.infer<typeof researchCellRunFrameSchema>, void>,
  ): Promise<void> {
    return super.exchange(exchange);
  }
}

const executed = { type: 'research_executed', outputs: [], definitions: [], references: [] };

describe('Research SDK request dispatch boundary', () => {
  beforeEach(() => {
    loadReport.mockReset();
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

  it('fetches current data on each call and reports a later missing source', async () => {
    const frame = {
      type: 'request' as const,
      id: 17,
      method: 'research_factor_report' as const,
      arguments: { report_id: 'report' },
    };
    loadReport
      .mockResolvedValueOnce({ report: { value: 12 } })
      .mockResolvedValueOnce({ report: { value: 24 } })
      .mockRejectedValueOnce(new Error('Source removed'));
    expect(await dispatchResearchRequest('document', frame)).toMatchObject({
      result: { report: { value: 12 } },
    });
    expect(await dispatchResearchRequest('document', frame)).toMatchObject({
      result: { report: { value: 24 } },
    });
    expect(await dispatchResearchRequest('document', frame)).toMatchObject({
      error: 'Source removed',
    });
    expect(loadReport).toHaveBeenCalledTimes(3);
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

  it('loads current data before the shared exchange sends it to Python', async () => {
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
    const bridge = new BridgeFixture({
      ...transport,
      readValidated: async (schema) => schema.parse(frames.shift()),
      close: vi.fn(),
      abort: vi.fn(),
      isClosed: false,
    });

    await bridge.execute({
      command: { type: 'research_execute' },
      schema: researchCellRunFrameSchema,
      operation: 'testing Research evidence delivery',
      onRequest: (frame) => dispatchResearchRequest('document', frame),
      result: () => undefined,
    });
    expect(events).toEqual(['research_execute', 'load', 'response']);
  });
});
