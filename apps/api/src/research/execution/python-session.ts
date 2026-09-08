import type { ResearchCellOutputBlockV1 } from '@jixie/shared';
import { PythonSession } from '../../infra/runtime/python/session.js';
import type { ResearchPythonAnalysis } from '../sdk/analysis-types.js';
import {
  researchAnalysisFrameSchema,
  researchExecutionFrameSchema,
  researchResetFrameSchema,
  researchStartupFrameSchema,
} from '../sdk/protocol.js';
import { dispatchResearchRequest } from '../sdk/dispatch.js';
import { researchPayloadHash } from '../evidence/fingerprints.js';

export function closeResearchDocumentRuntime(documentId: string): void {
  researchRuntimeManager.close(documentId);
}

const MAX_LIVE_RESEARCH_SESSIONS = 4;

const MAX_RESEARCH_RUNTIME_OUTPUT_BYTES = 8 * 1024 * 1024;

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
            await dispatchResearchRequest(documentId, entry.session, frame);
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

function runtimeFrameError(frame: { type: string; message?: unknown }, operation: string): Error {
  if (frame.type === 'fatal' || frame.type === 'error' || frame.type === 'research_error') {
    return new Error(String(frame.message ?? `Python runtime failed while ${operation}`));
  }
  return new Error(`unexpected Python sandbox frame while ${operation}: ${frame.type}`);
}
