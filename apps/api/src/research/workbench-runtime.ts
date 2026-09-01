import type { ResearchCellOutputBlockV1 } from '@jixie/shared';
import {
  researchAnalysisFrameSchema,
  researchExecutionFrameSchema,
  researchResetFrameSchema,
  researchStartupFrameSchema,
  type ResearchRequestFrame,
} from '../strategy/python/protocol.js';
import { PythonSession } from '../strategy/python/session.js';
import { loadResearchCrossSection, loadResearchPanel } from './equity-dataset.js';
import { researchPayloadHash } from './fingerprints.js';
import { researchYieldCurveBindingForSdkCall } from './concept-bindings.js';
import { loadResearchBacktestReportResult } from './backtest-report-result.js';
import { loadResearchFactorReportResult } from './factor-report-result.js';
import { loadResearchSeries, prepareResearchSeries, researchSeriesLoadStart } from './series.js';
import {
  parseResearchCrossSectionRuntimeRequest,
  parseResearchBacktestReportRuntimeRequest,
  parseResearchEquityDatasetRuntimeRows,
  parseResearchFactorReportRuntimeRequest,
  parseResearchPanelRuntimeRequest,
  parseResearchSeriesRuntimeRequest,
  parseResearchSeriesRuntimeRows,
  parseResearchYieldCurveRuntimeRequest,
  type ResearchCrossSectionRuntimeRequestV1,
  type ResearchBacktestReportRuntimeRequestV1,
  type ResearchFactorReportRuntimeRequestV1,
  type ResearchPanelRuntimeRequestV1,
  type ResearchSeriesRuntimeRequestV1,
  type ResearchYieldCurveRuntimeRequestV1,
} from './workbench-sdk.js';

const MAX_LIVE_RESEARCH_SESSIONS = 4;
const MAX_RESEARCH_RUNTIME_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface ResearchPythonAnalysis {
  cellId: string;
  definitions: string[];
  references: string[];
  imports?: string[];
  seriesRequests?: ResearchPythonSeriesRequest[];
  yieldCurveRequests?: ResearchPythonYieldCurveRequest[];
  error?: string;
}

export interface ResearchPythonSeriesRequest {
  line: number;
  assetType: string | null;
  identifier: string | null;
  measure: string | null;
}

export interface ResearchPythonYieldCurveRequest {
  line: number;
  curve: string | null;
  tenor: string | null;
}

export interface ResearchPythonExecution {
  outputs: ResearchCellOutputBlockV1[];
  definitions: string[];
  references: string[];
  environmentFingerprint: string;
}

interface ResearchRuntimeEntry {
  session: PythonSession;
  environment: Record<string, unknown>;
  queue: Promise<void>;
  touchedAt: number;
  pendingOperations: number;
  activeCellId?: string;
  interrupted: boolean;
}

class ResearchRuntimeManager {
  private readonly entries = new Map<string, ResearchRuntimeEntry>();
  private entryAcquisitionQueue: Promise<void> = Promise.resolve();

  async analyze(
    documentId: string,
    cells: Array<{ id: string; source: string }>,
  ): Promise<ResearchPythonAnalysis[]> {
    return this.withEntry(documentId, async (entry) => {
      await entry.session.send({
        type: 'research_analyze',
        cells: cells.map((cell) => ({ id: cell.id, source: cell.source })),
      });
      while (true) {
        const frame = await entry.session.readValidated(
          researchAnalysisFrameSchema,
          'analyzing research cells',
        );
        if (frame.type === 'log') {
          continue;
        }
        if (frame.type === 'research_analyzed') {
          return frame.cells.map((cell) => {
            const yieldCurveRequests = cell.yield_curve_requests.map((request) => ({
              line: request.line,
              curve: request.curve,
              tenor: request.tenor,
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
              ...(typeof cell.error === 'string' ? { error: cell.error } : {}),
            };
          });
        }
        throw runtimeFrameError(frame, 'analyzing research cells');
      }
    });
  }

  async execute(
    documentId: string,
    cell: { id: string; source: string },
  ): Promise<ResearchPythonExecution> {
    return this.withEntry(documentId, async (entry) => {
      entry.activeCellId = cell.id;
      try {
        await entry.session.send({
          type: 'research_execute',
          cell_id: cell.id,
          source: cell.source,
        });
        const logOutputs: ResearchCellOutputBlockV1[] = [];

        while (true) {
          const frame = await entry.session.readValidated(
            researchExecutionFrameSchema,
            'executing a research cell',
          );
          if (frame.type === 'log') {
            logOutputs.push({
              type: 'text',
              text: String(frame.text ?? ''),
              level:
                frame.level === 'error' ? 'error' : frame.level === 'warning' ? 'warning' : 'info',
            });
            continue;
          }
          if (frame.type === 'request') {
            const request = parseResearchRequestFrame(frame);
            await answerResearchRequest(documentId, entry.session, request);
            continue;
          }
          if (frame.type === 'research_executed') {
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
                researchPayloadHash(entry.environment),
              );
            }
            return {
              outputs,
              definitions: frame.definitions,
              references: frame.references,
              environmentFingerprint: researchPayloadHash(entry.environment),
            };
          }
          if (frame.type === 'research_error') {
            throw new ResearchPythonExecutionError(
              String(frame.message ?? 'Python research cell failed'),
              logOutputs,
              frame.definitions,
              frame.references,
              researchPayloadHash(entry.environment),
            );
          }
          throw runtimeFrameError(frame, 'executing a research cell');
        }
      } catch (error) {
        if (entry.interrupted) {
          throw new ResearchPythonInterruptionError(researchPayloadHash(entry.environment));
        }
        throw error;
      } finally {
        entry.activeCellId = undefined;
      }
    });
  }

