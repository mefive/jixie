import type { z } from 'zod';
import { exchangeSandboxCommand, type SandboxTransport } from '#infra/runtime/exchange.js';
import type { RuntimeLogFrame } from '#infra/runtime/protocol.js';
import type { ResearchCellOutputBlockV1 } from '@jixie/shared';
import { ResearchPythonExecutionError } from '../errors.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';
import type { ResearchPythonAnalysis } from './host/analysis-types.js';
import { dispatchResearchRequest } from './host/dispatch.js';
import {
  researchAnalysisFrameSchema,
  researchExecutionFrameSchema,
  researchResetFrameSchema,
  researchStartupFrameSchema,
} from './host/protocol.js';
import type {
  ResearchCellInput,
  ResearchExecutionInput,
  ResearchExecutionOptions,
  ResearchExecution,
  ResearchRuntimeMetadata,
} from './contract.js';

const MAX_RESEARCH_RUNTIME_OUTPUT_BYTES = 8 * 1024 * 1024;

type ResearchResultFrame = Extract<
  z.infer<typeof researchExecutionFrameSchema>,
  { type: 'research_executed' | 'research_error' }
>;

interface ResearchExecutionLogs {
  outputs: ResearchCellOutputBlockV1[];
  bytes: number;
}

export interface ResearchBridgeHost {
  close(): void;
}

/** Owns research protocol state; the runtime owns resources and interruption handling. */
export class ResearchBridge {
  private metadata!: ResearchRuntimeMetadata;

  constructor(
    private readonly transport: SandboxTransport,
    private readonly documentId: string,
    private readonly host: ResearchBridgeHost,
  ) {}

  async initialize(signal?: AbortSignal): Promise<ResearchRuntimeMetadata> {
    const ready = await exchangeSandboxCommand(this.transport, {
      command: {
        type: 'research_start',
        runtime_version: 'research-py-v1',
        request_capabilities: ['explicit_parameters'],
      },
      schema: researchStartupFrameSchema,
      operation: 'starting the research runtime',
      signal,
      result: (frame) => ({
        environment: frame.environment,
        capabilities: frame.capabilities ?? [],
      }),
    });

    this.metadata = {
      environment: { ...ready.environment, capabilities: ready.capabilities },
      capabilities: ready.capabilities,
    };

    return this.metadata;
  }

  async analyze(cells: ResearchCellInput[]): Promise<ResearchPythonAnalysis[]> {
    const frame = await exchangeSandboxCommand(this.transport, {
      command: {
        type: 'research_analyze',
        cells: cells.map((cell) => ({ id: cell.id, source: cell.source })),
      },
      schema: researchAnalysisFrameSchema,
      operation: 'analyzing research cells',
      result: (frame) => frame,
    });

    return frame.cells.map((cell) => {
      const yieldCurveRequests = cell.yield_curve_requests.map((request) => ({
        line: request.line,
        curve: request.curve,
        tenor: request.tenor,
      }));
      const macroRequests = cell.macro_requests.map((request) => ({
        line: request.line,
        series: request.series,
      }));
      const fxRequests = cell.fx_requests.map((request) => ({
        line: request.line,
        pair: request.pair,
      }));
      const commodityRequests = cell.commodity_requests.map((request) => ({
        line: request.line,
        method: request.method,
        product: request.product,
      }));
      const equityRequests = cell.equity_requests.map((request) => ({
        line: request.line,
        method: request.method,
        identifier: request.identifier,
      }));

      return {
        cellId: cell.cell_id,
        definitions: cell.definitions,
        references: cell.references,
        imports: cell.imports,
        seriesRequests: cell.series_requests.map((request) => ({
          line: request.line,
          assetType: request.asset_type,
          identifier: request.identifier,
          measure: request.measure,
        })),
        ...(yieldCurveRequests.length > 0 ? { yieldCurveRequests } : {}),
        ...(macroRequests.length > 0 ? { macroRequests } : {}),
        ...(fxRequests.length > 0 ? { fxRequests } : {}),
        ...(commodityRequests.length > 0 ? { commodityRequests } : {}),
        ...(equityRequests.length > 0 ? { equityRequests } : {}),
        ...(typeof cell.error === 'string' ? { error: cell.error } : {}),
      };
    });
  }

