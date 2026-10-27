import type { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SandboxTransport } from '#infra/sandbox/transport.js';
import { MAX_LOG_CHARACTERS } from '#infra/sandbox/protocol.js';
import { ResearchPythonExecutionError } from '../errors.js';
import { ResearchBridge } from './research-bridge.js';
import type { ResearchBridgeContract } from './contract.js';
import { dispatchResearchRequest } from './host/dispatch.js';

vi.mock('./host/dispatch.js', () => ({ dispatchResearchRequest: vi.fn() }));

const environment = {
  runtime: 'research-py-v1',
  python: '3.13.3',
  numpy: null,
  pandas: null,
  matplotlib: null,
  scipy: null,
  statsmodels: null,
  'scikit-learn': null,
};
const ready = { type: 'research_ready', environment, capabilities: ['explicit_parameters'] };
const executed = { type: 'research_executed', outputs: [], definitions: ['value'], references: [] };
const cell = { id: 'cell', source: 'value = 1' };
const request = {
  type: 'request' as const,
  id: 7,
  method: 'research_series' as const,
  arguments: {},
};

function fixture(...frames: unknown[]) {
  const transport: SandboxTransport = {
    send: vi.fn(async () => {}),
    close: vi.fn(),
    abort: vi.fn(),
    isClosed: false,
    async readValidated<Frame>(schema: z.ZodType<Frame>) {
      if (!frames.length) {
        throw new Error('Fixture exhausted before the research bridge completed');
      }

      return schema.parse(frames.shift());
    },
  };
  const host = { close: vi.fn() };
  const bridge: ResearchBridgeContract = new ResearchBridge(
    transport,
    { documentId: 'document' },
    host,
  );

  return { bridge, transport, host };
}

afterEach(() => vi.resetAllMocks());