  interrupt(documentId: string): string | null {
    const entry = this.entries.get(documentId);
    if (!entry?.activeCellId) {
      return null;
    }
    const cellId = entry.activeCellId;
    entry.interrupted = true;
    this.entries.delete(documentId);
    entry.session.close();
    return cellId;
  }

  activeCellId(documentId: string): string | null {
    return this.entries.get(documentId)?.activeCellId ?? null;
  }

  async reset(documentId: string): Promise<void> {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    await this.withEntry(documentId, async (active) => {
      await active.session.send({ type: 'research_reset' });
      const frame = await active.session.readValidated(
        researchResetFrameSchema,
        'resetting the research runtime',
      );
      if (frame.type !== 'research_reset_done') {
        throw runtimeFrameError(frame, 'resetting the research runtime');
      }
    });
  }

  close(documentId: string): void {
    const entry = this.entries.get(documentId);
    if (!entry) {
      return;
    }
    this.entries.delete(documentId);
    void entry.session.send({ type: 'close' }).catch(() => {});
    entry.session.close();
  }

  private async withEntry<T>(
    documentId: string,
    operation: (entry: ResearchRuntimeEntry) => Promise<T>,
  ): Promise<T> {
    const entry = await this.acquireEntry(documentId);
    const result = entry.queue.then(() => operation(entry));
    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } catch (error) {
      if (
        !(error instanceof ResearchPythonExecutionError) &&
        !(error instanceof ResearchPythonInterruptionError)
      ) {
        this.close(documentId);
      }
      throw error;
    } finally {
      entry.pendingOperations -= 1;
      entry.touchedAt = Date.now();
    }
  }

  private async acquireEntry(documentId: string): Promise<ResearchRuntimeEntry> {
    const acquisition = this.entryAcquisitionQueue.then(async () => {
      const entry = await this.getOrCreate(documentId);
      entry.pendingOperations += 1;
      return entry;
    });
    this.entryAcquisitionQueue = acquisition.then(
      () => undefined,
      () => undefined,
    );
    return acquisition;
  }

  private async getOrCreate(documentId: string): Promise<ResearchRuntimeEntry> {
    const existing = this.entries.get(documentId);
    if (existing) {
      return existing;
    }
    if (this.entries.size >= MAX_LIVE_RESEARCH_SESSIONS) {
      const oldest = [...this.entries.entries()]
        .filter(([, entry]) => entry.pendingOperations === 0)
        .sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
      if (oldest) {
        this.close(oldest[0]);
      } else {
        throw new Error(
          `Python sandbox is busy (${this.entries.size}/${MAX_LIVE_RESEARCH_SESSIONS} Research sessions)`,
        );
      }
    }

    const session = await PythonSession.connect();
    try {
      await session.send({ type: 'research_start', runtime_version: 'research-py-v1' });
      const environment = await waitForResearchReady(session);
      const entry: ResearchRuntimeEntry = {
        session,
        environment,
        queue: Promise.resolve(),
        touchedAt: Date.now(),
        pendingOperations: 0,
        interrupted: false,
      };
      this.entries.set(documentId, entry);
      return entry;
    } catch (error) {
      session.close();
      throw error;
    }
  }
}

export class ResearchPythonExecutionError extends Error {
  public constructor(
    message: string,
    public readonly outputs: ResearchCellOutputBlockV1[],
    public readonly definitions: string[],
    public readonly references: string[],
    public readonly environmentFingerprint: string,
  ) {
    super(message);
    this.name = 'ResearchPythonExecutionError';
  }
}

export class ResearchPythonInterruptionError extends Error {
  public constructor(public readonly environmentFingerprint: string) {
    super('Research cell execution was interrupted');
    this.name = 'ResearchPythonInterruptionError';
  }
}

export const researchRuntimeManager = new ResearchRuntimeManager();

