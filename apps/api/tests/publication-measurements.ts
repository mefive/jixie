import { vi } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PublicationPlan } from '../src/ingestion/publication-plan.js';
import { candidateFilename } from '../src/ingestion/replica-files.js';
import type {
  PublicationWorkload,
  PublicationBudgetProfile,
} from '../src/ingestion/publication-budget.js';

interface PublicationMeasurementInput<Result> {
  runId: string;
  rowsPerOperation: number;
  publish: () => Promise<Result>;
}

/**
 * 只在隔离验收中测量回放成本和资源峰值，不把样本系数自动用于工作库。
 *
 * Measure replay costs and resource peaks only in isolated validation;
 * never enable sample rates for the working database.
 */
export async function measurePublication<Result>(
  input: PublicationMeasurementInput<Result>,
): Promise<Result> {
  const directory = dirname(candidateFilename(input.runId));
  let peakRssBytes = process.memoryUsage().rss;
  let peakPlanBytes = 0;
  let writing = false;
  let prepared:
    | { workloads: PublicationWorkload[]; preparationMs: number; budget: unknown }
    | undefined;
  let writeMs = 0;
  let waitMs = 0;
  const costs = new Map<string, { model: string; operation: string; rows: number; ms: number }>();
  const sample = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    try {
      const bytes = readdirSync(directory)
        .filter((name) => name.endsWith('.plan'))
        .reduce((sum, name) => sum + statSync(join(directory, name)).size, 0);
      peakPlanBytes = Math.max(peakPlanBytes, bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  };
  const originalLog = console.error;
  const logger = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] === '[publication] prepared') {
      prepared = JSON.parse(String(args[1]));
      sample();
    } else if (args[0] === '[publication] writing') {
      writing = true;
      waitMs = JSON.parse(String(args[1])).waitMs;
    } else if (args[0] === '[publication] committed') {
      writeMs = JSON.parse(String(args[1])).writeMs;
      writing = false;
    }
    originalLog(...args);
  });
  const originalRead = PublicationPlan.prototype.read;
  const reader = vi.spyOn(PublicationPlan.prototype, 'read').mockImplementation(async function* (
    this: PublicationPlan,
    signal?: AbortSignal,
  ) {
    for await (const value of originalRead.call(this, signal)) {
      if (!writing) {
        yield value;
        continue;
      }
      const chunk = value as {
        kind: string;
        model: string;
        inserted?: unknown[];
        updated?: unknown[];
        deleted?: unknown[];
        rows?: unknown[];
      };
      const operations =
        chunk.kind === 'market'
          ? ([
              ['insert', chunk.inserted!.length],
              ['update', chunk.updated!.length],
              ['delete', chunk.deleted!.length],
            ] as const)
          : ([['insert', chunk.rows!.length]] as const);
      const active = operations.filter(([, rows]) => rows > 0);
      const started = performance.now();
      yield value;
      const elapsed = performance.now() - started;
      // 混合块不强行分摊各操作成本，纳入剩余回放预算。
      // Leave mixed chunks in the remaining replay budget instead of inventing
      // per-operation allocations.
      if (active.length === 1 && chunk.kind !== 'issues') {
        const model = chunk.kind === 'market' ? chunk.model : 'ingestionBatch';
        const [operation, rows] = active[0];
        const key = `${model}/${operation}`;
        const cost = costs.get(key) ?? { model, operation, rows: 0, ms: 0 };
        cost.rows += rows;
        cost.ms += elapsed;
        costs.set(key, cost);
      }
    }
  });
  const timer = setInterval(sample, 1000);
  try {
    const result = await input.publish();
    sample();
    const measured = [...costs.values()];
    const report = {
      runId: input.runId,
      rowsPerOperation: input.rowsPerOperation,
      preparationMs: prepared?.preparationMs,
      waitMs,
      writeMs,
      peakRssBytes,
      peakPlanBytes,
      budget: prepared?.budget,
      costs: measured,
    };
    originalLog('[publication-measurement]', JSON.stringify(report));
    const reportPath = process.env.JIXIE_PUBLICATION_MEASUREMENT_OUT;
    if (reportPath) {
      await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    }
    const profilePath = process.env.JIXIE_PUBLICATION_CALIBRATION_OUT;
    if (profilePath && prepared) {
      const sampleDescription = `Isolated fixed-width fixture; ${input.rowsPerOperation} rows per operation`;
      const evidence = `${sampleDescription}; ${reportPath ?? input.runId}.`;
      const profile: PublicationBudgetProfile = {
        version: 1,
        evidence: `${evidence} Validate independently; not general production calibration.`,
        bufferPercent: 50,
        minimumMs: 30000,
        commitMs: Math.max(0, writeMs - measured.reduce((sum, cost) => sum + cost.ms, 0)),
        tables: prepared.workloads
          .filter((work) => work.calls > 0)
          .map((work) => {
            const perRow = (operation: string) => {
              const cost = costs.get(`${work.model}/${operation}`);
              return cost ? cost.ms / cost.rows : 0;
            };
            return {
              model: work.model,
              maximumRows: null,
              indexCount: work.indexCount,
              insertMs: perRow('insert'),
              updateMs: perRow('update'),
              deleteMs: perRow('delete'),
              insertByteMs: 0,
              updateByteMs: 0,
              deleteByteMs: 0,
              callMs: 0,
              indexMutationMs: 0,
            };
          }),
      };
      await writeFile(profilePath, JSON.stringify(profile, null, 2), { mode: 0o600 });
    }

    return result;
  } finally {
    clearInterval(timer);
    reader.mockRestore();
    logger.mockRestore();
  }
}