  async execute(
    { cell, parameters }: ResearchExecutionInput,
    options: ResearchExecutionOptions = {},
  ): Promise<ResearchExecution> {
    options.signal?.throwIfAborted();
    if (parameters !== undefined && !this.metadata.capabilities.includes('explicit_parameters')) {
      throw new Error(
        'The Python sandbox must be updated before embedded analyses can use explicit parameters',
      );
    }

    await options.captureEnvironment?.(this.metadata.environment);
    options.signal?.throwIfAborted();

    const logs: ResearchExecutionLogs = { outputs: [], bytes: 0 };

    return exchangeSandboxCommand(this.transport, {
      command: {
        type: 'research_execute',
        cell_id: cell.id,
        source: cell.source,
        ...(parameters ? { parameters: parameters } : {}),
      },
      schema: researchExecutionFrameSchema,
      operation: 'executing a research cell',
      signal: options.signal,
      onLog: (frame) => this.recordLog(frame, logs),
      onRequest: (frame) => dispatchResearchRequest(this.documentId, frame, options.observer),
      result: (frame) => this.executionResult(frame, logs.outputs),
    });
  }

  async reset(): Promise<void> {
    await exchangeSandboxCommand(this.transport, {
      command: { type: 'research_reset' },
      schema: researchResetFrameSchema,
      operation: 'resetting the research runtime',
      result: () => undefined,
    });
  }

  private recordLog(frame: RuntimeLogFrame, logs: ResearchExecutionLogs): void {
    logs.bytes += Buffer.byteLength(JSON.stringify(frame), 'utf8');
    if (logs.bytes > MAX_RESEARCH_RUNTIME_OUTPUT_BYTES) {
      this.host.close();
      throw new ResearchPythonExecutionError(
        'Research log output exceeds the runtime transfer limit',
        [],
        [],
        [],
        researchPayloadHash(this.metadata.environment),
      );
    }

    logs.outputs.push({
      type: 'text',
      text: String(frame.text ?? ''),
      level: frame.level === 'error' ? 'error' : frame.level === 'warning' ? 'warning' : 'info',
    });
  }

  private executionResult(
    frame: ResearchResultFrame,
    logOutputs: ResearchCellOutputBlockV1[],
  ): ResearchExecution {
    switch (frame.type) {
      case 'research_executed': {
        const outputs: ResearchCellOutputBlockV1[] = [...logOutputs, ...frame.outputs];
        const outputBytes = Buffer.byteLength(JSON.stringify(outputs), 'utf8');
        if (outputBytes > MAX_RESEARCH_RUNTIME_OUTPUT_BYTES) {
          const message =
            `Research Cell outputs require ${outputBytes} bytes; the runtime transfer limit ` +
            `is ${MAX_RESEARCH_RUNTIME_OUTPUT_BYTES} bytes. Reduce the displayed value, ` +
            'table slice, chart rows, or figure size and rerun the Cell.';
          throw new ResearchPythonExecutionError(
            message,
            [{ type: 'text', text: message, level: 'warning' }],
            frame.definitions,
            frame.references,
            researchPayloadHash(this.metadata.environment),
          );
        }

        return {
          outputs,
          definitions: frame.definitions,
          references: frame.references,
          environmentFingerprint: researchPayloadHash(this.metadata.environment),
        };
      }
      case 'research_error': {
        throw new ResearchPythonExecutionError(
          String(frame.message ?? 'Python research cell failed'),
          logOutputs,
          frame.definitions,
          frame.references,
          researchPayloadHash(this.metadata.environment),
        );
      }
    }
  }
}