async function waitForResearchReady(session: PythonSession): Promise<Record<string, unknown>> {
  while (true) {
    const frame = await session.readValidated(
      researchStartupFrameSchema,
      'starting the research runtime',
    );
    if (frame.type === 'log') {
      continue;
    }
    if (frame.type === 'research_ready') {
      return frame.environment;
    }
    throw runtimeFrameError(frame, 'starting the research runtime');
  }
}

type ParsedResearchRequest =
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_series';
      arguments: ResearchSeriesRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_yield_curve';
      arguments: ResearchYieldCurveRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_cross_section';
      arguments: ResearchCrossSectionRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_panel';
      arguments: ResearchPanelRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_factor_report';
      arguments: ResearchFactorReportRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_backtest_report';
      arguments: ResearchBacktestReportRuntimeRequestV1;
    });

function parseResearchRequestFrame(frame: ResearchRequestFrame): ParsedResearchRequest {
  switch (frame.method) {
    case 'research_series':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_series',
        arguments: parseResearchSeriesRuntimeRequest(frame.arguments),
      };
    case 'research_yield_curve':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_yield_curve',
        arguments: parseResearchYieldCurveRuntimeRequest(frame.arguments),
      };
    case 'research_cross_section':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_cross_section',
        arguments: parseResearchCrossSectionRuntimeRequest(frame.arguments),
      };
    case 'research_panel':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_panel',
        arguments: parseResearchPanelRuntimeRequest(frame.arguments),
      };
    case 'research_factor_report':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_factor_report',
        arguments: parseResearchFactorReportRuntimeRequest(frame.arguments),
      };
    case 'research_backtest_report':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_backtest_report',
        arguments: parseResearchBacktestReportRuntimeRequest(frame.arguments),
      };
  }
}

async function answerResearchRequest(
  documentId: string,
  session: PythonSession,
  frame: ParsedResearchRequest,
): Promise<void> {
  const id = frame.id;
  try {
    let result: Record<string, unknown>;
    switch (frame.method) {
      case 'research_series': {
        const request = frame.arguments;
        const input = {
          type: 'series' as const,
          id: `${request.asset_type}:${request.identifier}`,
          source: {
            kind: 'instrument' as const,
            assetType: request.asset_type,
            id: request.identifier,
          },
          measure: request.measure,
          transform: request.transform,
        };
        const loadStart = researchSeriesLoadStart(
          request.start,
          request.frequency,
          request.transform,
        );
        const loaded = await loadResearchSeries(input, loadStart, request.end);
        const points = prepareResearchSeries(loaded.points, request.frequency, request.transform, {
          start: request.start,
          end: request.end,
          partialPeriod: request.partial_period,
        });
        result = {
          rows: parseResearchSeriesRuntimeRows(points),
          diagnostics: loaded.diagnostics,
        };
        break;
      }
      case 'research_yield_curve': {
        const request = frame.arguments;
        const binding = researchYieldCurveBindingForSdkCall(request.curve, request.tenor);
        if (!binding || binding.source.kind !== 'yield_curve') {
          throw new Error(
            `yield curve ${request.curve}:${request.tenor} is not in the governed Research SDK catalog`,
          );
        }
        const input = {
          type: 'series' as const,
          id: `${request.curve}:${request.tenor}`,
          source: binding.source,
          measure: binding.measure,
          transform: request.transform,
        };
        const loadStart = researchSeriesLoadStart(
          request.start,
          request.frequency,
          request.transform,
        );
        const loaded = await loadResearchSeries(input, loadStart, request.end);
        const points = prepareResearchSeries(loaded.points, request.frequency, request.transform, {
          start: request.start,
          end: request.end,
          partialPeriod: request.partial_period,
        });
        result = {
          rows: parseResearchSeriesRuntimeRows(points),
          diagnostics: loaded.diagnostics,
        };
        break;
      }
      case 'research_cross_section': {
        const request = frame.arguments;
        const loaded = await loadResearchCrossSection(request);
        result = {
          rows: parseResearchEquityDatasetRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
      case 'research_panel': {
        const request = frame.arguments;
        const loaded = await loadResearchPanel(request);
        result = {
          rows: parseResearchEquityDatasetRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
      case 'research_factor_report': {
        result = await loadResearchFactorReportResult(documentId, frame.arguments.report_id);
        break;
      }
      case 'research_backtest_report': {
        result = await loadResearchBacktestReportResult(documentId, frame.arguments.report_id);
        break;
      }
    }
    await session.send({
      type: 'response',
      id,
      result,
    });
  } catch (error) {
    await session.send({
      type: 'response',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function runtimeFrameError(frame: { type: string; message?: unknown }, operation: string): Error {
  if (frame.type === 'fatal' || frame.type === 'error' || frame.type === 'research_error') {
    return new Error(String(frame.message ?? `Python runtime failed while ${operation}`));
  }
  return new Error(`unexpected Python sandbox frame while ${operation}: ${frame.type}`);
}