describe('Research bridge protocol and current data boundaries', () => {
  it('negotiates capabilities and negotiates runtime metadata without persisted fingerprints', async () => {
    const { bridge, transport, host } = fixture(ready, executed, { type: 'research_reset_done' });
    const metadata = await bridge.initialize();
    expect(metadata).toEqual({
      environment: { ...environment, capabilities: ['explicit_parameters'] },
      capabilities: ['explicit_parameters'],
    });

    await expect(bridge.execute({ cell, parameters: { window: 3 } })).resolves.toEqual({
      outputs: [],
      definitions: ['value'],
      references: [],
    });
    await bridge.reset();
    expect(vi.mocked(transport.send).mock.calls.map(([frame]) => frame)).toEqual([
      {
        type: 'research_start',
        runtime_version: 'research-py-v1',
        request_capabilities: ['explicit_parameters'],
      },
      { type: 'research_execute', cell_id: 'cell', source: 'value = 1', parameters: { window: 3 } },
      { type: 'research_reset' },
    ]);
    expect(host.close).not.toHaveBeenCalled();
  });

  it('keeps old sandboxes usable without parameters and rejects explicit parameters before capture', async () => {
    const { bridge, transport } = fixture({ type: 'research_ready', environment }, executed);
    expect((await bridge.initialize()).capabilities).toEqual([]);

    await expect(bridge.execute({ cell, parameters: {} })).rejects.toThrow('must be updated');
    expect(transport.send).toHaveBeenCalledOnce();
    await expect(bridge.execute({ cell })).resolves.toMatchObject({ definitions: ['value'] });
    expect(transport.send).toHaveBeenLastCalledWith({
      type: 'research_execute',
      cell_id: 'cell',
      source: 'value = 1',
    });
  });
  it('does not send startup or source after cancellation', async () => {
    const cancelled = new Error('cancelled');
    const first = fixture(ready);
    await expect(first.bridge.initialize({ signal: AbortSignal.abort(cancelled) })).rejects.toBe(
      cancelled,
    );
    expect(first.transport.send).not.toHaveBeenCalled();
    const { bridge, transport } = fixture(ready);
    await bridge.initialize();
    await expect(bridge.execute({ cell }, { signal: AbortSignal.abort(cancelled) })).rejects.toBe(
      cancelled,
    );
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it('maps analysis fields and omits empty optional request lists', async () => {
    const empty = {
      cell_id: 'empty',
      definitions: [],
      references: [],
      imports: [],
      series_requests: [],
      yield_curve_requests: [],
      macro_requests: [],
      fx_requests: [],
      equity_requests: [],
    };
    const { bridge, transport } = fixture(ready, {
      type: 'research_analyzed',
      cells: [
        empty,
        {
          ...empty,
          cell_id: 'queries',
          definitions: ['result'],
          references: ['data'],
          imports: ['numpy'],
          series_requests: [{ line: 1, asset_type: 'equity', identifier: 'AAA', measure: 'close' }],
          yield_curve_requests: [{ line: 2, curve: 'treasury', tenor: '10Y' }],
          macro_requests: [{ line: 3, series: 'cpi' }],
          fx_requests: [{ line: 4, pair: 'USDCNY' }],
          equity_requests: [{ line: 6, method: 'equity_dividends', identifier: 'AAA' }],
          error: 'syntax error',
        },
      ],
    });
    await bridge.initialize();
    const cells = [
      { id: 'empty', source: '' },
      { id: 'queries', source: 'invalid source' },
    ];

    await expect(bridge.analyze(cells)).resolves.toEqual([
      { cellId: 'empty', definitions: [], references: [], imports: [], seriesRequests: [] },
      {
        cellId: 'queries',
        definitions: ['result'],
        references: ['data'],
        imports: ['numpy'],
        seriesRequests: [{ line: 1, assetType: 'equity', identifier: 'AAA', measure: 'close' }],
        yieldCurveRequests: [{ line: 2, curve: 'treasury', tenor: '10Y' }],
        macroRequests: [{ line: 3, series: 'cpi' }],
        fxRequests: [{ line: 4, pair: 'USDCNY' }],
        equityRequests: [{ line: 6, method: 'equity_dividends', identifier: 'AAA' }],
        error: 'syntax error',
      },
    ]);
    expect(transport.send).toHaveBeenLastCalledWith({ type: 'research_analyze', cells });
  });
  it('dispatches current requests and sends their matching response', async () => {
    const { bridge, transport } = fixture(ready, request, executed);
    await bridge.initialize();
    vi.mocked(dispatchResearchRequest).mockResolvedValueOnce({
      type: 'response',
      id: 7,
      result: { rows: [] },
    });
    await bridge.execute({ cell });
    expect(dispatchResearchRequest).toHaveBeenCalledExactlyOnceWith('document', request);
    expect(transport.send).toHaveBeenLastCalledWith({
      type: 'response',
      id: 7,
      result: { rows: [] },
    });
  });
  it('enforces transient request and response byte budgets before delivery', async () => {
    const first = fixture(ready, request, { ...request, id: 8 }, executed);
    await first.bridge.initialize();
    vi.mocked(dispatchResearchRequest).mockResolvedValue({
      type: 'response',
      id: 7,
      result: { rows: [] },
    });
    await expect(
      first.bridge.execute({ cell }, { limits: { sdkRequests: 1, inputBytes: 1000 } }),
    ).rejects.toMatchObject({ reason: 'embedded_request_limit' });
    expect(dispatchResearchRequest).toHaveBeenCalledOnce();
    const second = fixture(ready, request);
    await second.bridge.initialize();
    await expect(
      second.bridge.execute({ cell }, { limits: { sdkRequests: 1, inputBytes: 1 } }),
    ).rejects.toMatchObject({ reason: 'embedded_input_limit' });
    expect(second.transport.send).toHaveBeenCalledTimes(2);
  });

  it('propagates request dispatch failures without creating a catchable Python response', async () => {
    const { bridge, transport, host } = fixture(ready, request);
    await bridge.initialize();
    const failure = new Error('request evidence unavailable');
    vi.mocked(dispatchResearchRequest).mockRejectedValueOnce(failure);

    await expect(bridge.execute({ cell })).rejects.toBe(failure);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(host.close).not.toHaveBeenCalled();
  });

  it('preserves logs and definitions on Python errors and starts the next execution with empty logs', async () => {
    const { bridge, host } = fixture(
      ready,
      { type: 'log', level: 'warning', text: 'before failure' },
      {
        type: 'research_error',
        message: 'user failure',
        definitions: ['partial'],
        references: ['input'],
      },
      executed,
    );
    await bridge.initialize();
    await expect(bridge.execute({ cell })).rejects.toMatchObject({
      name: 'ResearchPythonExecutionError',
      message: 'user failure',
      outputs: [{ type: 'text', level: 'warning', text: 'before failure' }],
      definitions: ['partial'],
      references: ['input'],
    });
    expect(host.close).not.toHaveBeenCalled();

    await expect(bridge.execute({ cell })).resolves.toMatchObject({ outputs: [] });
  });

  it('closes through the runtime host when cumulative validated logs exceed the transfer limit', async () => {
    const log = { type: 'log', level: 'info', text: '界'.repeat(MAX_LOG_CHARACTERS) };
    const count = Math.ceil((8 * 1024 * 1024) / Buffer.byteLength(JSON.stringify(log), 'utf8')) + 1;
    const { bridge, host } = fixture(ready, ...Array.from({ length: count }, () => log));
    await bridge.initialize();

    await expect(bridge.execute({ cell })).rejects.toThrow(
      'Research log output exceeds the runtime transfer limit',
    );
    expect(host.close).toHaveBeenCalledOnce();
  });

  it('rejects oversized final outputs without closing the session and permits another execution', async () => {
    const output = { type: 'text', text: 'x'.repeat(4 * 1024 * 1024) };
    const { bridge, host } = fixture(ready, { ...executed, outputs: [output, output] }, executed);
    await bridge.initialize();

    await expect(bridge.execute({ cell })).rejects.toBeInstanceOf(ResearchPythonExecutionError);
    expect(host.close).not.toHaveBeenCalled();
    await expect(bridge.execute({ cell })).resolves.toMatchObject({ outputs: [] });
  });
});
