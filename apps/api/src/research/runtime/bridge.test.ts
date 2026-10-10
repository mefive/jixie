import type { z } from 'zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SandboxTransport } from '#infra/runtime/exchange.js';
import { MAX_LOG_CHARACTERS } from '#infra/runtime/protocol.js';
import { ResearchPythonExecutionError } from '../errors.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import { ResearchBridge } from './bridge.js';
import type { ResearchBridgeContract } from './contract.js';
import { dispatchResearchRequest, type ResearchRequestObserver } from './host/dispatch.js';

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

describe('Research bridge protocol and evidence boundaries', () => {
  it('negotiates capabilities and returns the environment used for execution fingerprints', async () => {
    const { bridge, transport, host } = fixture(ready, executed, { type: 'research_reset_done' });
    const metadata = await bridge.initialize();
    expect(metadata).toEqual({
      environment: { ...environment, capabilities: ['explicit_parameters'] },
      capabilities: ['explicit_parameters'],
    });
    const captureEnvironment = vi.fn(async (captured: Record<string, unknown>) => {
      expect(captured).toBe(metadata.environment);
      expect(transport.send).toHaveBeenCalledOnce();
    });

    await expect(
      bridge.execute({ cell, parameters: { window: 3 } }, { captureEnvironment }),
    ).resolves.toEqual({
      outputs: [],
      definitions: ['value'],
      references: [],
      environmentFingerprint: researchPayloadHash(metadata.environment),
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
    const captureEnvironment = vi.fn();

    await expect(bridge.execute({ cell, parameters: {} }, { captureEnvironment })).rejects.toThrow(
      'must be updated',
    );
    expect(captureEnvironment).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalledOnce();
    await expect(bridge.execute({ cell })).resolves.toMatchObject({ definitions: ['value'] });
    expect(transport.send).toHaveBeenLastCalledWith({
      type: 'research_execute',
      cell_id: 'cell',
      source: 'value = 1',
    });
  });

  it('does not send startup or source after cancellation at their respective boundaries', async () => {
    const cancelled = new Error('cancelled');
    const beforeStartup = fixture(ready);
    await expect(
      beforeStartup.bridge.initialize({ signal: AbortSignal.abort(cancelled) }),
    ).rejects.toBe(cancelled);
    expect(beforeStartup.transport.send).not.toHaveBeenCalled();

    const { bridge, transport } = fixture(ready);
    await bridge.initialize();
    const controller = new AbortController();
    await expect(
      bridge.execute(
        { cell },
        {
          signal: controller.signal,
          captureEnvironment: async () => {
            controller.abort(cancelled);
          },
        },
      ),
    ).rejects.toBe(cancelled);
    expect(transport.send).toHaveBeenCalledOnce();
  });

  it('propagates environment persistence failures before sending source', async () => {
    const { bridge, transport, host } = fixture(ready);
    await bridge.initialize();
    const failure = new Error('environment evidence unavailable');

    await expect(
      bridge.execute(
        { cell },
        {
          captureEnvironment: async () => {
            throw failure;
          },
        },
      ),
    ).rejects.toBe(failure);
    expect(transport.send).toHaveBeenCalledOnce();
    expect(host.close).not.toHaveBeenCalled();
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
      commodity_requests: [],
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
          commodity_requests: [{ line: 5, method: 'commodity_returns', product: 'AU' }],
          equity_requests: [{ line: 6, method: 'equity_flows', identifier: 'AAA' }],
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
        commodityRequests: [{ line: 5, method: 'commodity_returns', product: 'AU' }],
        equityRequests: [{ line: 6, method: 'equity_flows', identifier: 'AAA' }],
        error: 'syntax error',
      },
    ]);
    expect(transport.send).toHaveBeenLastCalledWith({ type: 'research_analyze', cells });
  });

  it('waits for request evidence before sending the matching response', async () => {
    const { bridge, transport } = fixture(ready, request, executed);
    await bridge.initialize();
    let release!: () => void;
    let entered!: () => void;
    const recording = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const retained = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observer: ResearchRequestObserver = {
      beforeRequest: vi.fn(async () => {}),
      captureResponse: vi.fn(async () => {
        entered();
        await retained;
      }),
    };
    const response = { result: { rows: [] } };
    vi.mocked(dispatchResearchRequest).mockImplementationOnce(
      async (documentId, frame, observed) => {
        expect(documentId).toBe('document');
        expect(observed).toBe(observer);
        await observed?.beforeRequest(frame);
        await observed?.captureResponse(frame, response);

        return { type: 'response', id: frame.id, ...response };
      },
    );
    const execution = bridge.execute({ cell }, { observer });
    await recording;
    expect(transport.send).toHaveBeenCalledTimes(2);
    release();

    await execution;
    expect(observer.beforeRequest).toHaveBeenCalledExactlyOnceWith(request);
    expect(observer.captureResponse).toHaveBeenCalledExactlyOnceWith(request, response);
    expect(transport.send).toHaveBeenLastCalledWith({
      type: 'response',
      id: 7,
      result: { rows: [] },
    });
  });

  it('propagates request persistence failures without creating a catchable Python response', async () => {
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
    const metadata = await bridge.initialize();
    await expect(bridge.execute({ cell })).rejects.toMatchObject({
      name: 'ResearchPythonExecutionError',
      message: 'user failure',
      outputs: [{ type: 'text', level: 'warning', text: 'before failure' }],
      definitions: ['partial'],
      references: ['input'],
      environmentFingerprint: researchPayloadHash(metadata.environment),
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
