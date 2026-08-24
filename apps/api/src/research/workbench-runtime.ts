import type { ResearchCellOutputBlockV1 } from '@jixie/shared';
import { PythonSession, type PythonFrame } from '../strategy/python/session.js';
import { loadResearchCrossSection, loadResearchPanel } from './equity-dataset.js';
import { researchPayloadHash } from './fingerprints.js';
import { loadResearchSeries, prepareResearchSeries, researchSeriesLoadStart } from './series.js';
import {
  parseResearchCrossSectionRuntimeRequest,
  parseResearchEquityDatasetRuntimeRows,
  parseResearchPanelRuntimeRequest,
  parseResearchSeriesRuntimeRequest,
  parseResearchSeriesRuntimeRows,
} from './workbench-sdk.js';

const MAX_LIVE_RESEARCH_SESSIONS = 8;
const MAX_RESEARCH_RUNTIME_OUTPUT_BYTES = 8 * 1024 * 1024;

export interface ResearchPythonAnalysis {
  cellId: string;
  definitions: string[];
  references: string[];
  seriesRequests?: ResearchPythonSeriesRequest[];
  error?: string;
}

export interface ResearchPythonSeriesRequest {
  line: number;
  assetType: string | null;
  identifier: string | null;
  measure: string | null;
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
  activeCellId?: string;
  interrupted: boolean;
}

class ResearchRuntimeManager {
  private readonly entries = new Map<string, ResearchRuntimeEntry>();

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
        const frame = await entry.session.read();
        if (frame.type === 'log') {
          continue;
        }
        if (frame.type === 'research_analyzed') {
          return (frame.cells as Array<Record<string, unknown>>).map((cell) => ({
            cellId: String(cell.cell_id),
            definitions: stringArray(cell.definitions),
            references: stringArray(cell.references),
            seriesRequests: researchPythonSeriesRequests(cell.series_requests),
            ...(typeof cell.error === 'string' ? { error: cell.error } : {}),
          }));
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
          const frame = await entry.session.read();
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
            await answerResearchRequest(entry.session, frame);
            continue;
          }
          if (frame.type === 'research_executed') {
            const outputs = [
              ...logOutputs,
              ...((Array.isArray(frame.outputs)
                ? frame.outputs
                : []) as ResearchCellOutputBlockV1[]),
            ];
            const outputBytes = Buffer.byteLength(JSON.stringify(outputs), 'utf8');
            if (outputBytes > MAX_RESEARCH_RUNTIME_OUTPUT_BYTES) {
              const message =
                `Research Cell outputs require ${outputBytes} bytes; the runtime transfer limit ` +
                `is ${MAX_RESEARCH_RUNTIME_OUTPUT_BYTES} bytes. Reduce the displayed value, ` +
                'table slice, chart rows, or figure size and rerun the Cell.';
              throw new ResearchPythonExecutionError(
                message,
                [{ type: 'text', text: message, level: 'warning' }],
                stringArray(frame.definitions),
                stringArray(frame.references),
                researchPayloadHash(entry.environment),
              );
            }
            return {
              outputs,
              definitions: stringArray(frame.definitions),
              references: stringArray(frame.references),
              environmentFingerprint: researchPayloadHash(entry.environment),
            };
          }
          if (frame.type === 'research_error') {
            throw new ResearchPythonExecutionError(
              String(frame.message ?? 'Python research cell failed'),
              logOutputs,
              stringArray(frame.definitions),
              stringArray(frame.references),
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
      const frame = await active.session.read();
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
    const entry = await this.getOrCreate(documentId);
    const result = entry.queue.then(() => operation(entry));
    entry.queue = result.then(
      () => undefined,
      () => undefined,
    );
    entry.touchedAt = Date.now();
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
    }
  }

  private async getOrCreate(documentId: string): Promise<ResearchRuntimeEntry> {
    const existing = this.entries.get(documentId);
    if (existing) {
      return existing;
    }
    if (this.entries.size >= MAX_LIVE_RESEARCH_SESSIONS) {
      const oldest = [...this.entries.entries()].sort(
        (left, right) => left[1].touchedAt - right[1].touchedAt,
      )[0];
      if (oldest) {
        this.close(oldest[0]);
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
    const frame = await session.read();
    if (frame.type === 'log') {
      continue;
    }
    if (frame.type === 'research_ready') {
      return (frame.environment as Record<string, unknown>) ?? {};
    }
    throw runtimeFrameError(frame, 'starting the research runtime');
  }
}

async function answerResearchRequest(session: PythonSession, frame: PythonFrame): Promise<void> {
  const id = Number(frame.id);
  try {
    let result: Record<string, unknown>;
    switch (frame.method) {
      case 'research_series': {
        const request = parseResearchSeriesRuntimeRequest(frame.arguments);
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
      case 'research_cross_section': {
        const request = parseResearchCrossSectionRuntimeRequest(frame.arguments);
        const loaded = await loadResearchCrossSection(request);
        result = {
          rows: parseResearchEquityDatasetRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
      case 'research_panel': {
        const request = parseResearchPanelRuntimeRequest(frame.arguments);
        const loaded = await loadResearchPanel(request);
        result = {
          rows: parseResearchEquityDatasetRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
      default:
        throw new Error(`unknown research runtime request: ${String(frame.method)}`);
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

function runtimeFrameError(frame: PythonFrame, operation: string): Error {
  if (frame.type === 'fatal' || frame.type === 'error' || frame.type === 'research_error') {
    return new Error(String(frame.message ?? `Python runtime failed while ${operation}`));
  }
  return new Error(`unexpected Python sandbox frame while ${operation}: ${frame.type}`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function researchPythonSeriesRequests(value: unknown): ResearchPythonSeriesRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const request = item as Record<string, unknown>;
    return [
      {
        line: typeof request.line === 'number' ? request.line : 0,
        assetType: typeof request.asset_type === 'string' ? request.asset_type : null,
        identifier: typeof request.identifier === 'string' ? request.identifier : null,
        measure: typeof request.measure === 'string' ? request.measure : null,
      },
    ];
  });
}
